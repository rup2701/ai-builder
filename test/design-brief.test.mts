/**
 * The design brief (APP-42 step 1): the quote check, the closed direction lists, invented numbers, the markdown for
 * specs/design-brief.md, the one retry and the worker step. No model and no database: the model is a stand-in that
 * returns a prepared answer. The interview is made up (a picks product called PickPal).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assembleDesignBrief,
  checkDesignBrief,
  DESIGN_BRIEF_TOOL,
  designBriefSystem,
  designBriefUser,
  DIRECTION,
  interviewText,
  normalizeQuote,
  quoteTooShort,
  renderDesignBrief,
  retryNote,
  type InterviewMessage,
} from "../src/lib/builder/design-brief";
import { costOf, designBriefModel, writeDesignBrief, type ToolCall } from "../src/lib/agents/design-brief-writer";
import { DESIGN_BRIEF_LIMIT_MS, designBriefStep } from "../worker/design-brief";

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message : e}`);
  }
}

const INTERVIEW: InterviewMessage[] = [
  { id: 1, kind: "bot", text: "What is the product called, and what does it do?" },
  { id: 2, kind: "user", text: "it is called PickPal. members get daily picks for all 4 major leagues in America" },
  { id: 3, kind: "bot", text: "Who is it for? For example fans who follow tipsters and stats sites.", options: ["Casual fans", "Serious fans"] },
  { id: 4, kind: "user", text: "yes thats right, for casual and  serious fans" },
  { id: 5, kind: "bot", text: "What are the plans?" },
  { id: 6, kind: "user", text: "Weekly $49 for 7 days, Monthly $149 for 30 days. no auto renew" },
  { id: 7, kind: "bot", text: "Which look?", options: ["Light", "Dark"] },
  { id: 8, kind: "user", text: "Dark, and orange. Bold is fine" },
  { id: 9, kind: "site_ready", text: "ignored" },
];

const BRIEF = {
  site: { name: "PickPal", kind: "product-showcase" },
  look: { mode: "dark", tone: "bold", accent: "#F97316" },
  blocks: [{ type: "hero", headline: "Every league. Every day.", visual: { kind: "concept_preview", image: null } }],
};

/** A model answer that passes every check. Tests change one part at a time. */
function goodAnswer(): any {
  return {
    name: { quote: "it is called PickPal", msg: 2 },
    audience: [{ value: "casual and serious fans", quote: "for casual and  serious fans", msg: 4 }],
    voice: { summary: "Plain and confident, like a friend who follows every game.", quotes: [{ quote: "Bold is fine", msg: 8 }] },
    owner_facts: [{ topic: "Leagues", meaning: "NFL, NBA, MLB and NHL, each while in season", about: "coverage", quote: "all 4 major leagues in America", msg: 2 }],
    messages: [
      { text: "Daily picks for every major league.", paraphrase: true, about: "coverage", quote: "daily picks for all 4 major leagues", msg: 2 },
      { text: "Pay once. No auto-renew.", paraphrase: true, about: "renewal", quote: "no auto renew", msg: 6 },
    ],
    plans: [
      { name: "Weekly", price: "$49", length: "7 days", highlight: false, highlight_quote: null, quote: "Weekly $49 for 7 days", msg: 6 },
      { name: "Monthly", price: "$149", length: "30 days", highlight: false, highlight_quote: null, quote: "Monthly $149 for 30 days", msg: 6 },
    ],
    look_quotes: { mode: { quote: "Dark", msg: 8 }, accent: { quote: "orange", msg: 8 }, tone: { quote: "Bold is fine", msg: 8 } },
    direction: {
      pairing: { value: "Heavy geometric", why: "Bold and sporty." },
      motif: { value: "Stack", why: "The product is a feed of picks." },
      hero_kind: { value: "fragment", why: "A stack of pick cards shows the product." },
      signatures: [{ value: "oversized-numerals", why: "7 and 30 days set large." }],
    },
    sample_card: { item: "one pick", fields: [{ label: "League", filler: "League" }, { label: "Matchup", filler: "AWAY @ HOME" }, { label: "Line", filler: "0.0" }] },
    care: [{ flag: "Betting", rule: "No win record, no guaranteed or profit claims." }],
    placeholders: [{ slot: "notice", what: "Eligibility and responsible-gaming notice" }],
    other_proposals: [],
    gaps: [{ question: "Who is behind the picks? A name or a short bio?", affects: ["voice"], about: "people" }],
  };
}

const check = (raw: unknown) => {
  const db = assembleDesignBrief(raw, BRIEF);
  return { db, r: checkDesignBrief(db, INTERVIEW, BRIEF) };
};

// ---- the interview the model reads ----

await test("the interview is numbered, owner and Scout lines only, with Scout's buttons", () => {
  const t = interviewText(INTERVIEW);
  assert.match(t, /^\[1\] Scout: What is the product called/);
  assert.match(t, /\[2\] Owner: it is called PickPal/);
  assert.match(t, /\[3\] Scout: .*\(buttons: Casual fans \| Serious fans\)/);
  assert.doesNotMatch(t, /ignored/);
  assert.match(designBriefUser(INTERVIEW, BRIEF), /"name": "PickPal"/);
});

await test("the model is told the rules and given only the pack's own lists", () => {
  const s = designBriefSystem();
  for (const p of DIRECTION.pairings) assert.ok(s.includes(p.name), p.name);
  for (const m of DIRECTION.motifs) assert.ok(s.includes(m.name), m.name);
  assert.match(s, /Never quote any other Scout line/);
  assert.match(s, /all 4 major leagues in America/);
  assert.match(s, /highlight is true only if the owner asked/);
  const props = DESIGN_BRIEF_TOOL.input_schema.properties.direction.properties;
  assert.deepEqual([...props.pairing.properties.value.enum], DIRECTION.pairings.map((p) => p.name));
  assert.deepEqual([...props.signatures.items.properties.value.enum], DIRECTION.signatures.map((s) => s.name));
});

// ---- the checks ----

await test("a good brief passes: every quote is found, ignoring case and spacing", () => {
  const { r } = check(goodAnswer());
  assert.deepEqual(r.problems, []);
  assert.equal(r.quoteCheck.failed.length, 0);
  assert.equal(r.quoteCheck.checked, r.quoteCheck.passed);
  assert.ok(r.ok);
  assert.equal(normalizeQuote("For Casual  and\nSerious"), normalizeQuote("for casual and serious"));
  assert.equal(normalizeQuote("that’s"), normalizeQuote("that's"));
});

await test("a quote the owner never wrote fails, and so does a Scout line or an empty quote", () => {
  const a = goodAnswer();
  a.audience[0].quote = "for every sports fan";
  a.owner_facts.push({ topic: "Alternatives", meaning: "tipsters", quote: "tipsters and stats sites", msg: 3 });
  a.voice.quotes.push({ quote: "  ", msg: 8 });
  const { r } = check(a);
  assert.equal(r.ok, false);
  assert.deepEqual(r.quoteCheck.failed.map((f) => [f.path, f.why]), [
    ["audience[0]", "not in an owner message or the approved review"],
    ["voice.quotes[1]", "empty"],
    ["owner_facts[1]", "not in an owner message or the approved review"],
  ]);
});

await test("a quote found in another owner message gets that message's number", () => {
  const a = goodAnswer();
  a.messages[1].msg = 2;
  const { db, r } = check(a);
  assert.ok(r.ok);
  assert.equal(r.quoteCheck.msgCorrected, 1);
  assert.equal(db.messages[1].msg, 6);
});

await test("direction names outside the pack's lists are problems, and fonts come from the pairing by code", () => {
  const a = goodAnswer();
  a.direction.pairing.value = "Bebas and friends";
  a.direction.signatures = [{ value: "neon-glow", why: "x" }, { value: "corner-ticks", why: "y" }, { value: "status-chips", why: "z" }];
  const { db, r } = check(a);
  assert.ok(r.problems.some((p) => /pairing "Bebas and friends" is not a pairing/.test(p)));
  assert.ok(r.problems.some((p) => /signatures "neon-glow"/.test(p)));
  assert.ok(r.problems.some((p) => /one or two names/.test(p)));
  assert.equal(db.direction.fonts, null);
  const good = check(goodAnswer()).db;
  assert.deepEqual(good.direction.fonts, { heading: "Outfit", body: "Inter", accent: null, headingWeight: 800, capsLabels: true });
});

await test("owner-art needs an image the owner supplied", () => {
  const a = goodAnswer();
  a.direction.hero_kind.value = "owner-art";
  assert.ok(check(a).r.problems.some((p) => /owner-art, but the owner supplied no image/.test(p)));
});

await test("a number the owner never typed is a problem; one in the approved brief is not", () => {
  const a = goodAnswer();
  a.messages.push({ text: "Join 5,000 members who win 62% of the time.", quote: "daily picks for all 4 major leagues", msg: 2 });
  const { r } = check(a);
  assert.ok(r.problems.some((p) => /numbers the owner never typed: 5000, 62/.test(p)), r.problems.join("; "));
  const b = goodAnswer();
  b.owner_facts.push({ topic: "Plans", meaning: "7 and 30 days", quote: "Weekly $49 for 7 days, Monthly $149 for 30 days", msg: 6 });
  assert.ok(check(b).r.ok);
});

await test("a trivial quote fails: yes, ok, or fewer than 3 words and 12 characters", () => {
  const msgs: InterviewMessage[] = [...INTERVIEW, { id: 10, kind: "user", text: "yes" }, { id: 11, kind: "user", text: "ok" }, { id: 12, kind: "user", text: "Weekly one" }];
  const a = goodAnswer();
  a.owner_facts = [
    { topic: "Agreed", meaning: "the audience", quote: "yes", msg: 10 },
    { topic: "Agreed", meaning: "the plans", quote: "ok", msg: 11 },
    { topic: "Plan", meaning: "weekly", quote: "Weekly one", msg: 12 },
    { topic: "Plans", meaning: "no renewal", quote: "no auto renew", msg: 6 },
    { topic: "Audience", meaning: "both", quote: "for casual and", msg: 4 },
  ];
  const db = assembleDesignBrief(a, BRIEF);
  const r = checkDesignBrief(db, msgs, BRIEF);
  assert.deepEqual(r.quoteCheck.failed.map((f) => [f.path, f.why]), [
    ["owner_facts[0]", "too short"],
    ["owner_facts[1]", "too short"],
    ["owner_facts[2]", "too short"],
  ]);
  assert.match(retryNote(r), /owner_facts\[0\]: the quote "yes" is too short to carry the fact\. Quote at least 3 words or 12 characters/);
  // Three words pass, and so do 12 characters in fewer words.
  assert.equal(quoteTooShort("messages[0]", "no auto renew", db), false);
  assert.equal(quoteTooShort("messages[0]", "subscription", db), false);
  assert.equal(quoteTooShort("messages[0]", "Weekly works", db), false, "12 characters is enough");
  assert.equal(quoteTooShort("messages[0]", "yes ok", db), true);
});

await test("short owner values pass where the quote is the value: the name, and the color mode, color and tone", () => {
  const db = assembleDesignBrief(goodAnswer(), BRIEF);
  assert.equal(quoteTooShort("name", "PickPal", db), false);
  assert.equal(quoteTooShort("name", "it is", db), true, "a short name quote must hold the name");
  for (const v of ["Dark", "orange", "#F97316", "Bold"]) assert.equal(quoteTooShort("look.accent", v, db), false, v);
  assert.equal(quoteTooShort("look.tone", "yes", db), true, "yes is never a quote");
  assert.equal(quoteTooShort("look.mode", "OK!", db), true);
  const a = goodAnswer();
  a.name = { quote: "PickPal", msg: 2 };
  a.look_quotes = { mode: { quote: "Dark", msg: 8 }, accent: { quote: "orange", msg: 8 }, tone: { quote: "Bold", msg: 8 } };
  assert.ok(check(a).r.ok, check(a).r.quoteCheck.failed.map((f) => f.path).join(", "));
});

await test("sample filler stays generic: no digits but 0", () => {
  const a = goodAnswer();
  a.sample_card.fields[2].filler = "DAL -3.5";
  assert.ok(check(a).r.problems.some((p) => /filler "DAL -3.5" has a digit other than 0/.test(p)));
});

await test("no highlighted plan unless the owner asked, with a quote that passes", () => {
  const a = goodAnswer();
  a.plans[1].highlight = true; // no quote: code turns it off
  assert.equal(assembleDesignBrief(a, BRIEF).plans[1].highlight, false);
  const b = goodAnswer();
  b.plans[1].highlight = true;
  b.plans[1].highlight_quote = { quote: "make monthly the popular one", msg: 6 };
  const { db, r } = check(b);
  assert.equal(db.plans[1].highlight, true);
  assert.ok(r.quoteCheck.failed.some((f) => f.path === "plans[1].highlight_quote"));
});

await test("code fills the name, mode, accent and tone from the brief, numbers proposals and gaps, and formats placeholders", () => {
  const a = goodAnswer();
  a.other_proposals = [{ field: "hero.chips", value: "League chips under the hero", why: "Shows the leagues at a glance." }];
  const db = assembleDesignBrief(a, BRIEF);
  assert.equal(db.name.value, "PickPal");
  assert.deepEqual([db.look.mode.value, db.look.accent.value, db.look.tone.value], ["dark", "#F97316", "bold"]);
  assert.deepEqual(db.proposals.map((p) => [p.id, p.field]), [["p1", "direction.pairing"], ["p2", "direction.motif"], ["p3", "direction.hero_kind"], ["p4", "direction.signature"], ["p5", "hero.chips"]]);
  assert.equal(db.direction.pairing.proposal, "p1");
  assert.deepEqual(db.gaps.map((g) => g.id), ["g1"]);
  assert.deepEqual(db.placeholders, [{ slot: "notice", label: "Eligibility and responsible-gaming notice", text: "[Eligibility and responsible-gaming notice: owner to supply]" }]);
  assert.equal(db.sample_card.marked, "Sample");
});

// ---- specs/design-brief.md ----

await test("the markdown has the plain sections, quotes with their message numbers, and no highlighted plan", () => {
  const md = renderDesignBrief(assembleDesignBrief(goodAnswer(), BRIEF));
  for (const h of ["# Design brief: PickPal", "## Audience and voice", "## What the owner told us", "## Messages to lead with", "## Plans", "## Look", "## Recommended direction (our proposal)", "## Handle with care", "## Gaps: questions for the owner"]) assert.ok(md.includes(h), h);
  assert.match(md, /Leagues: NFL, NBA, MLB and NHL, each while in season\. Owner said: "all 4 major leagues in America" \(message 2\)/);
  assert.match(md, /Font pairing: Heavy geometric \(headings Outfit at 800, text Inter, uppercase nav and labels\)\. Why: Bold and sporty\./);
  assert.match(md, /No plan is highlighted and no plan gets a badge/);
  assert.match(md, /every sample card carries a visible Sample label/);
  assert.match(md, /\[Eligibility and responsible-gaming notice: owner to supply\]/);
  assert.match(md, /Do not answer these on the page/);
  assert.doesNotMatch(md, /\n{3}/);
});

// ---- references: sites and brands the owner named as inspiration ----

const REF_MSGS: InterviewMessage[] = [
  ...INTERVIEW,
  { id: 20, kind: "bot", text: "Any sites or apps whose look you like?" },
  { id: 21, kind: "user", text: "i like the vibe of Sleeper and the clean cards on Underdog Fantasy" },
];
const withRefs = (refs: unknown[]) => ({ ...goodAnswer(), references: refs });

await test("a site or brand the owner named is kept with its quote and what to learn from it", () => {
  const a = withRefs([
    { name: "Sleeper", learn: ["pace", "density", "hero"], quote: "the vibe of Sleeper", msg: 21 },
    { name: "Underdog Fantasy", learn: ["density", "proof"], quote: "Underdog Fantasy", msg: 21 },
  ]);
  const db = assembleDesignBrief(a, BRIEF);
  const r = checkDesignBrief(db, REF_MSGS, BRIEF);
  assert.deepEqual(r.problems, []);
  assert.equal(r.quoteCheck.failed.length, 0, "a reference may be quoted by its name alone");
  assert.ok(r.ok);
  const md = renderDesignBrief(db);
  assert.match(md, /- A site the owner likes: Sleeper\. Learn only pace \(how much per screen\), density, how the hero presents the product from it\. Never copy its layout, wording, logos, art or exact palette\. Owner said: "the vibe of Sleeper" \(message 21\)\./);
  assert.match(md, /A site the owner likes: Underdog Fantasy\. Learn only density, how proof is shown/);
  assert.ok(md.indexOf("A site the owner likes") > md.indexOf("## Look") && md.indexOf("A site the owner likes") < md.indexOf("## Recommended direction"));
});

await test("a reference fails when its quote lacks the name, the owner never wrote it, or a lesson is not on the list", () => {
  const a = withRefs([
    { name: "Sleeper", learn: ["pace"], quote: "the clean cards on", msg: 21 },
    { name: "DraftKings", learn: ["hero"], quote: "the look of DraftKings", msg: 21 },
    { name: "Underdog Fantasy", learn: ["logo", "density"], quote: "Underdog Fantasy", msg: 21 },
  ]);
  const r = checkDesignBrief(assembleDesignBrief(a, BRIEF), REF_MSGS, BRIEF);
  assert.ok(r.problems.some((p) => /references\[0\] "Sleeper": the quote does not hold the name/.test(p)), r.problems.join("; "));
  assert.ok(r.quoteCheck.failed.some((f) => f.path === "references[1]" && f.why === "not in an owner message or the approved review"));
  assert.ok(r.problems.some((p) => /references\[2\] "Underdog Fantasy": "logo" is not one of pace, density, contrast, hero, proof, motion/.test(p)));
});

await test("the model is told to keep the owner's inspiration names and given the lesson list", () => {
  const s = designBriefSystem();
  assert.match(s, /Names the owner gave are kept, including sites, apps or brands they named as inspiration/);
  assert.match(s, /references: every site, app or brand the owner named/);
  assert.match(s, /pace, density, contrast, hero, proof, motion/);
  assert.ok((DESIGN_BRIEF_TOOL.input_schema.required as readonly string[]).includes("references"));
});

// ---- placeholders: one short label, shown on the page as it is ----

await test("a placeholder is a short label; a sentence or a note for the builder fails", () => {
  const a = goodAnswer();
  a.placeholders = [
    { slot: "notice", what: "Age and responsible-gambling notice." },
    { slot: "buttons", what: "Join now and Sign in have no links yet. Mark each one Set your link." },
    { slot: "hero", what: "A concept preview of sample pick cards until the owner sends a screenshot" },
    { slot: "footer", what: "Pages: About, Contact" },
  ];
  const db = assembleDesignBrief(a, BRIEF);
  assert.equal(db.placeholders[0].text, "[Age and responsible-gambling notice: owner to supply]", "code drops a closing full stop");
  const r = checkDesignBrief(db, INTERVIEW, BRIEF);
  const about = (i: number) => r.problems.filter((p) => p.startsWith(`placeholders[${i}]`));
  assert.deepEqual(about(0), []);
  assert.ok(about(1).some((p) => /is a sentence or a note/.test(p)) && about(1).some((p) => /has 15 words/.test(p)), about(1).join("; "));
  assert.ok(about(2).some((p) => /has 13 words; a placeholder is a label of at most 8 words/.test(p)));
  assert.ok(about(3).some((p) => /is a sentence or a note/.test(p)));
  assert.match(designBriefSystem(), /Notes for the builder \(links not set yet, a concept preview, pages that do not exist\) are never placeholders/);
});

await test("each line ends with one full stop, whether or not the model wrote one", () => {
  const a = goodAnswer();
  a.audience[0].meaning = "fans who bet for fun and fans who take it seriously.";
  a.owner_facts[0].meaning = "NFL, NBA, MLB and NHL.";
  a.messages[0].text = "Simple, fun picks";
  a.care[0].rule = "No win record";
  const md = renderDesignBrief(assembleDesignBrief(a, BRIEF));
  assert.doesNotMatch(md, /\.\./);
  assert.match(md, /- casual and serious fans: fans who bet for fun and fans who take it seriously\. Owner said:/);
  assert.match(md, /1\. Simple, fun picks\. \(paraphrase\) Owner said:/);
  assert.match(md, /- Betting: No win record\./);
});

// ---- the writer: one call, one retry ----

function stand(answers: (unknown | null)[]): { call: ToolCall; seen: any[] } {
  const seen: any[] = [];
  let i = 0;
  const call: ToolCall = async (req) => {
    seen.push(JSON.parse(JSON.stringify(req.messages)));
    const a = answers[Math.min(i++, answers.length - 1)];
    return { toolUse: a === null ? null : { id: `tu${i}`, input: a }, usage: { input: 1000, output: 2000, cacheRead: 0, cacheWrite: 3000 }, stopReason: a === null ? "end_turn" : "tool_use" };
  };
  return { call, seen };
}

await test("a brief that passes first time is one call, with its cost", async () => {
  const { call, seen } = stand([goodAnswer()]);
  const r = await writeDesignBrief({ messages: INTERVIEW, brief: BRIEF, call, model: "claude-opus-5-5" });
  assert.equal(r.attempts, 1);
  assert.equal(r.passed, true);
  assert.equal(seen.length, 1);
  assert.equal(r.costUsd, Math.round(costOf("claude-opus-5-5", { input: 1000, output: 2000, cacheRead: 0, cacheWrite: 3000 }) * 10000) / 10000);
  assert.equal(r.costUsd, 0.059);
  assert.ok(r.markdown?.startsWith("# Design brief: PickPal"));
  assert.equal(r.firstAttempt, null);
});

await test("a failing brief is retried once with the exact failures, and the retry can pass", async () => {
  const bad = goodAnswer();
  bad.audience[0].quote = "for every sports fan";
  const { call, seen } = stand([bad, goodAnswer()]);
  const r = await writeDesignBrief({ messages: INTERVIEW, brief: BRIEF, call, model: "claude-opus-5-5" });
  assert.equal(r.attempts, 2);
  assert.equal(r.passed, true);
  assert.equal(r.firstAttempt?.quoteCheck?.failed[0].path, "audience[0]");
  const retry = seen[1];
  assert.equal(retry.length, 3);
  assert.equal(retry[1].role, "assistant");
  assert.equal(retry[2].content[0].type, "tool_result");
  assert.equal(retry[2].content[0].is_error, true);
  assert.match(retry[2].content[0].content, /audience\[0\]: the quote "for every sports fan" is not word for word in any Owner line/);
  assert.equal(r.tokens.output, 4000);
});

await test("a brief that fails twice is kept with its failures and marked not passed", async () => {
  const bad = goodAnswer();
  bad.audience[0].quote = "for every sports fan";
  const { call, seen } = stand([bad, bad, goodAnswer()]);
  const r = await writeDesignBrief({ messages: INTERVIEW, brief: BRIEF, call, model: "claude-opus-5-5" });
  assert.equal(seen.length, 2, "only one retry");
  assert.equal(r.passed, false);
  assert.equal(r.quoteCheck?.failed[0].quote, "for every sports fan");
  assert.ok(r.json && r.markdown, "the failing brief is still saved");
});

await test("no tool call twice, or an error, gives no brief and never throws", async () => {
  const none = await writeDesignBrief({ messages: INTERVIEW, brief: BRIEF, call: stand([null]).call, model: "m" });
  assert.equal(none.passed, false);
  assert.ok(none.problems.some((p) => /did not call write_design_brief/.test(p)));
  const boom: ToolCall = async () => { throw new Error("Anthropic 529: overloaded"); };
  const err = await writeDesignBrief({ messages: INTERVIEW, brief: BRIEF, call: boom, model: "m" });
  assert.equal(err.passed, false);
  assert.match(err.error ?? "", /overloaded/);
});

await test("the model setting is its own, Opus by default", () => {
  assert.equal(designBriefModel({} as NodeJS.ProcessEnv), "claude-opus-5-5");
  assert.equal(designBriefModel({ ANTHROPIC_DESIGN_BRIEF_MODEL: "claude-sonnet-5-5" } as NodeJS.ProcessEnv), "claude-sonnet-5-5");
});

// ---- the worker step ----

await test("the worker step writes the markdown only for a brief that passed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "design-brief-"));
  const file = path.join(dir, "x.design-brief.md");
  const ok = await designBriefStep({ msgs: INTERVIEW, brief: BRIEF, file, env: {} as NodeJS.ProcessEnv, call: stand([goodAnswer()]).call });
  assert.equal(ok.passedToRunner, true);
  assert.match(await readFile(file, "utf8"), /^# Design brief: PickPal/);
  const bad = goodAnswer();
  bad.messages[0].quote = "made up";
  const file2 = path.join(dir, "y.design-brief.md");
  const no = await designBriefStep({ msgs: INTERVIEW, brief: BRIEF, file: file2, env: {} as NodeJS.ProcessEnv, call: stand([bad]).call });
  assert.equal(no.passedToRunner, false);
  assert.ok(no.skipped === null && no.quoteCheck?.failed.length === 1 && no.file === null);
  await assert.rejects(readFile(file2, "utf8"));
});

await test("the worker step is skipped when switched off, without a key or without an interview", async () => {
  const off = await designBriefStep({ msgs: INTERVIEW, brief: BRIEF, file: "/nope", env: { WORKER_DESIGN_BRIEF: "off" } as NodeJS.ProcessEnv });
  assert.match(off.skipped ?? "", /switched off/);
  const nokey = await designBriefStep({ msgs: INTERVIEW, brief: BRIEF, file: "/nope", env: {} as NodeJS.ProcessEnv });
  assert.match(nokey.skipped ?? "", /no ANTHROPIC_API_KEY/);
  const empty = await designBriefStep({ msgs: [], brief: BRIEF, file: "/nope", env: {} as NodeJS.ProcessEnv, call: stand([goodAnswer()]).call });
  assert.match(empty.skipped ?? "", /no interview/);
});

await test("the worker step has a time limit and never throws", async () => {
  const slow: ToolCall = () => new Promise(() => {});
  const r = await designBriefStep({ msgs: INTERVIEW, brief: BRIEF, file: "/nope", env: { WORKER_DESIGN_BRIEF_MS: "50" } as NodeJS.ProcessEnv, call: slow });
  assert.equal(r.passedToRunner, false);
  assert.ok(r.skipped === null && /^timed out: took longer than 50 ms, so the build went on without a design brief$/.test(r.error ?? ""), r.skipped === null ? r.error ?? "" : "");
  assert.equal(DESIGN_BRIEF_LIMIT_MS, 120_000, "two minutes by default");
});

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
