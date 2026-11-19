/**
 * The design brief step (APP-42 step 1): one model call writes it, code checks it, and a brief that fails is retried once
 * with the exact problems. The result is always returned, never thrown: a failing brief is kept with its failures listed
 * (and the worker does not pass it to the runner), and an error means no design brief, never a failed build.
 */
import {
  assembleDesignBrief,
  checkDesignBrief,
  DESIGN_BRIEF_TOOL,
  designBriefSystem,
  designBriefUser,
  renderDesignBrief,
  retryNote,
  type CheckResult,
  type DesignBrief,
  type InterviewMessage,
  type QuoteCheck,
} from "@/lib/builder/design-brief";

export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** Dollars per million tokens, the same estimates as the runner's src/config.ts. A model not listed is priced as Opus, the dearer one. */
const PRICES: Record<string, TokenUsage> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};
export const costOf = (model: string, u: TokenUsage) => {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6;
};

/** The model's setting for this step only. Opus unless ANTHROPIC_DESIGN_BRIEF_MODEL says otherwise. */
export const designBriefModel = (env: NodeJS.ProcessEnv = process.env) => env.ANTHROPIC_DESIGN_BRIEF_MODEL || "claude-opus-5-5";

type ApiMessage = { role: "user" | "assistant"; content: Record<string, unknown>[] };
export type ToolCall = (req: { model: string; system: string; messages: ApiMessage[]; tool: typeof DESIGN_BRIEF_TOOL }) => Promise<{
  toolUse: { id: string; input: unknown } | null;
  usage: TokenUsage;
  stopReason?: string;
}>;

/** One Messages API call with the design brief tool. */
export function anthropicToolCall(opts: { apiKey: string; timeoutMs?: number; maxTokens?: number }): ToolCall {
  return async ({ model, system, messages, tool }) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 8000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
        tools: [tool],
        // The system prompt says to call the tool; a reply without it is retried like any other failure.
        tool_choice: { type: "auto" },
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      content?: { type: string; id?: string; name?: string; input?: unknown }[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    const u = data.usage ?? {};
    const block = data.content?.find((b) => b.type === "tool_use" && b.name === tool.name);
    return {
      toolUse: block && data.stop_reason !== "max_tokens" ? { id: block.id ?? "", input: block.input } : null,
      usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
      stopReason: data.stop_reason,
    };
  };
}

export type DesignBriefResult = {
  model: string;
  attempts: number;
  /** The final brief passed every check: every quote found, direction names from the lists, no invented numbers. */
  passed: boolean;
  quoteCheck: QuoteCheck | null;
  problems: string[];
  /** What the first attempt failed on, when there was a retry. */
  firstAttempt: { quoteCheck: QuoteCheck | null; problems: string[] } | null;
  json: DesignBrief | null;
  markdown: string | null;
  costUsd: number;
  tokens: TokenUsage;
  durationMs: number;
  error: string | null;
};

const add = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite });

export async function writeDesignBrief(opts: { messages: InterviewMessage[]; brief: Record<string, unknown>; call: ToolCall; model: string }): Promise<DesignBriefResult> {
  const started = Date.now();
  let tokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const result = (r: Partial<DesignBriefResult>): DesignBriefResult => ({
    model: opts.model, attempts: 0, passed: false, quoteCheck: null, problems: [], firstAttempt: null, json: null, markdown: null,
    ...r,
    tokens, costUsd: Math.round(costOf(opts.model, tokens) * 10000) / 10000, durationMs: Date.now() - started, error: r.error ?? null,
  });
  const system = designBriefSystem();
  const messages: ApiMessage[] = [{ role: "user", content: [{ type: "text", text: designBriefUser(opts.messages, opts.brief), cache_control: { type: "ephemeral" } }] }];
  let first: { quoteCheck: QuoteCheck | null; problems: string[] } | null = null;
  let last: { json: DesignBrief; check: CheckResult } | null = null;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await opts.call({ model: opts.model, system, messages, tool: DESIGN_BRIEF_TOOL });
      tokens = add(tokens, r.usage);
      if (!r.toolUse) {
        const why = r.stopReason === "max_tokens" ? "The answer was cut off at the token limit." : "The model did not call write_design_brief.";
        if (attempt === 2) return result({ attempts: 2, firstAttempt: first, json: last?.json ?? null, quoteCheck: last?.check.quoteCheck ?? null, problems: [...(last?.check.problems ?? []), why], markdown: last ? renderDesignBrief(last.json) : null });
        first = { quoteCheck: null, problems: [why] };
        messages.push({ role: "user", content: [{ type: "text", text: `${why} Call write_design_brief once with the whole brief.` }] });
        continue;
      }
      const json = assembleDesignBrief(r.toolUse.input, opts.brief, opts.messages);
      const check = checkDesignBrief(json, opts.messages, opts.brief);
      last = { json, check };
      if (check.ok || attempt === 2) {
        return result({ attempts: attempt, passed: check.ok, quoteCheck: check.quoteCheck, problems: check.problems, firstAttempt: first, json, markdown: renderDesignBrief(json) });
      }
      first = { quoteCheck: check.quoteCheck, problems: check.problems };
      messages.push({ role: "assistant", content: [{ type: "tool_use", id: r.toolUse.id, name: DESIGN_BRIEF_TOOL.name, input: r.toolUse.input }] });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: r.toolUse.id, is_error: true, content: retryNote(check) }] });
    }
  } catch (e) {
    return result({ attempts: first ? 2 : 1, firstAttempt: first, json: last?.json ?? null, quoteCheck: last?.check.quoteCheck ?? null, problems: last?.check.problems ?? [], markdown: last ? renderDesignBrief(last.json) : null, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
  }
  return result({ error: "No design brief was written." });
}
