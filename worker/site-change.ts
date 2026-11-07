/**
 * "Change my site": the owner asks for a change in the chat; this job makes it, shows a preview, and publishes only when the owner approves.
 *
 * One chat message (kind "site_change") carries the whole story, and its `action` says what a job does next:
 *   make     photograph the live page, run the runner's `change --site`, require typecheck and build to pass, start the changed
 *            site locally, photograph the section that changed, and stop at "review". Nothing is live yet.
 *   publish  `deploy --redeploy`. If it does not publish, the message goes back to "review" and the live site is untouched.
 *   discard  put the code back to how it was before the change ("remove this change").
 * A revision ("ask for changes") is another `make` on top of the earlier change, with the owner's feedback added.
 * These jobs never throw for a failed change: they record it on the message and return { ok: false }.
 */
import { spawn } from "node:child_process";
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
  const anchor = m ? (m[1].toLowerCase() === "top" ? "top" : m[1]) : "top";
  const whole = text.replace(/^\s*VIEW:.*$/gim, "").replace(/\s+/g, " ").trim();
  // Never end mid-sentence: cut at the last full stop inside the limit.
  const cut = whole.slice(0, 500);
  const summary = whole.length <= 500 ? whole : cut.slice(0, cut.lastIndexOf(". ") + 1 || 500);
  return { summary, anchor };
}

/** True when the agent's closing reply reads like plain words for a site owner: short, no code, files, colour codes or commands. */
export function isPlainSummary(s: string): boolean {
  if (!s || s.length > 320) return false;
  if ((s.match(/[.!?](\s|$)/g) ?? []).length > 3) return false;
  if (/[`{}<>]/.test(s)) return false;
  if (/#[0-9a-f]{3,8}\b/i.test(s)) return false;
  if (/\b[\w-]+\.(md|mts|ts|tsx|js|css|json)\b/i.test(s)) return false;
  if (/\b(npm|npx|tsc|e2e|tailwind|classname|git|commit|specs?\/|look\.md|\d+\s?px|\d+\s?rem)\b/i.test(s)) return false;
  return true;
}

/** What the card shows after a change: the agent's own words when they are plain, otherwise the plain result lines Scout showed in the plan. */
export function ownerSummary(said: string, changes?: string[]): string {
  if (isPlainSummary(said)) return said;
  const lines = (changes ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 2);
  return lines.length ? lines.map((l) => (/[.!?]$/.test(l) ? l : `${l}.`)).join(" ") : "The change is ready.";
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

/** What the agent is told. A first change is the owner's request. A revision adds the owner's feedback on the change already made. */
export function instructionFor(m: Pick<SiteChangeMsg, "instruction" | "feedback">): string {
  if (!m.feedback) return m.instruction;
  return `${m.instruction}. You already made this change and committed it; it is not live yet. The owner looked at the preview and asks for this revision: ${m.feedback}`;
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

/** For a job cut off by a restart or a crash: say so on the message, without the build-failure wording `fail` uses. */
export async function failSiteChangeMsg(db: Db, job: Job, message: string) {
  const { rows } = await db.query(`SELECT state FROM projects WHERE id = $1`, [job.project_id]).catch(() => ({ rows: [] as { state: WorkspaceState }[] }));
  const m = (rows[0]?.state as WorkspaceState | undefined)?.msgs.find((x): x is SiteChangeMsg => x.kind === "site_change" && x.jobId === job.id);
  // A change that was already shown in a preview goes back to the preview; its code is still on the worker.
  const back = m && (m.action === "publish" || (m.action === "make" && m.feedback)) ? { status: "review" as const, note: message.slice(0, 300) } : { status: "failed" as const, error: message.slice(0, 300) };
  await setMsg(db, job.project_id, job.id, { ...back, action: undefined }).catch(() => {});
}

const run = (cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => runProcess(cmd, args, { cwd, env });

async function snap(appDir: string, url: string, outDir: string, anchor: string | undefined, env: NodeJS.ProcessEnv): Promise<boolean> {
  const script = path.join(env.WORKER_DIR ?? path.join(process.cwd(), "worker"), "snap.mjs");
  if (!existsSync(script)) return false;
  const r = await run("node", [script, appDir, url, outDir, ...(anchor ? [anchor] : [])], appDir, env);
  return r.code === 0;
}

/**
 * The changed site, before it is live: start the built site on a spare port with a clean environment (no tokens, no keys),
 * photograph the section, and stop it. The site was just built by the runner's checks, so `next start` has what it needs.
 */
async function previewSnap(appDir: string, outDir: string, anchor: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const next = path.join(appDir, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(next)) return false;
  const port = 3200 + Math.floor(Math.random() * 600);
  const clean: NodeJS.ProcessEnv = { NODE_ENV: "production", PORT: String(port) };
  for (const k of ["PATH", "HOME", "USER", "LANG", "TMPDIR", "NODE_PATH"]) if (env[k]) clean[k] = env[k];
  const child = spawn("node", [next, "start", "-p", String(port)], { cwd: appDir, env: clean, stdio: "ignore", detached: true });
  try {
    const url = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500));
      up = await fetch(url).then((r) => r.ok, () => false);
    }
    return up ? await snap(appDir, url, outDir, anchor, env) : false;
  } finally {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

const b64 = async (file: string) => (existsSync(file) ? (await readFile(file)).toString("base64") : null);

const SAFE_SHA = /^[0-9a-f]{7,40}$/;

export async function runSiteChange(db: Db, job: Job, env: NodeJS.ProcessEnv = process.env): Promise<ChangeResult> {
  const runner = env.RUNNER_DIR;
  const tmp = path.join(os.tmpdir(), `site-change-${job.id}`);
  let action: "make" | "publish" | "discard" = "make";
  let isRevision = false;
  let beforeShot: Promise<boolean> = Promise.resolve(false);
  // The owner sees the plain message; the job record also keeps the technical detail.
  const bad = async (message: string, detail = ""): Promise<ChangeResult> => {
    await setMsg(db, job.project_id, job.id, { status: "failed", error: message.slice(0, 300), action: undefined });
    return { ok: false, error: detail ? `${message} [${detail.slice(0, 400)}]` : message };
  };
  // A failure after the owner has already seen a preview puts them back at the preview, with a line saying what happened.
  const backToReview = async (message: string, detail = ""): Promise<ChangeResult> => {
    await setMsg(db, job.project_id, job.id, { status: "review", note: message.slice(0, 300), action: undefined });
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
    action = msg.action ?? "make";
    isRevision = Boolean(msg.feedback);
    const rel = path.relative(runner, runDir);
    const cleanEnv = { ...env };

    const gitHead = async () => (await run("git", ["-C", appDir, "rev-parse", "HEAD"], appDir, cleanEnv)).out.trim();
    const rollbackTo = async (sha: string | undefined) => {
      if (!sha || !SAFE_SHA.test(sha)) return false;
      await run("git", ["-C", appDir, "reset", "--hard", sha], appDir, cleanEnv);
      await run("git", ["-C", appDir, "clean", "-fd"], appDir, cleanEnv); // ignored files (node_modules, .env, .next) stay
      return true;
    };

    /** Put the committed code live. Returns null when it worked, or what went wrong. */
    const deployNow = async (): Promise<string | null> => {
      await run("git", ["-C", appDir, "reset", "--hard", "HEAD"], appDir, cleanEnv);
      await run("git", ["-C", appDir, "clean", "-fd"], appDir, cleanEnv);
      const deployed = await runProcess("npm", ["run", "deploy", "--", rel, "--redeploy"], { cwd: runner, env });
      return deployed.code === 0 ? null : tail(deployed.out, 300);
    };

    // ---- remove this change (or undo it, when it is already live) ----
    if (action === "discard") {
      const wasLive = msg.published === true;
      const kept = wasLive ? await gitHead() : "";
      if (!(await rollbackTo(msg.baseHead))) {
        const note = "I could not find the code from before this change, so I left it as it is.";
        if (wasLive) { await setMsg(db, job.project_id, job.id, { status: "done", note, action: undefined }); return { ok: false, error: note }; }
        return await backToReview(note);
      }
      if (wasLive) {
        const failed = await deployNow();
        if (failed !== null) {
          await rollbackTo(kept); // the live site still has the change, so keep the code that matches it
          const note = "I could not undo it, so your live site is unchanged. You can try again.";
          await setMsg(db, job.project_id, job.id, { status: "done", note, action: undefined });
          return { ok: false, error: `${note} [${failed}]` };
        }
      }
      await setMsg(db, job.project_id, job.id, { status: "removed", action: undefined, note: undefined, published: undefined });
      return { ok: true };
    }

    // ---- publish the change the owner approved ----
    if (action === "publish") {
      await setMsg(db, job.project_id, job.id, { status: "publishing" });
      // Publish what the owner saw: the last commit, without leftovers from a revision that was cut off.
      const failed = await deployNow();
      if (failed !== null) return await backToReview("It did not publish. Your live site is unchanged. You can try again, or remove the change.", failed);
      await setMsg(db, job.project_id, job.id, { status: "done", published: true, action: undefined, note: undefined });
      return { ok: true };
    }

    // ---- make the change (or revise it) ----
    await setMsg(db, job.project_id, job.id, { status: "working" });
    await mkdir(tmp, { recursive: true });

    // 1. Before: one picture per section of the live page (which is still the old version). Best effort, and it runs
    // alongside the agent's first minutes of reading, so it adds no waiting time. It is awaited before the pictures are read.
    const beforeDir = path.join(tmp, "before");
    // A small wording change gets no pictures at all, which also saves the time they take.
    const wantPictures = msg.size !== "small";
    if (wantPictures) beforeShot = snap(appDir, url, beforeDir, undefined, cleanEnv).catch(() => false);

    // 2. Remember where the code is: the start of this job (a failed revision returns here) and the start of the whole change.
    const startHead = await gitHead();
    const baseHead = msg.baseHead && SAFE_SHA.test(msg.baseHead) ? msg.baseHead : startHead;

    // 3. The change. The instruction goes before --site: the runner reads the word after a flag as that flag's value.
    const changed = await runProcess("npm", ["run", "change", "--", rel, instructionFor(msg), "--site"], {
      cwd: runner,
      env: { ...env, RUNNER_MAX_COST_USD: env.WORKER_CHANGE_MAX_USD ?? "3", RUNNER_MAX_TURNS: env.WORKER_CHANGE_MAX_TURNS ?? "90" },
    });
    const undoAndFail = async (message: string, detail = "") => {
      await rollbackTo(startHead);
      return isRevision ? await backToReview(`${message} The earlier version of the change is still in the preview.`, detail) : await bad(`${message} Your site is unchanged.`, detail);
    };
    const summary = parseSummary(changed.out);
    if (changed.code !== 0 || !summary) return await undoAndFail("The change did not finish, so I undid it.", tail(changed.out, 300));
    if (summary.stopReason !== "finished") return await undoAndFail(`The change stopped early (${summary.stopReason}), so I undid it.`);
    if (!summary.checks?.typecheck || !summary.checks?.build) return await undoAndFail("The change did not pass the checks, so I undid it.");
    // The agent must have changed the page. Edits it left uncommitted are saved as a commit (publishing would otherwise discard them);
    // a run that changed nothing is reported as such, never as a change.
    const leftover = (await run("git", ["-C", appDir, "status", "--porcelain", "--", "src", "public"], appDir, cleanEnv)).out.trim();
    if (leftover) {
      // One folder at a time: git stops on a folder that does not exist.
      for (const dir of ["src", "public"]) if (existsSync(path.join(appDir, dir))) await run("git", ["-C", appDir, "add", "-A", "--", dir], appDir, cleanEnv);
      await run("git", ["-C", appDir, "-c", "user.email=builder@appnomics.dev", "-c", "user.name=Appnomics", "commit", "-qm", "Change: save edits left uncommitted"], appDir, cleanEnv);
    }
    if ((await gitHead()) === startHead) return await undoAndFail("I could not find a way to make that change, so nothing was changed on your site.");
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

    // 4. Preview: the changed section, from the site started locally. Nothing is live.
    const transcript = await readFile(path.join(runDir, "transcript.jsonl"), "utf8").catch(() => "");
    const { summary: said, anchor } = parseFinal(lastFinal(transcript));
    const afterDir = path.join(tmp, "after");
    const okAfter = wantPictures ? await previewSnap(appDir, afterDir, anchor, cleanEnv).catch(() => false) : false;
    await beforeShot;
    const before = (await b64(path.join(beforeDir, `${anchor}.jpg`))) ?? (anchor === "top" ? await b64(path.join(beforeDir, "top.jpg")) : null);
    const after = okAfter ? await b64(path.join(afterDir, "after.jpg")) : null;
    const log = [
      ...(before ? [{ at: new Date().toISOString(), event: "snapshot", which: "before", anchor, mime: "image/jpeg", b64: before }] : []),
      ...(after ? [{ at: new Date().toISOString(), event: "snapshot", which: "after", anchor, mime: "image/jpeg", b64: after }] : []),
    ];
    if (log.length) await db.query(`UPDATE jobs SET log = log || $2::jsonb WHERE id = $1`, [job.id, JSON.stringify(log)]);

    const fields = {
      action: undefined,
      baseHead,
      feedback: undefined,
      note: after || !wantPictures ? undefined : "I could not make a preview picture, but the change passed its checks.",
      summary: ownerSummary(said, msg.changes),
      snaps: { before: Boolean(before), after: Boolean(after) },
      snapJobId: log.length ? job.id : undefined,
      anchor,
    };
    // A small wording change goes live as soon as it is made. If publishing fails, it waits in the preview instead.
    if (msg.size === "small" && !isRevision) {
      await setMsg(db, job.project_id, job.id, { ...fields, status: "publishing" });
      const failed = await deployNow();
      if (failed === null) {
        await setMsg(db, job.project_id, job.id, { status: "done", published: true, note: undefined });
        return { ok: true };
      }
      await setMsg(db, job.project_id, job.id, { status: "review", note: "It did not publish, so your live site is unchanged. You can approve it to try again, or remove it." });
      return { ok: false, error: `It did not publish. [${failed}]` };
    }
    await setMsg(db, job.project_id, job.id, { ...fields, status: "review" });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return action === "publish" || (action === "make" && isRevision) ? await backToReview(message) : await bad(message);
  } finally {
    await beforeShot.catch(() => false); // never delete the folder while the picture is still being taken
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
