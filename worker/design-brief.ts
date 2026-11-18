/**
 * The design brief step in a showcase build (APP-42 step 1). Runs after the interview and before the runner is called.
 * It never fails or stops a build: no key, an error, a time-out or a brief that fails its checks all mean the build goes on
 * without a design brief, and the build record says why.
 *   WORKER_DESIGN_BRIEF=off            skips the step
 *   ANTHROPIC_DESIGN_BRIEF_MODEL       the model for this step only (default Opus)
 *   WORKER_DESIGN_BRIEF_MS             time limit for the whole step, both attempts (default 2 minutes). On a time-out the
 *                                      build goes on without the design brief, and the record's error says so.
 */
import { writeFile } from "node:fs/promises";
import { anthropicToolCall, designBriefModel, writeDesignBrief, type DesignBriefResult, type ToolCall } from "../src/lib/agents/design-brief-writer";
import type { InterviewMessage } from "../src/lib/builder/design-brief";
import { interviewForRecord } from "./build-record";

/** The whole step, both attempts, gets two minutes unless WORKER_DESIGN_BRIEF_MS says otherwise. */
export const DESIGN_BRIEF_LIMIT_MS = 120_000;

/** What the build record keeps under details.designBrief. */
export type DesignBriefRecord = (DesignBriefResult & { passedToRunner: boolean; file: string | null; skipped: null }) | { skipped: string; passedToRunner: false };

export async function designBriefStep(opts: {
  msgs: unknown;
  brief: Record<string, unknown>;
  /** Where the markdown goes when the brief passes, for the runner's --design-brief. */
  file: string;
  env: NodeJS.ProcessEnv;
  /** Tests pass a stand-in for the model. */
  call?: ToolCall;
}): Promise<DesignBriefRecord> {
  const { env } = opts;
  if (env.WORKER_DESIGN_BRIEF === "off") return { skipped: "switched off (WORKER_DESIGN_BRIEF=off)", passedToRunner: false };
  const messages = (interviewForRecord(opts.msgs)?.messages ?? []) as InterviewMessage[];
  if (!messages.some((m) => m.kind === "user")) return { skipped: "no interview to read", passedToRunner: false };
  const call = opts.call ?? (env.ANTHROPIC_API_KEY ? anthropicToolCall({ apiKey: env.ANTHROPIC_API_KEY }) : null);
  if (!call) return { skipped: "no ANTHROPIC_API_KEY on the worker", passedToRunner: false };

  const model = designBriefModel(env);
  const limit = Number(env.WORKER_DESIGN_BRIEF_MS ?? DESIGN_BRIEF_LIMIT_MS);
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<DesignBriefResult>((resolve) => {
    timer = setTimeout(() => resolve({
      model, attempts: 0, passed: false, quoteCheck: null, problems: [], firstAttempt: null, json: null, markdown: null,
      costUsd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, durationMs: limit, error: `timed out: took longer than ${limit} ms, so the build went on without a design brief`,
    }), limit);
  });
  const r = await Promise.race([writeDesignBrief({ messages, brief: opts.brief, call, model }), timedOut]).finally(() => clearTimeout(timer));
  let file: string | null = null;
  if (r.passed && r.markdown) {
    try {
      await writeFile(opts.file, r.markdown);
      file = opts.file;
    } catch (e) {
      r.error = `could not write the file: ${e instanceof Error ? e.message : e}`;
    }
  }
  return { ...r, passedToRunner: file !== null, file, skipped: null };
}
