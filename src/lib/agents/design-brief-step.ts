/**
 * The design brief step, shared by the worker (at build start, APP-42) and the web app (at review, APP-49). It masks the
 * chat the same way a build record does, calls the writer under a time limit, and never throws: no interview, no key, an
 * error or a time-out all come back as a result the caller saves and moves on from.
 */
import { anthropicToolCall, designBriefModel, writeDesignBrief, type DesignBriefResult, type ToolCall } from "./design-brief-writer";
import { designBriefFingerprint, lastOwnerMsg, type InterviewMessage } from "@/lib/builder/design-brief";
import { interviewForRecord } from "@/lib/builder/interview-mask";

export type StepOutcome = (DesignBriefResult & { skipped: null; fingerprint: string }) | { skipped: string; fingerprint: string | null };

/** The chat as the step reads it, the fingerprint of what the brief is made from, and the owner's last message it covers. */
export function designBriefInput(msgs: unknown, brief: Record<string, unknown>): { messages: InterviewMessage[]; fingerprint: string; upToMsg: number | null } {
  const messages = (interviewForRecord(msgs)?.messages ?? []) as InterviewMessage[];
  const upToMsg = lastOwnerMsg(messages);
  return { messages, fingerprint: designBriefFingerprint(messages, brief, upToMsg), upToMsg };
}

export async function runDesignBriefStep(opts: {
  msgs: unknown;
  brief: Record<string, unknown>;
  env: NodeJS.ProcessEnv;
  limitMs: number;
  /** What the record says after "took longer than N ms", for example what happens next. */
  timeoutNote: string;
  /** Tests pass a stand-in for the model. */
  call?: ToolCall;
}): Promise<StepOutcome> {
  const { env } = opts;
  const { messages, fingerprint } = designBriefInput(opts.msgs, opts.brief);
  if (!messages.some((m) => m.kind === "user")) return { skipped: "no interview to read", fingerprint };
  const call = opts.call ?? (env.ANTHROPIC_API_KEY ? anthropicToolCall({ apiKey: env.ANTHROPIC_API_KEY }) : null);
  if (!call) return { skipped: "no ANTHROPIC_API_KEY", fingerprint };

  const model = designBriefModel(env);
  const limit = opts.limitMs;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<DesignBriefResult>((resolve) => {
    timer = setTimeout(() => resolve({
      model, attempts: 0, passed: false, quoteCheck: null, problems: [], firstAttempt: null, json: null, markdown: null,
      costUsd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, durationMs: limit, error: `timed out: took longer than ${limit} ms, ${opts.timeoutNote}`,
    }), limit);
  });
  try {
    const r = await Promise.race([writeDesignBrief({ messages, brief: opts.brief, call, model }), timedOut]);
    return { ...r, skipped: null, fingerprint };
  } finally {
    clearTimeout(timer);
  }
}
