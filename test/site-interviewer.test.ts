import assert from "node:assert/strict";
import { makeSiteInterviewer, MISSED_REPLY, replyMessage, restates, toMessages, SITE_OPENER, type Chat } from "../src/lib/agents/site-interviewer";
import { validateSiteBrief, briefCard } from "../src/lib/builder/site-brief";
import { SITE_EXAMPLE_BRIEF } from "../src/lib/builder/site-pack.generated";
import { emptyState, pushMsg } from "../src/lib/workspace/state";
import type { WorkspaceState } from "../src/lib/workspace/types";

const usage = { inputTokens: 1000, outputTokens: 100, costUsd: 0.02 };
type Reply = { text?: string; save?: unknown; reply?: unknown };
const script = (...replies: Reply[]): { chat: Chat; calls: Parameters<Chat>[0][] } => {
  const calls: Parameters<Chat>[0][] = [];
  let i = 0;
  const chat: Chat = async (req) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    const r = replies[Math.min(i++, replies.length - 1)];
    const toolUses = [
      ...(r.reply === undefined ? [] : [{ id: `rp${i}`, name: "reply", input: r.reply }]),
      ...(r.save === undefined ? [] : [{ id: `tu${i}`, name: "save_brief", input: { brief: r.save } }]),
    ];
    return { text: r.text ?? "", toolUses, content: [{ type: "text", text: r.text ?? "" }, ...toolUses.map((t) => ({ type: "tool_use", ...t }))], usage };
  };
  return { chat, calls };
};
const start = (): WorkspaceState => pushMsg({ ...emptyState(), phase: "intake" }, { kind: "bot", text: SITE_OPENER });
/** An interview past the owner's first message, so Scout's reply may show what it understood. */
const asked = (): WorkspaceState => pushMsg(pushMsg(start(), { kind: "user", text: "I have an idea for a website" }), { kind: "bot", text: "What is it called?" });
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
  let { chat, calls } = script({ reply: { question: "Who is it for?" } });
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

  // ---- APP-45: what Scout understood and the next question, as separate fields ----
  // 10. The call offers both tools without forcing one (tool_choice any is refused for this model), and a reply shows understood and the question apart.
  ({ chat, calls } = script({ reply: { understood: "GunnerWins gives members daily picks across the major US leagues.", question: "Who is it for: casual fans, serious bettors or both?" } }));
  r = await makeSiteInterviewer(chat, "fake").turn(asked(), "It is called GunnerWins, daily picks for all major leagues");
  assert.equal((calls[0] as { toolChoice?: unknown }).toolChoice, undefined, "no forced tool choice");
  assert.deepEqual(calls[0].tools.map((t) => t.name), ["reply", "save_brief"]);
  let last = r.state.msgs.at(-1) as Extract<WorkspaceState["msgs"][number], { kind: "bot" }>;
  assert.equal(last.understood, "GunnerWins gives members daily picks across the major US leagues.");
  assert.equal(last.question, "Who is it for: casual fans, serious bettors or both?");
  assert.equal(last.parts, undefined);
  assert.equal(last.text, "GunnerWins gives members daily picks across the major US leagues.\n\nWho is it for: casual fans, serious bettors or both?");
  assert.equal(r.state.phase, "intake");
  ok("a reply keeps what Scout understood apart from the question, and the full text for the model");

  // 11. A question with several parts gets one line per part.
  ({ chat } = script({ reply: { understood: "Two one-time passes: Weekly at $199 for 7 days and Monthly at $599 for 30 days.", question: "Now the look. Tell me:", parts: ["Tone: calm, bold, playful or serious", "Light or dark", "Main colour: blue, green, violet, orange, rose, slate, or your own"] } }));
  r = await makeSiteInterviewer(chat, "fake").turn(start(), "weekly 199, monthly 599");
  last = r.state.msgs.at(-1) as typeof last;
  assert.deepEqual(last.parts, ["Tone: calm, bold, playful or serious", "Light or dark", "Main colour: blue, green, violet, orange, rose, slate, or your own"]);
  assert.match(last.text, /Tell me:\n\n- Tone: calm, bold, playful or serious\n- Light or dark\n- Main colour/);
  ok("a question with several parts is listed one part per line");

  // 12. Code tidies what the model sends: no leading Got it, no empty or extra parts, and a first message with no understood part.
  assert.equal(replyMessage({ understood: "Got it: two passes, no auto-renew.", question: "Next?" })?.understood, "Two passes, no auto-renew.");
  assert.equal(replyMessage({ understood: "got it, it's for both", question: "Next?" })?.understood, "It's for both");
  assert.deepEqual(replyMessage({ question: " Q ", parts: ["a", " ", "", 3, "b", "c", "d", "e", "f", "g"] })?.parts, ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(replyMessage({ question: "What is your product?" }), { kind: "bot", text: "What is your product?", question: "What is your product?" });
  assert.equal(replyMessage({ understood: "something" }), null);
  assert.equal(replyMessage(null), null);
  ok("the reply is checked and tidied by code");

  // 13. A reply with no question is sent back once, then the corrected one is shown.
  ({ chat, calls } = script({ reply: { understood: "Both." } }, { reply: { understood: "It is for both.", question: "What should the main button say?" } }));
  r = await makeSiteInterviewer(chat, "fake").turn(start(), "both");
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[1].messages.at(-1)!.content), /question is required/);
  assert.equal((r.state.msgs.at(-1) as typeof last).question, "What should the main button say?");
  ok("a reply without a question is retried, never shown empty");

  // 14. A reply next to an approved brief is shown, then the saved message.
  ({ chat } = script({ reply: { understood: "You approved the review.", question: "Saving your brief now." }, save: good }));
  r = await makeSiteInterviewer(chat, "fake").turn(asked(), "Yes, build it");
  assert.equal(r.state.phase, "summary");
  assert.equal(bots(r.state).at(-2), "You approved the review.\n\nSaving your brief now.");
  assert.match(bots(r.state).at(-1)!, /brief is saved/);
  ok("a reply with an approved brief is shown before the saved message");

  // 15. When the brief is refused, every tool call in that answer gets a result, so the next call is accepted.
  ({ chat, calls } = script({ reply: { question: "Saving." }, save: bad }, { save: good }));
  r = await makeSiteInterviewer(chat, "fake").turn(start(), "yes");
  const results = (calls[1].messages.at(-1)!.content as { tool_use_id: string; is_error?: boolean }[]);
  assert.deepEqual(results.map((x) => x.tool_use_id).sort(), ["rp1", "tu1"]);
  assert.equal(results.find((x) => x.tool_use_id === "tu1")!.is_error, true);
  assert.equal(r.state.phase, "summary");
  ok("a refused brief answers every tool call");

  // 16. The rules tell Scout to use the fields and no longer forbid listing the parts of a question.
  assert.match(calls[0].system, /reply tool/);
  assert.match(calls[0].system, /Never start it with "Got it"/);
  assert.doesNotMatch(calls[0].system, /no lists of questions/);
  assert.match(calls[0].system, /Always answer by calling the reply tool/);
  ok("the interview rules describe the reply fields");

  // 17. Plain text with no reply call is a missed call: it is retried once with a reminder, and the reply that follows is shown.
  ({ chat, calls } = script({ text: "Who is it for?" }, { reply: { understood: "It is a dinner planner.", question: "Who is it for?" } }));
  r = await makeSiteInterviewer(chat, "fake").turn(asked(), "Mealwise, a planner");
  assert.equal(calls.length, 2);
  const retry = calls[1].messages;
  assert.equal(retry.at(-2)!.role, "assistant");
  assert.equal(retry.at(-1)!.role, "user");
  assert.equal(retry.at(-1)!.content, MISSED_REPLY);
  last = r.state.msgs.at(-1) as typeof last;
  assert.equal(last.understood, "It is a dinner planner.");
  assert.equal(last.question, "Who is it for?");
  assert.equal(r.usage?.costUsd, 0.04, "both calls are counted");
  assert.ok(!bots(r.state).some((t) => t.includes(MISSED_REPLY)), "the reminder is never shown");
  ok("plain text is retried once, asking for the reply tool");

  // 18. Plain text again after the reminder is shown as the question, with no understood part: never blank, never an error.
  ({ chat, calls } = script({ text: "Who is it for?" }, { text: "Who is it for, casual fans or serious ones?" }));
  r = await makeSiteInterviewer(chat, "fake").turn(start(), "Mealwise");
  assert.equal(calls.length, 2, "only one retry");
  last = r.state.msgs.at(-1) as typeof last;
  assert.deepEqual({ text: last.text, question: last.question, understood: last.understood, parts: last.parts }, { text: "Who is it for, casual fans or serious ones?", question: "Who is it for, casual fans or serious ones?", understood: undefined, parts: undefined });
  assert.equal(r.state.phase, "intake");
  ok("plain text after the reminder is shown as the question");

  // 19. A reply without a question, then plain text: the reminder still comes once, and the chat ends with a real message.
  ({ chat, calls } = script({ reply: { understood: "x" } }, { text: "What is it called?" }, { text: "What is it called, then?" }));
  r = await makeSiteInterviewer(chat, "fake").turn(start(), "hi");
  assert.equal(calls.length, 3);
  assert.equal((r.state.msgs.at(-1) as typeof last).question, "What is it called, then?");
  ok("a missing question and a missed call are each retried, within three calls");

  // 20. When all three attempts fail, the log line says why each one failed: block types and field errors, never the words.
  {
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
    try {
      ({ chat } = script({ reply: { understood: "You said yes, secret words here." } }, { text: "Plain words here" }, { save: { site: {} }, reply: { understood: "Saving" } }));
      r = await makeSiteInterviewer(chat, "fake").turn(start(), "yes");
    } finally {
      console.error = orig;
    }
    assert.equal(bots(r.state).at(-1), "Sorry, something went wrong on my side. Please send that again.");
    assert.equal(logged.length, 1);
    const line = logged[0];
    assert.match(line, /^site interviewer failed: No usable answer in three attempts\. /);
    assert.match(line, /attempt 1: reply with no question \(text, tool_use:reply\)/);
    assert.match(line, /attempt 2: plain text with no reply call \(text\)/);
    assert.match(line, /attempt 3: brief not valid \(text, tool_use:reply, tool_use:save_brief\): site\.name: /);
    assert.doesNotMatch(line, /secret words|Plain words|Saving|failed validation three times/, "no model words in the log");
    ok("the failure log line gives the reason for each attempt, without the model's words");
  }

  // ---- The understood part only when Scout interpreted or decided something ----
  // 21. The first reply never has an understood part, even when the model sends one; the full text is the question alone.
  ({ chat } = script({ reply: { understood: "GunnerWins sells daily picks for the major US leagues.", question: "Who is it for?" } }));
  r = await makeSiteInterviewer(chat, "fake").turn(start(), "GunnerWins, daily picks for all major leagues");
  last = r.state.msgs.at(-1) as typeof last;
  assert.equal(last.understood, undefined);
  assert.equal(last.text, "Who is it for?");
  ok("the first reply has no understood part");

  // 22. A reply that only repeats the owner's words drops the understood part; one that interprets them keeps it.
  ({ chat } = script({ reply: { understood: "It is for both.", question: "What should the main button say?" } }));
  r = await makeSiteInterviewer(chat, "fake").turn(asked(), "both");
  last = r.state.msgs.at(-1) as typeof last;
  assert.equal(last.understood, undefined);
  assert.equal(last.text, "What should the main button say?");
  ({ chat } = script({ reply: { understood: "Your main button says Get picks.", question: "And the second button?" } }));
  r = await makeSiteInterviewer(chat, "fake").turn(asked(), "main button: Get picks");
  assert.equal((r.state.msgs.at(-1) as typeof last).understood, undefined);
  ({ chat } = script({ reply: { understood: "Two one-time passes: Weekly at $199 for 7 days and Monthly at $599 for 30 days.", question: "Now the look." } }));
  r = await makeSiteInterviewer(chat, "fake").turn(asked(), "weekly 199, monthly 599");
  assert.equal((r.state.msgs.at(-1) as typeof last).understood, "Two one-time passes: Weekly at $199 for 7 days and Monthly at $599 for 30 days.");
  ({ chat } = script({ reply: { understood: "No colour given, so I picked blue.", question: "Light or dark?" } }));
  r = await makeSiteInterviewer(chat, "fake").turn(asked(), "calm tone");
  assert.equal((r.state.msgs.at(-1) as typeof last).understood, "No colour given, so I picked blue.");
  assert.equal(restates("It's called Mealwise.", "it's called mealwise"), true);
  assert.equal(restates("Mealwise is for busy parents.", "mealwise"), false);
  ok("a restating understood part is dropped, an interpreted or decided one is kept");

  // 23. The rules and the reply tool say when to show understood.
  assert.match(calls[0].system, /Leave it out for your first reply, and leave it out whenever it would only repeat their words back/);
  const tool = calls[0].tools.find((t) => t.name === "reply") as unknown as { input_schema: { properties: { understood: { description: string } } } };
  assert.match(tool.input_schema.properties.understood.description, /interpreted.*decided something on their behalf.*first reply.*repeat their words/s);
  ok("the prompt and the reply tool say when understood is shown");

  // 24. Money terms are asked directly, never assumed with an escape clause.
  assert.match(calls[0].system, /Ask about money terms directly, as a question: for example "Does Monthly renew on its own\?"/);
  assert.match(calls[0].system, /Never state a guess and add an escape such as "Tell me if it does"/);
  ok("Scout asks money terms directly and never assumes them");

  console.log(`\n${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
