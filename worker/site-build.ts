/**
 * The real website build. The worker calls this for a `site_build` job:
 *   1. write the saved brief into the runner's briefs/ folder
 *   2. run the runner's `create` (build, look pass, independent checks)
 *   3. run the runner's `deploy` under a free name
 *   4. write the result (live address, owner sign-in, checklist) back to the project
 * Progress goes to projects.state.site.build as stage numbers (see src/lib/builder/site-stages.ts), a heartbeat
 * and a count of files written. The web app only ever reads that record.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { briefCard, siteSlug } from "../src/lib/builder/site-brief";
import { DONE_STAGE, SITE_STAGES, stageFromRunnerLine } from "../src/lib/builder/site-stages";
import type { SiteBuild, WorkspaceState } from "../src/lib/workspace/types";

/** The part of pg's Pool this file uses, so tests can pass a stand-in. */
export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Job = { id: string; project_id: string };

export async function patchSiteBuild(db: Db, projectId: string, patch: Partial<SiteBuild>) {
  await db.query(
    `UPDATE projects
        SET state = jsonb_set(state, '{site,build}', COALESCE(state #> '{site,build}', '{}'::jsonb) || $2::jsonb),
            updated_at = now()
      WHERE id = $1`,
    [projectId, JSON.stringify(patch)],
  );
}

// ---- small pure helpers (tested) ----

export type RunSummary = {
  runId?: string;
  stopReason?: string;
  turns?: number;
  durationMinutes?: number;
  estimatedCostUsd?: number;
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  checks?: { typecheck?: boolean; build?: boolean };
  model?: string;
};

/** The runner prints a JSON summary after a blank line. Returns the last one in the output. */
export function parseSummary(out: string): RunSummary | null {
  const start = out.lastIndexOf("\n{\n");
  if (start < 0) return null;
  const end = out.indexOf("\n}", start);
  if (end < 0) return null;
  try {
    return JSON.parse(out.slice(start + 1, end + 2)) as RunSummary;
  } catch {
    return null;
  }
}

/** The deploy script prints "Live: https://name.domain". */
export function parseLiveUrl(out: string): string | null {
  return /^Live:\s*(https:\/\/\S+)/m.exec(out)?.[1] ?? null;
}

/** Names to try, in order: the plain slug, then the slug with a short random suffix. */
export function nameCandidates(siteName: string, rand: () => string = () => randomBytes(2).toString("hex")): string[] {
  const base = siteSlug(siteName).slice(0, 30).replace(/-+$/g, "") || "site";
  const padded = base.length >= 3 ? base : `${base}-site`;
  return [padded, `${padded}-${rand()}`, `${padded}-${rand()}`, `${padded}-${rand()}`];
}

/** The "Check these before you share it" list, built from the brief by code, not by the model. */
export function checklist(brief: Record<string, unknown>): string[] {
  const c = briefCard(brief);
  const items = c.unconfirmed.map((u) => `Make sure this is true before you publish it: "${u}"`);
  items.push("The headline, benefits and thank-you wording were drafted for you. Read them and change anything that isn't right.");
  items.push("Images are designed placeholders. Image uploads need a Blob store connected to the site's Vercel project; until then the owner area says uploads are not available.");
  items.push("The site starts with sample sign-ups, labelled as samples. Delete them in the owner area before real use.");
  return items;
}

// ---- running the runner ----

type RunResult = { code: number; out: string };

function runProcess(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; onLine?: (line: string) => void }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let buf = "";
    const take = (d: Buffer) => {
      const text = d.toString();
      out = (out + text).slice(-400_000);
      buf += text;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        opts.onLine?.(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", reject);
    child.on("close", (code) => {
      if (buf) opts.onLine?.(buf);
      resolve({ code: code ?? 1, out });
    });
  });
}

const tail = (s: string, n = 400) => s.trim().split("\n").slice(-6).join("\n").slice(-n);

/** A stage-level failure. runSiteBuild records which stage it stopped at, then throws. */
class BuildStop extends Error {}

export async function runSiteBuild(db: Db, job: Job, env: NodeJS.ProcessEnv = process.env) {
  const runner = env.RUNNER_DIR;
  if (!runner) throw new Error("RUNNER_DIR is not set on the worker, so it cannot find the runner.");
  const { rows } = await db.query(
    `SELECT p.state AS state, u.email AS email FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [job.project_id],
  );
  const start = rows[0]?.state as WorkspaceState | undefined;
  const ownerEmail = String(rows[0]?.email ?? "");
  const brief = start?.site?.brief;
  if (!start || !brief || !ownerEmail) throw new Error("The project has no saved brief or no owner.");
  const siteName = briefCard(brief).name || "site";

  const beat = () => patchSiteBuild(db, job.project_id, { heartbeatAt: new Date().toISOString() }).catch(() => {});
  const heartbeat = setInterval(beat, Number(env.WORKER_HEARTBEAT_MS ?? 10000));
  let filesTimer: NodeJS.Timeout | undefined;
  let stage = 0;
  const setStage = (n: number) => {
    if (n > stage) {
      stage = n;
      void patchSiteBuild(db, job.project_id, { stage: n }).catch(() => {});
    }
  };
  const stop = async (at: number, message: string): Promise<never> => {
    await patchSiteBuild(db, job.project_id, { failedStage: at, error: message.slice(0, 300) }).catch(() => {});
    throw new BuildStop(message);
  };

  try {
    await patchSiteBuild(db, job.project_id, { stage: 0, files: 0, heartbeatAt: new Date().toISOString() });

    // 1. The brief goes where the runner looks for briefs.
    const briefFile = path.join(runner, "briefs", `${siteSlug(siteName)}-${job.id.slice(0, 8)}.json`);
    await mkdir(path.dirname(briefFile), { recursive: true });
    await writeFile(briefFile, JSON.stringify(brief, null, 2));

    // 2. Build: create runs the main build, the look pass and the independent checks.
    let runDir: string | undefined;
    filesTimer = setInterval(async () => {
      if (!runDir) return;
      try {
        const t = await readFile(path.join(runDir, "transcript.jsonl"), "utf8");
        const files = t.split('"tool":"write_file"').length - 1;
        if (files > 0) await patchSiteBuild(db, job.project_id, { files });
      } catch {
        /* the log is not there yet */
      }
    }, Number(env.WORKER_FILES_MS ?? 6000));

    const created = await runProcess(
      "npm",
      ["run", "create", "--", `A waitlist website for ${siteName}`, "--specs", "vertical-packs/site/specs", "--brief", path.relative(runner, briefFile)],
      {
        cwd: runner,
        env: { ...env, RUNNER_MAX_COST_USD: env.WORKER_BUILD_MAX_USD ?? "8" },
        onLine: (line) => {
          const st = stageFromRunnerLine(line);
          if (st !== null) setStage(st);
          const m = /^\s+(\/\S*\/runs\/[^/\s]+)\/app\s*$/.exec(line);
          if (m) runDir = m[1];
        },
      },
    );
    const summary = parseSummary(created.out);
    if (summary?.runId && !runDir) runDir = path.join(runner, "runs", summary.runId);
    if (created.code !== 0 || !summary) await stop(stage, `The build did not finish. ${tail(created.out)}`);
    if (summary!.stopReason !== "finished") await stop(1, `The build stopped early (${summary!.stopReason}). It may have hit its time or cost limit.`);
    if (!summary!.checks?.typecheck || !summary!.checks?.build) await stop(3, "The site was written, but it did not pass the final checks.");
    if (!runDir) await stop(1, "The build finished but I could not find its folder.");

    const t = summary!.tokens ?? {};
    await db
      .query(`INSERT INTO usage (project_id, job_id, step, model, input_tokens, output_tokens, cost_usd) VALUES ($1, $2, 'site_build', $3, $4, $5, $6)`, [
        job.project_id,
        job.id,
        summary!.model ?? "unknown",
        (t.input ?? 0) + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0),
        t.output ?? 0,
        summary!.estimatedCostUsd ?? 0,
      ])
      .catch(() => {});

    // 3. Publish. A name that is taken makes deploy stop before it changes anything, so the next candidate is safe to try.
    setStage(4);
    const password = randomBytes(12).toString("base64url");
    let url: string | null = null;
    let lastOut = "";
    for (const name of nameCandidates(siteName)) {
      const deployed = await runProcess("npm", ["run", "deploy", "--", path.relative(runner, runDir!), "--name", name, "--email", ownerEmail], {
        cwd: runner,
        env: { ...env, ADMIN_PASSWORD: password },
        onLine: (line) => {
          const st = stageFromRunnerLine(line);
          if (st !== null) setStage(st);
        },
      });
      lastOut = deployed.out;
      if (deployed.code === 0) {
        url = parseLiveUrl(deployed.out) ?? `https://${name}.${env.APP_DOMAIN ?? "appnomics.live"}`;
        break;
      }
      if (!/already exists/i.test(deployed.out)) break;
    }
    if (!url) await stop(4, `Publishing did not work. ${tail(lastOut.split(password).join("***"))}`);

    // 4. Done: write the result and tell the person in the chat.
    const { rows: now } = await db.query(`SELECT state FROM projects WHERE id = $1`, [job.project_id]);
    const s = now[0].state as WorkspaceState;
    const build: SiteBuild = { ...(s.site?.build ?? start.site!.build!), stage: DONE_STAGE, finishedAt: new Date().toISOString(), url: url!, adminUrl: `${url}/admin/sign-in`, ownerEmail };
    const text = [
      `${siteName} is live: ${url}`,
      "",
      `Owner area: ${build.adminUrl}`,
      `Sign in with ${ownerEmail} and this password. It is shown once, so save it now: ${password}`,
      "",
      "Check these before you share it:",
      ...checklist(brief).map((c) => `- ${c}`),
    ].join("\n");
    const done: WorkspaceState = {
      ...s,
      phase: "summary",
      jobId: null,
      msgs: [...s.msgs, { id: s.nextId, kind: "bot", text }],
      nextId: s.nextId + 1,
      site: { brief: s.site!.brief, build },
    };
    await db.query(`UPDATE projects SET state = $2, status = 'ready', updated_at = now() WHERE id = $1`, [job.project_id, JSON.stringify(done)]);
  } finally {
    clearInterval(heartbeat);
    if (filesTimer) clearInterval(filesTimer);
  }
}

export const stageLabel = (n: number) => SITE_STAGES[Math.min(Math.max(n, 0), DONE_STAGE)].label;
