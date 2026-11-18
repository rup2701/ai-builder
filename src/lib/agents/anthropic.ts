import type { Complete } from "./model-interviewer";

/**
 * Minimal Anthropic Messages API call with one tool, so the reply is structured input
 * that the caller validates (a reply without the tool call is an error and gets retried). The system prompt is marked cacheable: it is the same on every turn.
 * Prices are optional (per million tokens) so cost can be logged without hard-coding rates.
 */
export function anthropicComplete(opts: { apiKey: string; model: string; timeoutMs?: number; maxTokens?: number }): Complete {
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
        max_tokens: opts.maxTokens ?? 1200,
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
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    // A reply cut off at the token limit has a half-written tool call: say so, instead of passing it on as if it were complete.
    if (data.stop_reason === "max_tokens") throw new Error(`The model's reply was cut off at ${opts.maxTokens ?? 1200} tokens.`);
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

/**
 * A conversation call for the site interview: whole message history, one optional tool, free text allowed.
 * Used where the model writes real replies (the site interview), unlike anthropicComplete above.
 */
import type { Chat } from "./site-interviewer";

export function anthropicChat(opts: { apiKey: string; model: string; timeoutMs?: number }): Chat {
  const priceIn = Number(process.env.ANTHROPIC_PRICE_IN_PER_MTOK ?? 0);
  const priceOut = Number(process.env.ANTHROPIC_PRICE_OUT_PER_MTOK ?? 0);
  return async ({ system, messages, tools }) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 100_000),
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 8000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
        tools,
        tool_choice: { type: "auto" },
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    const content = data.content ?? [];
    const u = data.usage ?? {};
    const inputTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    const outputTokens = u.output_tokens ?? 0;
    return {
      text: content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim(),
      toolUses: content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id ?? "", name: b.name ?? "", input: b.input })),
      content,
      usage: { inputTokens, outputTokens, costUsd: (inputTokens * priceIn + outputTokens * priceOut) / 1e6 },
    };
  };
}
