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
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { briefCard, siteSlug } from "../src/lib/builder/site-brief";
import { DONE_STAGE, SITE_STAGES, stageFromRunnerLine } from "../src/lib/builder/site-stages";
import { notifyBuildEnd, notifyBuildStart, projectLink } from "../src/lib/notify";
import type { SiteBuild, WorkspaceState } from "../src/lib/workspace/types";

/** The part of pg's Pool this file uses, so tests can pass a stand-in. */
export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type Job = { id: string; project_id: string };

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
  timingsSeconds?: { agent?: number; typecheck?: number; build?: number; model?: number; tools?: number; tests?: number; agentChecks?: number };
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
  const kind = (brief.site as { kind?: string } | undefined)?.kind;
  if (kind === "product-showcase" || kind === "saas-showcase") {
    // A showcase has no sign-ups and no owner area: the list is its placeholders and drafted wording.
    const ph = (brief.placeholders as { what?: string; fix?: string }[] | undefined) ?? [];
    for (const p of ph) if (p?.what) items.push(`${p.what}${p.fix ? `. ${p.fix}.` : "."}`);
    items.push("The headline, benefits, steps and FAQ were drafted from your answers. Read them and change anything that isn't right. To change anything, ask me in the chat.");
    return items;
  }
  items.push("The headline, benefits and thank-you wording were drafted for you. Read them and change anything that isn't right.");
  items.push("Images are designed placeholders. Image uploads need a Blob store connected to the site's Vercel project; until then the owner area says uploads are not available.");
  items.push("The site starts with sample sign-ups, labelled as samples. Delete them in the owner area before real use.");
  return items;
}

// ---- running the runner ----

type RunResult = { code: number; out: string };

export function runProcess(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; onLine?: (line: string) => void }): Promise<RunResult> {
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

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A picture of the top of the live site, kept in the job's log for the ready panel. Best effort: any problem means no picture,
 * and never a failed build. The site's own code is not given the worker's keys, only what a browser needs.
 */
export async function heroShot(db: Db, job: Job, runDir: string, url: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    const appDir = path.join(runDir, "app");
    const script = path.join(env.WORKER_DIR ?? path.join(process.cwd(), "worker"), "snap.mjs");
    if (!existsSync(script) || !existsSync(path.join(appDir, "package.json"))) {
      console.warn(`[hero] ${job.id.slice(0, 8)} skipped: snap.mjs or the site folder is missing (${script})`);
      return false;
    }
    const clean: NodeJS.ProcessEnv = { NODE_ENV: "production" };
    for (const k of ["PATH", "HOME", "USER", "LANG", "TMPDIR", "NODE_PATH"]) if (env[k]) clean[k] = env[k];
    const out = path.join(runDir, "hero-shot");
    // A site that was just deployed can take a few seconds to answer, so try a few times.
    for (let i = 0; i < 3; i++) {
      const r = await runProcess("node", [script, appDir, url, out, "top"], { cwd: appDir, env: clean });
      const jpg = r.code === 0 ? await readFile(path.join(out, "after.jpg")).catch(() => null) : null;
      if (jpg) {
        const entry = [{ at: new Date().toISOString(), event: "snapshot", which: "hero", mime: "image/jpeg", b64: jpg.toString("base64") }];
        await db.query(`UPDATE jobs SET log = log || $2::jsonb WHERE id = $1`, [job.id, JSON.stringify(entry)]);
        console.log(`[hero] ${job.id.slice(0, 8)} picture saved (${Math.round(jpg.length / 1024)} KB)`);
        return true;
      }
      console.warn(`[hero] ${job.id.slice(0, 8)} try ${i + 1} failed: ${tail(r.out ?? "")}`);
      await pause(5000);
    }
  } catch (e) {
    // no picture; the panel simply has no image
    console.warn(`[hero] ${job.id.slice(0, 8)} error: ${e instanceof Error ? e.message : e}`);
  }
  return false;
}

export const tail = (s: string, n = 400) => s.trim().split("\n").slice(-6).join("\n").slice(-n);

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
    // A note to the person running the builder. Not awaited: it must never slow a build down or break one.
    void notifyBuildStart(env, { kind: "started", siteName, projectUrl: projectLink(env, job.project_id), by: ownerEmail }).catch(() => {});

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

    const siteKind = (brief.site as { kind?: string } | undefined)?.kind;
    const showcasePack = siteKind === "product-showcase" || siteKind === "saas-showcase";
    const created = await runProcess(
      "npm",
      ["run", "create", "--", `A ${showcasePack ? "product showcase" : "waitlist"} website for ${siteName}`, "--specs", `vertical-packs/${showcasePack ? "product-showcase" : "site"}/specs`, "--brief", path.relative(runner, briefFile)],
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
    // Kept so a failed publish can be retried without building the site again.
    await patchSiteBuild(db, job.project_id, { runDir: runDir! }).catch(() => {});

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

    await publishSite(db, job, { runner, runDir: runDir!, siteName, ownerEmail, brief, env, setStage, stop, fallbackBuild: start.site!.build! });
  } finally {
    clearInterval(heartbeat);
    if (filesTimer) clearInterval(filesTimer);
  }
}

type PublishCtx = {
  runner: string;
  runDir: string;
  siteName: string;
  ownerEmail: string;
  brief: Record<string, unknown>;
  env: NodeJS.ProcessEnv;
  setStage: (n: number) => void;
  stop: (at: number, message: string) => Promise<never>;
  fallbackBuild: SiteBuild;
};

/** Steps 3 and 4: put the finished site online, then write the result and the ready card. Shared by a full build and a publish retry. */
async function publishSite(db: Db, job: Job, c: PublishCtx) {
  const { runner, runDir, siteName, ownerEmail, brief, env, setStage, stop, fallbackBuild } = c;
  // 3. Publish. A name that is taken makes deploy stop before it changes anything, so the next candidate is safe to try.
  setStage(4);
  const staticSite = ["product-showcase", "saas-showcase"].includes((brief.site as { kind?: string } | undefined)?.kind ?? "");
  // A showcase has no owner area, so no sign-in email and no password.
  const password = staticSite ? "" : randomBytes(12).toString("base64url");
  let url: string | null = null;
  let lastOut = "";
  for (const name of nameCandidates(siteName)) {
    const deployed = await runProcess("npm", ["run", "deploy", "--", path.relative(runner, runDir), "--name", name, ...(staticSite ? [] : ["--email", ownerEmail])], {
      cwd: runner,
      env: staticSite ? env : { ...env, ADMIN_PASSWORD: password },
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
  if (!url) await stop(4, `Publishing did not work. ${tail(password ? lastOut.split(password).join("***") : lastOut)}`);

  // 4. Done: take a picture of the top of the live site for the ready panel, write the result and tell the person in the chat.
  const heroOk = await heroShot(db, job, runDir, url!, env);
  const { rows: now } = await db.query(`SELECT state FROM projects WHERE id = $1`, [job.project_id]);
  const s = now[0].state as WorkspaceState;
  const build: SiteBuild = { ...(s.site?.build ?? fallbackBuild), stage: DONE_STAGE, finishedAt: new Date().toISOString(), url: url!, ...(heroOk ? { heroJobId: job.id } : {}), ...(staticSite ? {} : { adminUrl: `${url}/admin/sign-in`, ownerEmail }) };
  const done: WorkspaceState = {
    ...s,
    phase: "summary",
    jobId: null,
    msgs: [
      ...s.msgs,
      { id: s.nextId, kind: "site_ready", name: siteName, url: url!, ...(staticSite ? {} : { adminUrl: build.adminUrl!, ownerEmail, password }), checks: checklist(brief) },
      { id: s.nextId + 1, kind: "bot", text: "Your site is live. Ask me anything about the page, or tell me what to change, for example “make the closing headline shorter”. I'll show you before and after." },
    ],
    nextId: s.nextId + 2,
    site: { brief: s.site!.brief, build },
  };
  await db.query(`UPDATE projects SET state = $2, status = 'ready', updated_at = now() WHERE id = $1`, [job.project_id, JSON.stringify(done)]);
  // The email is a courtesy, sent after everything is saved. It must never fail the build.
  await notifyBuildEnd(env, build.notifyEmail, { kind: "done", siteName, projectUrl: projectLink(env, job.project_id), siteUrl: url!, showcase: staticSite }).catch(() => {});
}

/**
 * Retry a publish that failed: the site is already built (its folder is saved in site.build.runDir), so only
 * the deploy runs again. No model calls, no cost cap needed.
 */
export async function runSitePublish(db: Db, job: Job, env: NodeJS.ProcessEnv = process.env) {
  const runner = env.RUNNER_DIR;
  if (!runner) throw new Error("RUNNER_DIR is not set on the worker, so it cannot find the runner.");
  const { rows } = await db.query(
    `SELECT p.state AS state, u.email AS email FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [job.project_id],
  );
  const start = rows[0]?.state as WorkspaceState | undefined;
  const ownerEmail = String(rows[0]?.email ?? "");
  const brief = start?.site?.brief;
  const runDir = start?.site?.build?.runDir;
  if (!start || !brief || !ownerEmail) throw new Error("The project has no saved brief or no owner.");
  const siteName = briefCard(brief).name || "site";

  const heartbeat = setInterval(() => void patchSiteBuild(db, job.project_id, { heartbeatAt: new Date().toISOString() }).catch(() => {}), Number(env.WORKER_HEARTBEAT_MS ?? 10000));
  const setStage = (n: number) => void patchSiteBuild(db, job.project_id, { stage: n }).catch(() => {});
  const stop = async (at: number, message: string): Promise<never> => {
    await patchSiteBuild(db, job.project_id, { failedStage: at, error: message.slice(0, 300) }).catch(() => {});
    throw new BuildStop(message);
  };
  try {
    await patchSiteBuild(db, job.project_id, { stage: 4, heartbeatAt: new Date().toISOString() });
    if (!runDir || !existsSync(path.join(runDir, "app"))) {
      // The built site is gone (a fresh worker disk, say). Forget it, so the button goes back to a full rebuild.
      await patchSiteBuild(db, job.project_id, { runDir: "" }).catch(() => {});
      await stop(1, "The finished site is no longer on the worker, so it has to be built again.");
    }
    await publishSite(db, job, { runner, runDir: runDir!, siteName, ownerEmail, brief, env, setStage, stop, fallbackBuild: start.site!.build! });
  } finally {
    clearInterval(heartbeat);
  }
}

export const stageLabel = (n: number) => SITE_STAGES[Math.min(Math.max(n, 0), DONE_STAGE)].label;
