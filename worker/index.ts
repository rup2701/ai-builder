/**
 * The worker. Run it next to the web app: `npm run worker`.
 *
 * It claims queued jobs one at a time and runs them. Closing the browser does not stop a job.
 * The build here is the rule-based builder; the real builder agent (specs -> repo -> tests)
 * replaces `runBuild` and keeps the same contract: report progress, write the final state, log usage.
 */
import { Pool } from "pg";
import { finishBuild, BUILD_STEPS } from "../src/lib/workspace/state";
import type { SiteBuild, WorkspaceState } from "../src/lib/workspace/types";
import { DONE_STAGE } from "../src/lib/builder/site-stages";
import { patchSiteBuild as patchSiteBuildDb, runSiteBuild, stageLabel } from "./site-build";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const STEP_MS = Number(process.env.WORKER_STEP_MS ?? 700);
const POLL_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function claim() {
  const { rows } = await pool.query(
    `UPDATE jobs SET status = 'running', started_at = now()
     WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id, project_id, type`,
  );
  return rows[0] as { id: string; project_id: string; type: string } | undefined;
}

async function setBuildStep(projectId: string, step: number) {
  await pool.query(`UPDATE projects SET state = jsonb_set(state, '{buildStep}', to_jsonb($2::int)), updated_at = now() WHERE id = $1`, [projectId, step]);
}

/** Merge a few fields into projects.state.site.build. The pane polls this. */
const patchSiteBuild = (projectId: string, patch: Partial<SiteBuild>) => patchSiteBuildDb(pool, projectId, patch);

/**
 * Piece 1 of "build from the chat": walks the six stages with short waits and writes nothing real.
 * WORKER_FAKE_STAGE_MS sets how long a stage lasts (default 4000). The real version replaces this
 * with the runner's create and deploy, and keeps the same writes to site.build.
 */
async function runSiteBuildFake(job: { id: string; project_id: string }) {
  const stageMs = Number(process.env.WORKER_FAKE_STAGE_MS ?? 4000);
  await patchSiteBuild(job.project_id, { fake: true, stage: 0, files: 0 });
  for (let stage = 0; stage < DONE_STAGE; stage++) {
    await patchSiteBuild(job.project_id, { stage });
    const ticks = 4;
    for (let t = 0; t < ticks; t++) {
      await sleep(stageMs / ticks);
      if (stage === 1) await patchSiteBuild(job.project_id, { files: (t + 1) * 9 });
    }
  }
  const { rows } = await pool.query(`SELECT state FROM projects WHERE id = $1`, [job.project_id]);
  const s = rows[0].state as WorkspaceState;
  const build = s.site?.build;
  const done: WorkspaceState = {
    ...s,
    phase: "summary",
    jobId: null,
    msgs: [...s.msgs, { id: s.nextId, kind: "bot", text: "This was a practice run: the stages ran, but no site was built. The real build comes next." }],
    nextId: s.nextId + 1,
    site: { brief: s.site!.brief, build: { ...build!, stage: DONE_STAGE, finishedAt: new Date().toISOString(), fake: true } },
  };
  await pool.query(`UPDATE projects SET state = $2, status = 'ready', updated_at = now() WHERE id = $1`, [job.project_id, JSON.stringify(done)]);
}

async function runBuild(job: { id: string; project_id: string }) {
  const started = Date.now();
  for (let i = 1; i < BUILD_STEPS.length; i++) {
    await sleep(STEP_MS);
    await setBuildStep(job.project_id, i);
  }
  await sleep(STEP_MS);
  const { rows } = await pool.query(`SELECT state, idea FROM projects WHERE id = $1`, [job.project_id]);
  const done = finishBuild(rows[0].state as WorkspaceState);
  const name = done.history[0]?.name ?? "Your store";
  await pool.query(`UPDATE projects SET state = $2, title = $3, status = 'ready', updated_at = now() WHERE id = $1`, [job.project_id, JSON.stringify(done), name]);
  await pool.query(
    `INSERT INTO usage (project_id, job_id, step, model, input_tokens, output_tokens, cost_usd) VALUES ($1, $2, 'build', 'rules', 0, 0, 0)`,
    [job.project_id, job.id],
  );
  await pool.query(`UPDATE jobs SET log = log || $2::jsonb WHERE id = $1`, [job.id, JSON.stringify([{ at: new Date().toISOString(), event: "built", ms: Date.now() - started }])]);
}

async function fail(job: { id: string; project_id: string }, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  await pool.query(`UPDATE jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [job.id, message]);
  const { rows } = await pool.query(`SELECT state FROM projects WHERE id = $1`, [job.project_id]);
  const s = rows[0]?.state as WorkspaceState | undefined;
  if (s?.site?.build) {
    const stage = s.site.build.failedStage ?? s.site.build.stage;
    const label = stageLabel(s.site.build.failedStage ?? stage);
    const back: WorkspaceState = {
      ...s,
      phase: "summary",
      jobId: null,
      msgs: [...s.msgs, { id: s.nextId, kind: "bot", text: `The build stopped at "${label}". Nothing was lost. Press Build my site to try again.` }],
      nextId: s.nextId + 1,
      site: { brief: s.site.brief, build: { ...s.site.build, failedStage: stage, error: s.site.build.error ?? message.slice(0, 300) } },
    };
    await pool.query(`UPDATE projects SET state = $2, status = 'ready', updated_at = now() WHERE id = $1`, [job.project_id, JSON.stringify(back)]);
  } else if (s) {
    const back: WorkspaceState = {
      ...s,
      phase: "summary",
      buildStep: 0,
      msgs: [...s.msgs, { id: s.nextId, kind: "bot", text: "The build hit a problem. Nothing was lost. Say “build it” to try again." }],
      nextId: s.nextId + 1,
    };
    await pool.query(`UPDATE projects SET state = $2, status = 'draft', updated_at = now() WHERE id = $1`, [job.project_id, JSON.stringify(back)]);
  }
}

async function main() {
  // A job still marked running when the worker starts was cut off by a restart or a crash.
  const stuck = await pool.query(`SELECT id, project_id FROM jobs WHERE status = 'running'`);
  for (const j of stuck.rows as { id: string; project_id: string }[]) {
    console.log(`worker: job ${j.id} was running when the worker stopped; marking it failed`);
    await fail(j, new Error("The builder restarted while this build was running."));
    await pool.query(`UPDATE jobs SET finished_at = now() WHERE id = $1`, [j.id]);
  }
  console.log(`worker: waiting for jobs (site builds: ${process.env.WORKER_SITE_MODE === "real" ? "REAL" : "practice"})`);
  for (;;) {
    const job = await claim();
    if (!job) {
      await sleep(POLL_MS);
      continue;
    }
    console.log(`worker: ${job.type} job ${job.id}`);
    try {
      if (job.type === "build") await runBuild(job);
      else if (job.type === "site_build") {
        // Real builds spend money, so they only run when WORKER_SITE_MODE=real. The default is the practice run.
        if (process.env.WORKER_SITE_MODE === "real") await runSiteBuild(pool, job);
        else await runSiteBuildFake(job);
      }
      else throw new Error(`Unknown job type: ${job.type}`);
      await pool.query(`UPDATE jobs SET status = 'done', finished_at = now() WHERE id = $1`, [job.id]);
    } catch (e) {
      console.error("worker: job failed", e);
      await fail(job, e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
