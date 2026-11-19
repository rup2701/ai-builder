/**
 * Design brief quality, with the live GWins brief as the failing case (test/fixtures/gwins-design-brief.json: the saved
 * chat, the approved brief and the design brief written at review, read from production on 19 Nov 2026).
 *
 * 1. The approved review counts as evidence: shown as Owner approved at review, never a gap.
 * 2. A line with a number quotes text that holds it; plans first, the price in the plan's quote.
 * 3. A line may not state what a gap in the same brief leaves open.
 * 4. A message to lead with is its quote, or labelled paraphrase.
 * 5. Betting, health and money: the care rules advise leaving Testimonials out; no sample testimonials.
 * No model and no database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  approvedReview,
  assembleDesignBrief,
  checkDesignBrief,
  designBriefSystem,
  interviewText,
  renderDesignBrief,
  sensitiveVertical,
  TESTIMONIALS_OWNER_ASKED,
  TESTIMONIALS_RULE,
  TESTIMONIALS_WINS,
  american,
  type DesignBrief,
  type InterviewMessage,
} from "../src/lib/builder/design-brief";

const G = JSON.parse(readFileSync(new URL("./fixtures/gwins-design-brief.json", import.meta.url), "utf8")) as {
  messages: InterviewMessage[];
  brief: Record<string, unknown>;
  savedDesignBrief: DesignBrief;
};

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

/** The saved GWins design brief turned back into the model's answer, as the model wrote it. */
function asWritten(): any {
  const d = structuredClone(G.savedDesignBrief);
  const why = (id: string) => d.proposals.find((p) => p.id === id)?.why ?? "";
  const pick = (c: { value: string; proposal: string }) => ({ value: c.value, why: why(c.proposal) });
  const lq = (x: { quote: string | null; msg: number | null }) => (x.quote ? { quote: x.quote, msg: x.msg } : null);
  return {
    name: lq(d.name),
    audience: d.audience,
    voice: d.voice,
    owner_facts: d.owner_facts,
    messages: d.messages,
    plans: d.plans,
    look_quotes: { mode: lq(d.look.mode), accent: lq(d.look.accent), tone: lq(d.look.tone) },
    references: d.references,
    direction: { pairing: pick(d.direction.pairing), motif: pick(d.direction.motif), hero_kind: pick(d.direction.hero_kind), signatures: d.direction.signatures.map(pick) },
    sample_card: { item: d.sample_card.item, fields: d.sample_card.fields },
    care: d.care,
    placeholders: d.placeholders.map((p) => ({ slot: p.slot, what: p.label })),
    other_proposals: d.proposals.filter((p) => !p.field.startsWith("direction.")).map(({ field, value, why }) => ({ field, value, why })),
    gaps: d.gaps.map(({ question, affects }) => ({ question, affects })),
  };
}
const check = (raw: unknown) => {
  const db = assembleDesignBrief(raw, G.brief, G.messages);
  return { db, r: checkDesignBrief(db, G.messages, G.brief) };
};

/** The GWins brief written to the new rules: what a passing answer looks like. */
function fixed(): any {
  const a = asWritten();
  // 2. Plans quote the approved review line that holds the price and the length.
  a.plans[0] = { ...a.plans[0], length: "7 days", quote: "Weekly $199 for 7 days", msg: 16 };
  a.plans[1] = { ...a.plans[1], quote: "Monthly $599 for 30 days", msg: 16 };
  // 1. The review says both passes are one-time: that is the owner's, approved at review.
  a.owner_facts = a.owner_facts.filter((f: { topic: string }) => f.topic !== "No auto-renewal");
  a.owner_facts.push({ topic: "No auto-renewal", meaning: "Both passes are one-time and end on their own; nothing renews automatically", about: "renewal", quote: "Both are one-time passes", msg: 16 });
  for (const f of a.owner_facts) f.about ??= f.topic === "Plans" ? "plans" : "other";
  // 4. Messages are labelled paraphrase; 3. the renewal message now rests on the review, with no gap against it.
  a.messages = [
    { ...a.messages[0], paraphrase: true, about: "coverage" },
    { text: "Short passes that end on their own: you renew only if you want to.", paraphrase: true, about: "renewal", quote: "Nothing renews automatically", msg: 16 },
    { ...a.messages[2], paraphrase: true, about: "audience" },
  ];
  // 1 and 3. No gap asks what the review settled (Monthly renewal, Per week), and the sports gap goes: the owner said all sports.
  // The link gaps are code's, from the brief.
  a.gaps = [{ question: "What age rule and responsible-gambling notice should the page show?", affects: ["footer"], about: "notice" }];
  // A hex color is quoted from text that holds it: the review line where Scout offered it.
  a.look_quotes.accent = { quote: "mint-cyan accent (#2EE6C4)", msg: 16 };
  // 5. No sample testimonials: code adds the rule that advises leaving them out.
  a.care = a.care.filter((c: { flag: string }) => c.flag !== "Proof");
  a.care.push({ flag: "Proof", rule: "No invented member counts, logos or results" });
  return a;
}

// ---- the approved review ----

await test("the approved review is found: the Scout message the owner answered just before the brief was saved", () => {
  const r = approvedReview(G.messages);
  assert.equal(r?.id, 16);
  assert.equal(r?.approvedAt, 17);
  assert.match(r!.text, /Both are one-time passes/);
  assert.match(interviewText(G.messages), /\[16\] Scout, the review the owner approved in message 17: /);
  assert.match(interviewText(G.messages), /\[12\] Scout: /, "other Scout lines are not marked");
  assert.equal(approvedReview(G.messages.slice(0, 16)), null, "no save, no approved review");
});

// ---- the live GWins brief fails ----

await test("GWins as written fails: plan quotes without their price, a number not in its quote, messages that reword their quote, sample testimonials", () => {
  const { r, db } = check(asWritten());
  assert.equal(r.ok, false);
  const p = r.problems.join("\n");
  // 2. Plans first.
  assert.match(r.problems[0], /^plans\[0\] "Weekly": the price \$199 is not in its quote "validity: 7 Days \(non-recurring\)"/);
  assert.match(r.problems[1], /^plans\[1\] "Monthly": the price \$599 is not in its quote "for a duration of 7\/30 days"/);
  assert.match(p, /messages\[1\]: 30 is not in its quote "validity: 7 Days \(non-recurring\)"/);
  // 4.
  for (const i of [0, 1, 2]) assert.match(p, new RegExp(`messages\\[${i}\\] .* is not its quote .*set paraphrase true`));
  // 5.
  assert.equal(sensitiveVertical(G.brief), "betting");
  assert.match(p, /betting product: do not keep sample testimonials/);
  assert.ok(db.care.some((c) => c.by === "code" && c.rule.startsWith(TESTIMONIALS_RULE)));
  // The accent hex quotes the owner's color words, which do not hold it, though the review does.
  assert.match(p, /look\.accent: the color #2EE6C4 is not in its quote "lightgreen\/cyan"/);
  // The weak line from the first rerun: a claim about both passes that quotes only the Weekly text.
  const a = asWritten();
  a.owner_facts[5] = { topic: "No auto-renewal", meaning: "Passes do not renew on their own. Both are one-time passes", quote: "7 Days (non-recurring)", msg: 11 };
  assert.ok(check(a).r.problems.some((x) => /^owner_facts\[5\] says something about every plan, but its quote "7 Days \(non-recurring\)" covers only Weekly/.test(x)), check(a).r.problems.join("\n"));
});

await test("GWins with what each line is about: the Monthly renewal gap conflicts with the lines that state renewal", () => {
  const a = asWritten();
  a.owner_facts.find((f: { topic: string }) => f.topic === "No auto-renewal").about = "renewal";
  a.messages[1].about = "renewal";
  a.gaps[2].about = "renewal";
  const { r } = check(a);
  const conflicts = r.problems.filter((x) => x.startsWith("gap ") && x.includes("Does the Monthly pass also end on its own"));
  assert.equal(conflicts.length, 2, r.problems.join("\n"));
  assert.match(conflicts[0], /leaves renewal open, but owner_facts\[5\] states it/);
  assert.match(conflicts[1], /leaves renewal open, but messages\[1\] states it/);
});

await test("a gap about prices conflicts with the plans, which state names, prices and lengths", () => {
  const a = asWritten();
  a.gaps[3].about = "prices";
  const { r } = check(a);
  assert.ok(r.problems.some((x) => /^gap g\d+ "You wrote "Per week".* leaves prices open, but plans\[0\] states it/.test(x)), r.problems.join("\n"));
});

// ---- the brief written to the new rules passes ----

await test("GWins fixed passes: review lines are evidence, plans quote their prices, no gap against a stated line", () => {
  const { r, db } = check(fixed());
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.quoteCheck.failed, []);
  assert.ok(r.ok);
  assert.deepEqual(db.plans.map((p) => [p.msg, p.from]), [[16, "review"], [16, "review"]]);
  assert.equal(db.owner_facts.find((f) => f.topic === "No auto-renewal")?.from, "review");
});

await test("a quote the model cited as an owner line but found only in the review is moved to the review", () => {
  const a = fixed();
  a.plans[0].msg = 11;
  const { r, db } = check(a);
  assert.ok(r.ok, r.problems.join("\n"));
  assert.deepEqual([db.plans[0].msg, db.plans[0].from], [16, "review"]);
  assert.ok(r.quoteCheck.msgCorrected >= 1);
});

await test("another Scout line is still never evidence", () => {
  const a = fixed();
  a.owner_facts.push({ topic: "Look", meaning: "mint-cyan", about: "look", quote: "a bright mint-cyan (#2EE6C4) as the main colour", msg: 14 });
  const { r } = check(a);
  assert.deepEqual(r.quoteCheck.failed.map((f) => f.why), ["not in an owner message or the approved review"]);
});

await test("the markdown says Owner approved at review, labels paraphrase, advises leaving Testimonials out, and asks no settled question", () => {
  const { db } = check(fixed());
  const md = renderDesignBrief(db);
  assert.match(md, /- Weekly, \$199, 7 days\. Owner approved at review: "Weekly \$199 for 7 days" \(message 16\)\./);
  assert.match(md, /No auto-renewal: .*Owner approved at review: "Both are one-time passes" \(message 16\)\./);
  assert.match(md, /2\. Short passes that end on their own: .* \(paraphrase\) Owner approved at review: "Nothing renews automatically" \(message 16\)\./);
  assert.match(md, /- Testimonials: We advise leaving the Testimonials section out\..*Do not show sample testimonials/);
  assert.doesNotMatch(md, /Does the Monthly pass also end on its own/);
  assert.doesNotMatch(md, /or is something charged weekly/);
  assert.doesNotMatch(md, /Testimonials stay marked Sample/);
});

await test("a link not set yet is its own topic: a line that says Sign in exists does not block the gap for its link", () => {
  const a = fixed();
  a.owner_facts.push({ topic: "Sign in", meaning: "Sign in is shown in the header and footer", about: "sign_in", quote: '"Sign in" appears in the header and footer', msg: 16 });
  // The code gap for the Sign in link stands next to the line that says Sign in exists.
  assert.ok(check(a).r.ok, check(a).r.problems.join("\n"));
  assert.ok(check(a).db.gaps.some((g) => g.by === "code" && g.question === "What is the link for Sign in?"));
  // A model gap that leaves Sign in itself open still conflicts with that line.
  a.gaps.push({ question: "Should Sign in show in the header at all?", affects: ["nav"], about: "sign_in" });
  assert.ok(check(a).r.problems.some((x) => /^gap g\d+ "Should Sign in show in the header at all\?" leaves sign_in open/.test(x)));
  assert.match(designBriefSystem(), /Where a button or the Sign in link goes, when it is not set yet, is about links/);
});

await test("the review label is not repeated inside a fact's own words", () => {
  const a = fixed();
  a.owner_facts.at(-1).meaning = "Owner approved at review: both passes are one-time";
  const { db } = check(a);
  assert.equal(db.owner_facts.at(-1)!.meaning, "both passes are one-time");
  assert.doesNotMatch(renderDesignBrief(db), /Owner approved at review: .*Owner approved at review/);
});

await test("a hex the owner never typed and the review never showed is not required: the owner's color word stands", () => {
  const a = fixed();
  a.look_quotes.accent = { quote: "lightgreen/cyan", msg: 13 };
  const review = G.messages.find((m) => m.id === 16)!;
  const messages = G.messages.map((m) => (m === review ? { ...m, text: String(m.text).replace(/ \(#2EE6C4\)/g, "") } : m));
  const db = assembleDesignBrief(a, G.brief, messages);
  assert.ok(!checkDesignBrief(db, messages, G.brief).problems.some((x) => x.startsWith("look.accent")));
});

await test("a line with a hex quotes text that holds it", () => {
  const a = fixed();
  a.owner_facts.push({ topic: "Accent", meaning: "mint-cyan, #2EE6C4", about: "look", quote: "lightgreen/cyan for primary color", msg: 13 });
  assert.ok(check(a).r.problems.some((x) => /owner_facts\[\d+\]: the color #2ee6c4 is not in its quote/.test(x)));
});

await test("a quote with double quotes inside is shown with single quotes, never doubled", () => {
  const a = fixed();
  a.owner_facts.push({ topic: "Sign in", meaning: "Sign in is shown in the header and footer", about: "sign_in", quote: '"Sign in" appears in the header and footer', msg: 16 });
  const md = renderDesignBrief(check(a).db);
  assert.match(md, /Owner approved at review: "'Sign in' appears in the header and footer" \(message 16\)\./);
  assert.doesNotMatch(md, /""/);
});

await test("the link gaps come from the brief, by code: the model's own link gaps are dropped, never lost", () => {
  const a = fixed();
  a.gaps = a.gaps.filter((g: { about: string }) => g.about !== "links" && g.about !== "main_button" && g.about !== "sign_in");
  const { db, r } = check(a);
  const code = db.gaps.filter((g) => g.by === "code").map((g) => g.question);
  assert.deepEqual(code.slice(0, 2), ['Where should the "Get my picks" button take people?', "What is the link for Sign in?"]);
  assert.ok(r.ok, r.problems.join("\n"));
  const b = fixed();
  b.gaps.push({ question: "Where does Get my picks go?", affects: ["main_button"], about: "links" });
  assert.equal(check(b).db.gaps.filter((g) => /Get my picks/.test(g.question)).length, 1, "one gap per link");
  const linked = { ...G.brief, main_button: { ...(G.brief.main_button as object), link: "https://example.com/join" } };
  assert.ok(!assembleDesignBrief(fixed(), linked, G.messages).gaps.some((g) => /Get my picks/.test(g.question)), "no gap once the link is set");
});

await test("all sports is coverage; which sports by name is its own gap, with no conflict", () => {
  const a = fixed();
  a.owner_facts.find((f: { topic: string }) => f.topic === "Sports covered").about = "coverage";
  a.gaps.push({ question: "Which sports do you cover, so we can name them?", affects: ["benefits"], about: "named_items" });
  const { r } = check(a);
  assert.ok(r.ok, r.problems.join("\n"));
  assert.match(designBriefSystem(), /which ones by name is a gap about named_items/);
});

await test("the care rule wins over an approved Testimonials section until the owner says otherwise, and code asks the owner", () => {
  const { db } = check(fixed());
  const rule = db.care.find((c) => c.by === "code")!;
  assert.equal(rule.rule, `${TESTIMONIALS_RULE}. ${TESTIMONIALS_WINS}`);
  const ask = db.gaps.filter((g) => g.by === "code" && g.about === "proof");
  assert.deepEqual(ask.map((g) => g.question), ["We advise leaving Testimonials out on a betting site. Do you have real quotes from members that you want to show?"]);
  const md = renderDesignBrief(db);
  assert.match(md, /this care rule wins until the owner says otherwise: build the page without it, even though specs\/brief\.json lists it/);
  // The model's own testimonials question is dropped for code's.
  const a = fixed();
  a.gaps.push({ question: "Do you have real testimonials, or should we remove the section?", affects: ["testimonials"], about: "proof" });
  assert.equal(check(a).db.gaps.filter((g) => /testimonial/i.test(g.question)).length, 1);
  // The owner said otherwise: real quotes only, and no question.
  const asked = [...G.messages, { id: 99, kind: "user", text: "please keep testimonials, I will send real ones from members" }];
  const db2 = assembleDesignBrief(fixed(), G.brief, asked);
  assert.equal(db2.care.find((c) => c.by === "code")!.rule, `${TESTIMONIALS_RULE}. ${TESTIMONIALS_OWNER_ASKED}`);
  assert.ok(!db2.gaps.some((g) => g.about === "proof"));
});

await test("American spelling: color, never colour", () => {
  const md = renderDesignBrief(check(fixed()).db);
  assert.match(md, /- Color mode: dark\./);
  assert.match(md, /- Accent color: #2EE6C4/);
  assert.doesNotMatch(md, /colour/i);
  // The pack's own lists (runner direction.json) still say colour; they change in the runner.
  assert.doesNotMatch(designBriefSystem().split("The lists (use these names exactly)")[0], /colour/i);
});

await test("the model's own colour becomes color; the owner's quotes keep their spelling; care flags start with a capital", () => {
  const a = fixed();
  a.owner_facts.push({ topic: "Look", meaning: "light green/cyan main colour", about: "look", quote: "sporty/playful, dark, lightgreen/cyan", msg: 13 });
  a.care.push({ flag: "betting", rule: "No win records" });
  a.voice.quotes.push({ quote: "lightgreen/cyan for primary color", msg: 13 });
  const md = renderDesignBrief(check(a).db);
  assert.match(md, /- Look: light green\/cyan main color\./);
  assert.match(md, /- Betting: No win records\./);
  assert.match(american('Main colour. Owner said: "my colour" (message 3).'), /^Main color\. Owner said: "my colour" \(message 3\)\.$/);
});

await test("no testimonials rule for a product that is not betting, health or money", () => {
  const brief = { ...G.brief, site: { name: "Mealwise", industry: "dinner planning app", one_liner: "Plan a week of dinners in five minutes" } };
  assert.equal(sensitiveVertical(brief), null);
  const db = assembleDesignBrief({ ...fixed(), care: [] }, brief);
  assert.ok(!db.care.some((c) => c.by === "code"));
  assert.equal(sensitiveVertical({ site: { industry: "online therapy sessions" } }), "health");
  assert.equal(sensitiveVertical({ site: { industry: "stock trading signals" } }), "money");
});

await test("the model is told the new rules", () => {
  const s = designBriefSystem();
  assert.match(s, /The approved review is evidence/);
  assert.match(s, /Owner approved at review/);
  assert.match(s, /quote the line that holds the price/);
  assert.match(s, /A line may not state what a gap leaves open/);
  assert.match(s, /set paraphrase true/);
  assert.match(s, /we advise leaving Testimonials out/);
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
