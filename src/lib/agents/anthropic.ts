import type { Complete } from "./model-interviewer";

/**
 * Minimal Anthropic Messages API call with one tool, so the reply is structured input
 * that the caller validates (a reply without the tool call is an error and gets retried). The system prompt is marked cacheable: it is the same on every turn.
 * Prices are optional (per million tokens) so cost can be logged without hard-coding rates.
 */
export function anthropicComplete(opts: { apiKey: string; model: string; timeoutMs?: number }): Complete {
  const priceIn = Number(process.env.ANTHROPIC_PRICE_IN_PER_MTOK ?? 0);
  const priceOut = Number(process.env.ANTHROPIC_PRICE_OUT_PER_MTOK ?? 0);
  return async ({ system, user, tool }) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
        // Needed only for organization-wide keys, which are not tied to one workspace.
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 700,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
        tools: [tool],
        // Some models reject a forced tool call, so let the model choose; the system prompt says to call the tool every turn.
        tool_choice: { type: "auto" },
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      content?: { type: string; name?: string; input?: unknown }[];
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    const block = data.content?.find((b) => b.type === "tool_use" && b.name === tool.name);
    if (!block) throw new Error("The model did not return the expected tool call.");
    const u = data.usage ?? {};
    const inputTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    const outputTokens = u.output_tokens ?? 0;
    return {
      input: block.input,
      usage: { inputTokens, outputTokens, costUsd: (inputTokens * priceIn + outputTokens * priceOut) / 1e6 },
    };
  };
}