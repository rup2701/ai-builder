/**
 * Model prices, in dollars per million tokens, for the cost each call writes to the usage table. Estimates: the bill from
 * Anthropic is the truth. Cache writes are the 5 minute rate (1.25 times input); cache reads are 0.1 times input, except Sonnet 5.5 at $0.10.
 * Haiku 5.5 has a second, dearer rate for prompts over 100K tokens; our Haiku calls (imports, the website reader) stay well
 * under it, so only the lower rate is here. The runner keeps its own copy for the build and changes (appnomics-runner/src/config.ts).
 */
export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const PRICES: Record<string, TokenUsage> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** The cost of one call. A model not in the table is priced as Opus, the dearest, so a cost is never shown as lower than it was. */
export const costOf = (model: string, u: TokenUsage) => {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6;
};

/** The Messages API usage block as our usage row needs it: all input tokens together, and the cost priced per kind. */
export function usageOf(model: string, u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } = {}) {
  const t: TokenUsage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
  return { inputTokens: t.input + t.cacheRead + t.cacheWrite, outputTokens: t.output, costUsd: costOf(model, t) };
}
