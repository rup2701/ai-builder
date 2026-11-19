/**
 * The cost every Builder model call writes to the usage table comes from the price table for its model, not from optional
 * settings (they defaulted to 0, so Scout's turns were saved at $0). No network: fetch is a stand-in.
 */
import assert from "node:assert/strict";
import { costOf, PRICES, usageOf } from "../src/lib/agents/prices";
import { anthropicChat, anthropicComplete } from "../src/lib/agents/anthropic";
import { costOf as briefCostOf } from "../src/lib/agents/design-brief-writer";

let n = 0;
const ok = (name: string) => console.log("PASS", ++n, name);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

// 1. The table: Opus, Sonnet and Haiku 5.5, with cache reads and writes; an unknown model is priced as Opus.
near(costOf("claude-opus-5-5", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }), 4);
near(costOf("claude-opus-5-5", { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }), 20);
near(costOf("claude-sonnet-5-5", { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }), 12);
near(costOf("claude-haiku-5-5", { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }), 0.6);
near(costOf("claude-opus-5-5", { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 }), 5.2);
near(costOf("claude-something-new", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }), 4);
for (const m of Object.keys(PRICES)) {
  const t = { input: 1234, output: 567, cacheRead: 8900, cacheWrite: 120 };
  near(briefCostOf(m, t), costOf(m, t));
}
// Cache writes are 1.25 times input. Cache reads are 0.1 times input, except Sonnet 5.5 at $0.10.
for (const p of Object.values(PRICES)) near(p.cacheWrite, p.input * 1.25);
near(PRICES["claude-opus-5-5"].cacheRead, 0.2);
near(PRICES["claude-sonnet-5-5"].cacheRead, 0.1);
near(PRICES["claude-haiku-5-5"].cacheRead, 0.01);
ok("the price table covers Opus, Sonnet and Haiku, and an unknown model is priced as Opus");

// 2. A usage block becomes one row: all input tokens together, each kind priced at its own rate.
const u = usageOf("claude-opus-5-5", { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 4000 });
assert.equal(u.inputTokens, 25_000);
assert.equal(u.outputTokens, 500);
near(u.costUsd, (1000 * 4 + 500 * 20 + 20_000 * 0.2 + 4000 * 5) / 1e6);
assert.deepEqual(usageOf("claude-opus-5-5"), { inputTokens: 0, outputTokens: 0, costUsd: 0 });
ok("a usage block becomes tokens and a cost priced per kind");

// 3. Scout's calls report that cost, with no price settings at all.
delete process.env.ANTHROPIC_PRICE_IN_PER_MTOK;
delete process.env.ANTHROPIC_PRICE_OUT_PER_MTOK;
const usage = { input_tokens: 3000, output_tokens: 400, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 };
const realFetch = globalThis.fetch;
let reply: unknown;
globalThis.fetch = (async () => new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
try {
  reply = { content: [{ type: "text", text: "Who is it for?" }], stop_reason: "end_turn", usage };
  const chat = await anthropicChat({ apiKey: "test", model: "claude-opus-5-5" })({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] });
  assert.equal(chat.usage.inputTokens, 12_000);
  near(chat.usage.costUsd, (3000 * 4 + 400 * 20 + 9000 * 0.2) / 1e6);
  assert.ok(chat.usage.costUsd > 0, "never $0 for a real call");

  reply = { content: [{ type: "tool_use", name: "plan", input: { a: 1 } }], stop_reason: "tool_use", usage };
  const tool = { name: "plan", description: "d", input_schema: { type: "object", properties: {} } };
  const plan = await anthropicComplete({ apiKey: "test", model: "claude-haiku-5-5" })({ system: "s", user: "u", tool } as never);
  near(plan.usage.costUsd, (3000 * 0.1 + 400 * 0.5 + 9000 * 0.01) / 1e6);
} finally {
  globalThis.fetch = realFetch;
}
ok("the interview and the change planner report a real cost with no price settings");

console.log(`\n${n} passed`);
