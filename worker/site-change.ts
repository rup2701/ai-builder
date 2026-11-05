/**
 * "Change my site": the owner asks for a change in the chat, and this job makes it on the live site.
 *
 * Order: photograph the live page, run the runner's `change --site`, check it, put it live with `deploy --redeploy`,
 * photograph the changed section, and write the result into the chat message that asked for it.
 * A change that fails its checks, or does not publish, is rolled back, so the live site stays as it was.
 * This job never throws for a failed change: it records the failure on the message and returns { ok: false }.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSummary, runProcess, tail, type Db, type Job } from "./site-build";
import type { Msg, WorkspaceState } from "../src/lib/workspace/types";

export type SiteChangeMsg = Extract<Msg, { kind: "site_change" }>;
export type ChangeResult = { ok: boolean; error?: string };

// ---- small pure helpers (tested) ----

/** The agent ends its last reply with "VIEW: #section-id" or "VIEW: top". Returns the plain sentence(s) and the anchor (no #). */
export function parseFinal(text: string): { summary: string; anchor: string } {
  const m = /^\s*VIEW:\s*#?([A-Za-z][\w-]*|top)\s*$/im.exec(text);
  const anchor = m ? m[1].toLowerCase() === "top" ? "top" : m[1] : "top";
  const summary = text.replace(/^\s*VIEW:.*$/gim, "").replace(/\s+/g, " ").trim().slice(0, 500);
  return { summary, anchor };
}

/** The last `final` line of the run's transcript (one JSON object per line). */
export function lastFinal(transcript: string): string {
  const lines = transcript.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"final"')) continue;
    try {
      const j = JSON.parse(lines[i]) as { final?: unknown };
      if (typeof j.final === "string") return j.final;
    } catch {
      /* a half-written line: keep looking */
    }
  }
  return "";
}

/** Replace one chat message in a saved state. Returns the same state when the message is not there. */
export function patchChangeMsg(s: WorkspaceState, jobId: string, patch: Partial<SiteChangeMsg>): WorkspaceState {
  return { ...s, msgs: s.msgs.map((m) => (m.kind === "site_change" && m.jobId === jobId ? ({ ...m, ...patch } as Msg) : m)) };
}

async function setMsg(db: Db, projectId: string, jobId: string, patch: Partial<SiteChangeMsg>) {
  const { rows } = await db.query(`SELECT state FROM projects WHERE id = $1`, [projectId]);
  if (!rows[0]) return;
  const next = patchChangeMsg(rows[0].state as WorkspaceState, jobId, patch);
  await db.query(`UPDATE projects SET state = $2, updated_at = now() WHERE id = $1`, [projectId, JSON.stringify(next)]);
}

/** For a change cut off by a restart: say so on the message, without the build-failure wording `fail` uses. */
export async function failSiteChangeMsg(db: Db, job: Job, message: string) {
  await setMsg(db, job.project_id, job.id, { status: "failed", error: message.slice(0, 300) }).catch(() => {});
}

const run = (cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => runProcess(cmd, args, { cwd, env });

async function snap(appDir: string, url: string, outDir: string, anchor: string | undefined, env: NodeJS.ProcessEnv): Promise<boolean> {
  const script = path.join(env.WORKER_DIR ?? path.join(process.cwd(), "worker"), "snap.mjs");
  if (!existsSync(script)) return false;
  const r = await run("node", [script, appDir, url, outDir, ...(anchor ? [anchor] : [])], appDir, env);
  return r.code === 0;
}

const b64 = async (file: string) => (existsSync(file) ? (await readFile(file)).toString("base64") : null);

export async function runSiteChange(db: Db, job: Job, env: NodeJS.ProcessEnv = process.env): Promise<ChangeResult> {
  const runner = env.RUNNER_DIR;
  const tmp = path.join(os.tmpdir(), `site-change-${job.id}`);
  // The owner sees the plain message; the job record also keeps the technical detail.
  const bad = async (message: string, detail = ""): Promise<ChangeResult> => {
    await failSiteChangeMsg(db, job, message);
    return { ok: false, error: detail ? `${message} [${detail.slice(0, 400)}]` : message };
  };
  try {
    if (!runner) return await bad("The worker cannot find the runner, so it cannot change the site.");
    const { rows } = await db.query(`SELECT state FROM projects WHERE id = $1`, [job.project_id]);
    const state = rows[0]?.state as WorkspaceState | undefined;
    const msg = state?.msgs.find((m): m is SiteChangeMsg => m.kind === "site_change" && m.jobId === job.id);
    const runDir = state?.site?.build?.runDir;
    const url = state?.site?.build?.url;
    if (!msg || !runDir || !url) return await bad("This site has no saved build to change.");
    const appDir = path.join(runDir, "app");
    if (!existsSync(appDir)) return await bad("The finished site is no longer on the worker, so it cannot be changed. It has to be built again.");

    await setMsg(db, job.project_id, job.id, { status: "working" });
    await mkdir(tmp, { recursive: true });
    const cleanEnv = { ...env };

    // 1. Before: one picture per section of the live page. Best effort; a change never waits on a picture.
    const beforeDir = path.join(tmp, "before");
    await snap(appDir, url, beforeDir, undefined, cleanEnv).catch(() => false);

    // 2. Remember where the code is, so a bad change can be rolled back.
    const head = (await run("git", ["-C", appDir, "rev-parse", "HEAD"], appDir, cleanEnv)).out.trim();
    const rollback = async () => {
      if (!/^[0-9a-f]{7,40}$/.test(head)) return;
      await run("git", ["-C", appDir, "reset", "--hard", head], appDir, cleanEnv);
      await run("git", ["-C", appDir, "clean", "-fd"], appDir, cleanEnv);
    };

    // 3. The change itself. The instruction goes before --site: the runner reads the word after a flag as that flag's value.
    const rel = path.relative(runner, runDir);
    const changed = await runProcess("npm", ["run", "change", "--", rel, msg.instruction, "--site"], {
      cwd: runner,
      env: { ...env, RUNNER_MAX_COST_USD: env.WORKER_CHANGE_MAX_USD ?? "3", RUNNER_MAX_TURNS: env.WORKER_CHANGE_MAX_TURNS ?? "90" },
    });
    const summary = parseSummary(changed.out);
    if (changed.code !== 0 || !summary) {
      await rollback();
      return await bad("The change did not finish, so I undid it. Your site is unchanged.", tail(changed.out, 300));
    }
    if (summary.stopReason !== "finished") {
      await rollback();
      return await bad(`The change stopped early (${summary.stopReason}), so I undid it. Your site is unchanged.`);
    }
    if (!summary.checks?.typecheck || !summary.checks?.build) {
      await rollback();
      return await bad("The change did not pass the checks, so I undid it. Your site is unchanged.");
    }
    const t = summary.tokens ?? {};
    await db
      .query(`INSERT INTO usage (project_id, job_id, step, model, input_tokens, output_tokens, cost_usd) VALUES ($1, $2, 'site_change', $3, $4, $5, $6)`, [
        job.project_id,
        job.id,
        summary.model ?? "unknown",
        (t.input ?? 0) + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0),
        t.output ?? 0,
        summary.estimatedCostUsd ?? 0,
      ])
      .catch(() => {});

    // 4. Put it live. If publishing fails, the old site is still what visitors see; put the code back to match.
    const deployed = await runProcess("npm", ["run", "deploy", "--", rel, "--redeploy"], { cwd: runner, env });
    if (deployed.code !== 0) {
      await rollback();
      return await bad("The change was made but did not publish, so I undid it. Your site is unchanged.", tail(deployed.out, 300));
    }

    // 5. After: the section that changed, and the matching "before".
    const transcript = await readFile(path.join(runDir, "transcript.jsonl"), "utf8").catch(() => "");
    const { summary: said, anchor } = parseFinal(lastFinal(transcript));
    await new Promise((r) => setTimeout(r, 4000)); // let the new version reach visitors
    const afterDir = path.join(tmp, "after");
    const okAfter = await snap(appDir, url, afterDir, anchor, cleanEnv).catch(() => false);
    const before = (await b64(path.join(beforeDir, `${anchor}.jpg`))) ?? (anchor === "top" ? await b64(path.join(beforeDir, "top.jpg")) : null);
    const after = okAfter ? await b64(path.join(afterDir, "after.jpg")) : null;
    const log = [
      ...(before ? [{ at: new Date().toISOString(), event: "snapshot", which: "before", anchor, mime: "image/jpeg", b64: before }] : []),
      ...(after ? [{ at: new Date().toISOString(), event: "snapshot", which: "after", anchor, mime: "image/jpeg", b64: after }] : []),
    ];
    if (log.length) await db.query(`UPDATE jobs SET log = log || $2::jsonb WHERE id = $1`, [job.id, JSON.stringify(log)]);

    await setMsg(db, job.project_id, job.id, {
      status: "done",
      summary: said || "The change is live.",
      snaps: { before: Boolean(before), after: Boolean(after) },
      anchor,
    });
    return { ok: true };
  } catch (e) {
    return await bad(e instanceof Error ? e.message : String(e));
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
