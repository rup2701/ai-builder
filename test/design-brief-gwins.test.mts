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
  TESTIMONIALS_RULE,
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
  const db = assembleDesignBrief(raw, G.brief);
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
  a.gaps = [
    { question: 'Where should the "Get my picks" button take people?', affects: ["main_button"], about: "main_button" },
    { question: "What is the link for Sign in?", affects: ["sign_in"], about: "sign_in" },
    { question: "What age rule and responsible-gambling notice should the page show?", affects: ["footer"], about: "notice" },
  ];
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
  assert.ok(db.care.some((c) => c.by === "code" && c.rule === TESTIMONIALS_RULE));
});

await test("GWins with what each line is about: the Monthly renewal gap conflicts with the lines that state renewal", () => {
  const a = asWritten();
  a.owner_facts.find((f: { topic: string }) => f.topic === "No auto-renewal").about = "renewal";
  a.messages[1].about = "renewal";
  a.gaps[2].about = "renewal";
  const { r } = check(a);
  const conflicts = r.problems.filter((x) => x.startsWith("gap g3 "));
  assert.equal(conflicts.length, 2, r.problems.join("\n"));
  assert.match(conflicts[0], /leaves renewal open, but owner_facts\[5\] states it/);
  assert.match(conflicts[1], /leaves renewal open, but messages\[1\] states it/);
});

await test("a gap about prices conflicts with the plans, which state names, prices and lengths", () => {
  const a = asWritten();
  a.gaps[3].about = "prices";
  const { r } = check(a);
  assert.ok(r.problems.some((x) => /^gap g4 .* leaves prices open, but plans\[0\] states it/.test(x)), r.problems.join("\n"));
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
  a.gaps[1].about = "links";
  assert.ok(check(a).r.ok, check(a).r.problems.join("\n"));
  a.gaps[1].about = "sign_in";
  assert.ok(check(a).r.problems.some((x) => /^gap g2 .* leaves sign_in open/.test(x)));
  assert.match(designBriefSystem(), /Where a button or the Sign in link goes, when it is not set yet, is about links/);
});

await test("the review label is not repeated inside a fact's own words", () => {
  const a = fixed();
  a.owner_facts.at(-1).meaning = "Owner approved at review: both passes are one-time";
  const { db } = check(a);
  assert.equal(db.owner_facts.at(-1)!.meaning, "both passes are one-time");
  assert.doesNotMatch(renderDesignBrief(db), /Owner approved at review: .*Owner approved at review/);
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
