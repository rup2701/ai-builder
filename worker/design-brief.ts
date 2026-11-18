/**
 * The design brief in a showcase build. Runs after the interview and before the runner is called.
 *   1. APP-49: a brief written at review is used when it passed and was made from the same chat and brief (fingerprint).
 *      One still being written for the same chat and brief is waited for, up to WORKER_DESIGN_BRIEF_WAIT_MS (2 minutes).
 *   2. Otherwise the brief is written now, as in APP-42 step 1, and saved on the project like one from review.
 * It never fails or stops a build: no key, an error, a time-out or a brief that fails its checks all mean the build goes on
 * without a design brief, and the build record says why.
 *   WORKER_DESIGN_BRIEF=off            skips the step
 *   ANTHROPIC_DESIGN_BRIEF_MODEL       the model for this step only (default Opus)
 *   WORKER_DESIGN_BRIEF_MS             time limit for writing it here, both attempts (default 2 minutes). On a time-out the
 *                                      build goes on without the design brief, and the record's error says so.
 */
import { writeFile } from "node:fs/promises";
import type { DesignBriefResult, ToolCall } from "../src/lib/agents/design-brief-writer";
import { designBriefInput, runDesignBriefStep } from "../src/lib/agents/design-brief-step";
import { finished, newToken, savedBriefForBuild, writeDesignBriefIf, type Db, type SavedDesignBrief } from "../src/lib/design-brief-store";

/** The whole step, both attempts, gets two minutes unless WORKER_DESIGN_BRIEF_MS says otherwise. */
export const DESIGN_BRIEF_LIMIT_MS = 120_000;
/** How long a build waits for a brief that review is still writing. */
export const DESIGN_BRIEF_WAIT_MS = 120_000;

/** What the build record keeps under details.designBrief. source says whether it was written at review or here. */
export type DesignBriefRecord =
  | (DesignBriefResult & { passedToRunner: boolean; file: string | null; skipped: null; fingerprint: string; source: "review" | "build_start"; waitedMs?: number })
  | { skipped: string; passedToRunner: false; fingerprint?: string | null };

async function writeMd(file: string, markdown: string): Promise<string | null> {
  try {
    await writeFile(file, markdown);
    return file;
  } catch {
    return null;
  }
}

/** Writes the brief now (APP-42 step 1). The markdown goes to file only when the brief passed. */
export async function designBriefStep(opts: { msgs: unknown; brief: Record<string, unknown>; file: string; env: NodeJS.ProcessEnv; call?: ToolCall }): Promise<DesignBriefRecord> {
  const { env } = opts;
  if (env.WORKER_DESIGN_BRIEF === "off") return { skipped: "switched off (WORKER_DESIGN_BRIEF=off)", passedToRunner: false };
  const r = await runDesignBriefStep({
    msgs: opts.msgs, brief: opts.brief, env, call: opts.call,
    limitMs: Number(env.WORKER_DESIGN_BRIEF_MS ?? DESIGN_BRIEF_LIMIT_MS), timeoutNote: "so the build went on without a design brief",
  });
  if (r.skipped !== null) return { skipped: r.skipped === "no ANTHROPIC_API_KEY" ? "no ANTHROPIC_API_KEY on the worker" : r.skipped, passedToRunner: false, fingerprint: r.fingerprint };
  let file: string | null = null;
  if (r.passed && r.markdown) {
    file = await writeMd(opts.file, r.markdown);
    if (!file) r.error = "could not write the file";
  }
  return { ...r, passedToRunner: file !== null, file, source: "build_start" };
}

/**
 * At build start: use the brief saved at review when it fits, else write one now and save it on the project. Never throws.
 * db is the worker's pool; the saved brief lives in projects.design_brief (src/lib/design-brief-store.ts).
 */
export async function designBriefForBuild(opts: {
  db: Db;
  projectId: string;
  msgs: unknown;
  brief: Record<string, unknown>;
  file: string;
  env: NodeJS.ProcessEnv;
  call?: ToolCall;
  sleep?: (ms: number) => Promise<void>;
}): Promise<DesignBriefRecord> {
  const { db, projectId, env } = opts;
  if (env.WORKER_DESIGN_BRIEF === "off") return { skipped: "switched off (WORKER_DESIGN_BRIEF=off)", passedToRunner: false };
  const input = designBriefInput(opts.msgs, opts.brief);
  const { fingerprint, upToMsg } = input;
  const found = await savedBriefForBuild({ db, projectId, input: { messages: input.messages, brief: opts.brief }, waitMs: Number(env.WORKER_DESIGN_BRIEF_WAIT_MS ?? DESIGN_BRIEF_WAIT_MS), sleep: opts.sleep });
  const fromReview = found.use?.result;
  if (fromReview && fromReview.skipped === null && fromReview.markdown) {
    const file = await writeMd(opts.file, fromReview.markdown);
    if (file) return { ...fromReview, passedToRunner: true, file, source: "review", waitedMs: found.waitedMs };
  }

  const rec = await designBriefStep(opts);
  // Saved on the project like a brief from review, so the Builder can show it. Best effort: a failed save changes nothing.
  if (rec.skipped === null) {
    const at = new Date();
    const claim: SavedDesignBrief = { v: 1, fingerprint, upToMsg, status: "writing", token: newToken(), by: "build_start", startedAt: at.toISOString(), finishedAt: null, reason: null, result: null };
    const { passedToRunner: _p, file: _f, source: _s, waitedMs: _w, ...result } = rec;
    await writeDesignBriefIf(db, projectId, found.saved?.token ?? null, finished(claim, result, at)).catch(() => false);
  }
  return found.waitedMs > 0 && rec.skipped === null ? { ...rec, waitedMs: found.waitedMs } : rec;
}
