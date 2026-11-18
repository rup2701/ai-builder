/**
 * The design brief saved on the project (APP-49): projects.design_brief, apart from state, so the whole-state writers never
 * drop it and the browser never polls it. Written at review by the web app, read (and written as a fallback) at build start
 * by the worker. Every write is a compare-and-set on the row's token, so two writers never overwrite each other.
 *
 *   writing   a step is running. Older than WRITING_STALE_MS means it died (a lost background task) and counts as failed.
 *   done      the step finished and the brief passed every check. Only this is ever used for a build.
 *   failed    the step finished without a brief that passed: an error, a time-out, failing checks or no key. Kept for review.
 *
 * Nothing here is shown to the owner. A failure at review only means the worker writes the brief at build start, as before.
 */
import { randomBytes } from "node:crypto";
import { runDesignBriefStep, designBriefInput, type StepOutcome } from "@/lib/agents/design-brief-step";
import type { ToolCall } from "@/lib/agents/design-brief-writer";
import { designBriefFingerprint, type InterviewMessage } from "@/lib/builder/design-brief";

/** The part of pg's Pool used here, so tests can pass a stand-in. */
export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** A brief still "writing" after this long is treated as failed: nobody waits on it and a new one may start. */
export const WRITING_STALE_MS = 180_000;

export type SavedDesignBrief = {
  v: 1;
  /** designBriefFingerprint of the owner's messages up to upToMsg, and the brief. */
  fingerprint: string;
  /** The owner's last message the brief read. Later owner messages do not make it stale; a changed brief does. */
  upToMsg: number | null;
  status: "writing" | "done" | "failed";
  /** Changes on every write. A write only lands if the row still has the token the writer read. */
  token: string;
  /** review: written by the web app after the owner approved the brief. build_start: written by the worker. */
  by: "review" | "build_start";
  startedAt: string;
  finishedAt: string | null;
  /** Why a failed brief failed, in a few words. */
  reason: string | null;
  /** The step's whole result (JSON, markdown, quote check, cost), once it finished. */
  result: StepOutcome | null;
};

export const newToken = () => randomBytes(8).toString("hex");

/** The chat and brief a saved brief is compared with. */
export type BriefInput = { messages: InterviewMessage[]; brief: Record<string, unknown> };

/** Whether a saved brief was made from this chat (up to its last owner message) and this brief. */
export const madeFrom = (saved: SavedDesignBrief, input: BriefInput) => designBriefFingerprint(input.messages, input.brief, saved.upToMsg) === saved.fingerprint;

/**
 * What a build does with what is saved: use it (it passed and was made from the same chat and brief), wait for it (one is
 * being written for the same chat and brief, and is not stale), or write a new one.
 */
export function decide(saved: SavedDesignBrief | null, input: BriefInput, now: number): "use" | "wait" | "write" {
  if (!saved || !madeFrom(saved, input)) return "write";
  if (saved.status === "done" && saved.result && saved.result.skipped === null && saved.result.passed && saved.result.markdown) return "use";
  if (saved.status === "writing" && now - Date.parse(saved.startedAt) < WRITING_STALE_MS) return "wait";
  return "write";
}

/**
 * Whether review should start a brief. Not when one for the same chat and brief is done, failed or being written: the same
 * input would cost again for nothing, and a build start writes a new one anyway if that one is not usable.
 */
export function shouldStartAtReview(saved: SavedDesignBrief | null, input: BriefInput, now: number): boolean {
  if (!saved || !madeFrom(saved, input)) return true;
  if (saved.status === "writing") return now - Date.parse(saved.startedAt) >= WRITING_STALE_MS;
  return false;
}

export async function readDesignBrief(db: Db, projectId: string): Promise<SavedDesignBrief | null> {
  const { rows } = await db.query(`SELECT design_brief FROM projects WHERE id = $1`, [projectId]);
  const v = rows[0]?.design_brief as SavedDesignBrief | null | undefined;
  return v && typeof v === "object" && v.v === 1 ? v : null;
}

/** Writes next only if the row still holds the token expected (or no brief, when expected is null). True when it landed. */
export async function writeDesignBriefIf(db: Db, projectId: string, expected: string | null, next: SavedDesignBrief): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE projects SET design_brief = $2::jsonb WHERE id = $1 AND COALESCE(design_brief->>'token', '') = $3 RETURNING id`,
    [projectId, JSON.stringify(next), expected ?? ""],
  );
  return rows.length > 0;
}

/** The saved form of a finished step: done only when it passed, failed otherwise, with the reason. */
export function finished(claim: SavedDesignBrief, result: StepOutcome, at: Date): SavedDesignBrief {
  const ok = result.skipped === null && result.passed && !!result.markdown;
  const reason = ok
    ? null
    : result.skipped !== null
      ? result.skipped
      : result.error
        ? result.error.slice(0, 300)
        : [
            ...(result.quoteCheck?.failed ?? []).map((f) => `${f.path}: ${f.why}`),
            ...result.problems,
          ].join("; ").slice(0, 300) || "did not pass its checks";
  return { ...claim, token: newToken(), status: ok ? "done" : "failed", finishedAt: at.toISOString(), reason, result };
}

const isShowcase = (brief: Record<string, unknown> | undefined) => {
  const kind = (brief?.site as { kind?: string } | undefined)?.kind;
  return kind === "product-showcase" || kind === "saas-showcase";
};

export type ReviewOutcome = { ran: false; why: string } | { ran: true; status: "done" | "failed"; costUsd: number };

/** Waits for edits to settle before writing: a brief that changes within this time is only written once, for the latest. */
export const REVIEW_SETTLE_MS = 8_000;
/** The review step's own limit, inside the route's 120 seconds (with the settle time). */
export const REVIEW_LIMIT_MS = 100_000;

/**
 * Writes the design brief for a project that reached review (the owner approved the brief). Runs after the response, in
 * the web app. Never throws, never touches state or the chat: the owner sees nothing, whatever happens.
 *   1. The project must be a showcase site in the summary phase with a brief.
 *   2. Wait REVIEW_SETTLE_MS, then read again: if the owner changed the brief meanwhile, a newer request writes it.
 *   3. Skip when a brief for the same chat and brief is done, failed or being written.
 *   4. Claim the row (compare-and-set), run the step, save done or failed (compare-and-set on the claim's token).
 */
export async function designBriefAtReview(opts: {
  db: Db;
  projectId: string;
  env: NodeJS.ProcessEnv;
  call?: ToolCall;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  settleMs?: number;
  limitMs?: number;
}): Promise<ReviewOutcome> {
  const { db, projectId, env } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => new Date());
  if (env.DESIGN_BRIEF_AT_REVIEW === "off") return { ran: false, why: "switched off (DESIGN_BRIEF_AT_REVIEW=off)" };
  const load = async () => {
    const { rows } = await db.query(`SELECT state, archived_at FROM projects WHERE id = $1`, [projectId]);
    const r = rows[0] as { state?: { phase?: string; msgs?: unknown; site?: { brief?: Record<string, unknown> } }; archived_at?: unknown } | undefined;
    if (!r?.state) return null;
    const brief = r.state.site?.brief;
    if (r.archived_at || r.state.phase !== "summary" || !brief || !isShowcase(brief)) return null;
    return { msgs: r.state.msgs, brief, ...designBriefInput(r.state.msgs, brief) };
  };

  let claim: SavedDesignBrief | null = null;
  try {
    const first = await load();
    if (!first) return { ran: false, why: "not a showcase project waiting at review" };
    await sleep(opts.settleMs ?? REVIEW_SETTLE_MS);
    const cur = await load();
    if (!cur) return { ran: false, why: "the project left review" };
    if (cur.fingerprint !== first.fingerprint) return { ran: false, why: "the brief changed again; the newer request writes it" };
    const saved = await readDesignBrief(db, projectId);
    if (!shouldStartAtReview(saved, cur, now().getTime())) return { ran: false, why: `already ${saved?.status} for this chat and brief` };
    const next: SavedDesignBrief = { v: 1, fingerprint: cur.fingerprint, upToMsg: cur.upToMsg, status: "writing", token: newToken(), by: "review", startedAt: now().toISOString(), finishedAt: null, reason: null, result: null };
    if (!(await writeDesignBriefIf(db, projectId, saved?.token ?? null, next))) return { ran: false, why: "another request is writing it" };
    claim = next;

    const result = await runDesignBriefStep({
      msgs: cur.msgs, brief: cur.brief, env, call: opts.call,
      limitMs: opts.limitMs ?? REVIEW_LIMIT_MS, timeoutNote: "so it will be written at build start instead",
    });
    const done = finished(claim, result, now());
    await writeDesignBriefIf(db, projectId, claim.token, done);
    const cost = result.skipped === null ? result.costUsd : 0;
    if (result.skipped === null && cost > 0) {
      const t = result.tokens;
      await db
        .query(`INSERT INTO usage (project_id, job_id, step, model, input_tokens, output_tokens, cost_usd) VALUES ($1, NULL, 'design_brief_review', $2, $3, $4, $5)`, [projectId, result.model, t.input + t.cacheRead + t.cacheWrite, t.output, cost])
        .catch(() => {});
    }
    return { ran: true, status: done.status as "done" | "failed", costUsd: cost };
  } catch (e) {
    // Anything unexpected: the claim (if any) is marked failed, so a build start writes a new brief and nobody waits on it.
    const why = e instanceof Error ? e.message.slice(0, 200) : String(e);
    if (claim) {
      await writeDesignBriefIf(db, projectId, claim.token, { ...claim, token: newToken(), status: "failed", finishedAt: now().toISOString(), reason: `error: ${why}` }).catch(() => {});
      return { ran: true, status: "failed", costUsd: 0 };
    }
    return { ran: false, why: `error: ${why}` };
  }
}

/**
 * At build start: the saved brief to use, or null to write one. Waits up to waitMs for a brief being written for the same
 * chat and brief; a stale or failed one, or one made from something else, is not waited for.
 */
export async function savedBriefForBuild(opts: {
  db: Db;
  projectId: string;
  input: BriefInput;
  waitMs: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<{ use: SavedDesignBrief | null; saved: SavedDesignBrief | null; waitedMs: number }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const start = now();
  for (;;) {
    let saved: SavedDesignBrief | null = null;
    try {
      saved = await readDesignBrief(opts.db, opts.projectId);
    } catch {
      return { use: null, saved: null, waitedMs: now() - start };
    }
    const d = decide(saved, opts.input, now());
    if (d === "use") return { use: saved, saved, waitedMs: now() - start };
    if (d === "write" || now() - start >= opts.waitMs) return { use: null, saved, waitedMs: now() - start };
    await sleep(opts.pollMs ?? 3000);
  }
}
