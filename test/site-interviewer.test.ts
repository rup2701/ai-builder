import assert from "node:assert/strict";
import { makeSiteInterviewer, toMessages, SITE_OPENER, type Chat } from "../src/lib/agents/site-interviewer";
import { validateSiteBrief, briefCard } from "../src/lib/builder/site-brief";
import { SITE_EXAMPLE_BRIEF } from "../src/lib/builder/site-pack.generated";
import { emptyState, pushMsg } from "../src/lib/workspace/state";
import type { WorkspaceState } from "../src/lib/workspace/types";

const usage = { inputTokens: 1000, outputTokens: 100, costUsd: 0.02 };
type Reply = { text?: string; save?: unknown };
const script = (...replies: Reply[]): { chat: Chat; calls: Parameters<Chat>[0][] } => {
  const calls: Parameters<Chat>[0][] = [];
  let i = 0;
  const chat: Chat = async (req) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    const r = replies[Math.min(i++, replies.length - 1)];
    const toolUses = r.save === undefined ? [] : [{ id: `tu${i}`, name: "save_brief", input: { brief: r.save } }];
    return { text: r.text ?? "", toolUses, content: [{ type: "text", text: r.text ?? "" }, ...toolUses.map((t) => ({ type: "tool_use", ...t }))], usage };
  };
  return { chat, calls };
};
const start = (): WorkspaceState => pushMsg({ ...emptyState(), phase: "intake" }, { kind: "bot", text: SITE_OPENER });
const bots = (s: WorkspaceState) => s.msgs.filter((m) => m.kind === "bot").map((m) => (m as { text: string }).text);
let n = 0;
const ok = (name: string) => console.log("PASS", ++n, name);
const good = JSON.parse(SITE_EXAMPLE_BRIEF);

(async () => {
  // 1. The example brief the pack ships is itself valid, and the card reads it.
  assert.equal(validateSiteBrief(good).ok, true);
  const card = briefCard(good);
  assert.equal(card.name, "Mealwise");
  assert.equal(card.benefits.length, 4);
  assert.equal(card.unconfirmed.length, 1);
  ok("the example brief validates and the card reads it");

  // 2. An ordinary reply is shown and the project stays in intake; usage is passed on.
  let { chat, calls } = script({ text: "Who is it for?" });
  let ai = makeSiteInterviewer(chat, "fake");
  let r = await ai.turn(start(), "It's called Mealwise, a dinner planner");
  assert.equal(r.state.phase, "intake");
  assert.equal(bots(r.state).at(-1), "Who is it for?");
  assert.equal(r.usage?.model, "fake");
  assert.equal(r.usage?.costUsd, 0.02);
  ok("a normal reply is shown and cost is reported");

  // 3. The model sees the whole conversation: it starts and ends with the person and roles alternate.
  const m = calls[0].messages;
  assert.equal(m[0].role, "user");
  assert.equal(m.at(-1)!.role, "user");
  assert.ok(m.every((x, i) => i === 0 || x.role !== m[i - 1].role));
  assert.match(String(m.at(-1)!.content), /Mealwise/);
  assert.match(calls[0].system, /interview_guide/);
  ok("the conversation sent to the model alternates and ends with the person");

  // 4. A valid brief is saved, the phase moves on, and the card shows.
  ({ chat } = script({ text: "Great, saving it.", save: good }));
  ai = makeSiteInterviewer(chat, "fake");
  r = await ai.turn(start(), "Yes, build it");
  assert.equal(r.state.phase, "summary");
  assert.equal((r.state.site?.brief as { site: { name: string } }).site.name, "Mealwise");
  assert.match(bots(r.state).at(-1)!, /brief is saved/);
  ok("an approved brief is saved");

  // 5. An invalid brief is sent back with the error, then the corrected one is saved.
  const bad = { ...good, blocks: good.blocks.filter((b: { type: string }) => b.type !== "waitlist") };
  ({ chat, calls } = script({ save: bad }, { save: good }));
  ai = makeSiteInterviewer(chat, "fake");
  r = await ai.turn(start(), "yes");
  assert.equal(calls.length, 2);
  const second = calls[1].messages;
  assert.equal(second.at(-1)!.role, "user");
  assert.match(JSON.stringify(second.at(-1)!.content), /waitlist/);
  assert.equal(r.state.phase, "summary");
  assert.equal(r.usage?.costUsd, 0.04);
  ok("an invalid brief is corrected through the tool error");

  // 6. Three invalid briefs in a row end with a plain apology and nothing saved.
  ({ chat } = script({ save: bad }));
  ai = makeSiteInterviewer(chat, "fake");
  r = await ai.turn(start(), "yes");
  assert.equal(r.state.site, undefined);
  assert.match(bots(r.state).at(-1)!, /Sorry/);
  ok("repeated invalid briefs are not saved");

  // 7. A model failure keeps the person's message and apologises.
  ai = makeSiteInterviewer(async () => { throw new Error("503"); }, "fake");
  r = await ai.turn(start(), "hello");
  assert.ok(r.state.msgs.some((x) => x.kind === "user"));
  assert.match(bots(r.state).at(-1)!, /Sorry/);
  assert.equal(r.usage?.model, "site-fallback");
  ok("a model failure is handled");

  // 8. After a brief is saved, the next call tells the model about it so it can change one thing.
  let s = start();
  ({ chat } = script({ save: good }));
  s = (await makeSiteInterviewer(chat, "fake").turn(s, "yes")).state;
  ({ chat, calls } = script({ text: "Changed." }));
  r = await makeSiteInterviewer(chat, "fake").turn(s, "make the headline shorter");
  assert.match(calls[0].system, /saved_brief/);
  assert.equal(r.state.phase, "summary");
  ok("a saved brief is passed back for changes");

  // 9. Empty text changes nothing; consecutive messages of one role are merged.
  ai = makeSiteInterviewer(async () => { throw new Error("must not run"); }, "fake");
  const same = start();
  assert.equal((await ai.turn(same, "   ")).state, same);
  const two = pushMsg(pushMsg(start(), { kind: "bot", text: "second bot message" }), { kind: "user", text: "hi" });
  const msgs = toMessages(two);
  assert.equal(msgs.length, 3);
  assert.match(String(msgs[1].content), /second bot message/);
  ok("empty input is ignored and roles are merged");

  console.log(`\n${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
