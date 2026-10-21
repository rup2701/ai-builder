/**
 * The worker. Run it next to the web app: `npm run worker`.
 *
 * It claims queued jobs one at a time and runs them. Closing the browser does not stop a job.
 * The build here is the rule-based builder; the real builder agent (specs -> repo -> tests)
 * replaces `runBuild` and keeps the same contract: report progress, write the final state, log usage.
 */
import { Pool } from "pg";
import { finishBuild, BUILD_STEPS } from "../src/lib/workspace/state";
import type { WorkspaceState } from "../src/lib/workspace/types";

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
  if (s) {
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
  console.log("worker: waiting for jobs");
  for (;;) {
    const job = await claim();
    if (!job) {
      await sleep(POLL_MS);
      continue;
    }
    console.log(`worker: ${job.type} job ${job.id}`);
    try {
      if (job.type === "build") await runBuild(job);
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
