import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { briefCard, validateSiteBrief, yearlyPrice, perMonthOf } from "../src/lib/builder/site-brief";
import { checklist } from "../worker/site-build";
import { SAAS_EXAMPLE_BRIEF } from "../src/lib/builder/site-pack.generated";
import { makeSiteInterviewer } from "../src/lib/agents/site-interviewer";
import { sectionsOf } from "../src/lib/agents/change-planner";
import { initialState } from "../src/lib/workspace/state";

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message : e}`); }
}
const example = () => JSON.parse(SAAS_EXAMPLE_BRIEF) as Record<string, any>;
const pricing = (b: Record<string, any>) => b.blocks.find((x: any) => x.type === "pricing");

test("the pack's example brief is a valid showcase brief", () => {
  const v = validateSiteBrief(example(), "saas");
  assert.equal(v.ok, true, v.ok ? "" : v.error);
});
test("a showcase brief is rejected by the waitlist check and the other way round", () => {
  assert.equal(validateSiteBrief(example(), "waitlist").ok, false);
  const waitlist = JSON.parse(readFileSync("../appnomics-runner/vertical-packs/site/brief.example.json", "utf8"));
  assert.equal(validateSiteBrief(waitlist, "saas").ok, false);
});
test("the old sign-up brief shape is no longer accepted for the SaaS pack", () => {
  const b = example(); b.site.kind = "saas";
  assert.equal(validateSiteBrief(b, "saas").ok, false);
});
test("yearly prices are whole dollars rounded down, from the formula", () => {
  assert.equal(yearlyPrice(99, 20), 950);
  assert.equal(yearlyPrice(299, 20), 2870);
  assert.equal(yearlyPrice(250, 20), 2400); // 3000 x 0.8 must not land on 2399
  assert.equal(yearlyPrice(19.99, 20), 191);
  assert.equal(perMonthOf(950), 79);
  assert.equal(perMonthOf(2870), 239);
});
test("a wrong yearly figure is refused with the correct one named", () => {
  const b = example();
  pricing(b).plans[0].yearly_price = 951;
  const v = validateSiteBrief(b, "saas");
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.error, /must be 950/);
  const b2 = example();
  pricing(b2).plans[1].yearly_per_month = 240;
  const v2 = validateSiteBrief(b2, "saas");
  assert.equal(v2.ok, false);
  assert.match(v2.ok ? "" : v2.error, /must be 239/);
});
test("more than three plans, or a plan with no monthly price, is refused", () => {
  const b = example(); pricing(b).plans = [1, 2, 3, 4].map((i) => ({ name: `P${i}`, monthly_price: i, yearly_price: yearlyPrice(i, 20), yearly_per_month: perMonthOf(yearlyPrice(i, 20)) }));
  assert.equal(validateSiteBrief(b, "saas").ok, false);
  const b2 = example(); delete pricing(b2).plans[0].monthly_price;
  assert.equal(validateSiteBrief(b2, "saas").ok, false);
});
test("monthly-only billing needs no yearly figures", () => {
  const b = example(); const p = pricing(b);
  p.billing = "monthly"; p.plans = p.plans.map((x: any) => ({ name: x.name, monthly_price: x.monthly_price }));
  assert.equal(validateSiteBrief(b, "saas").ok, true);
});
test("pricing and testimonials can be switched off", () => {
  const b = example();
  b.blocks = b.blocks.filter((x: any) => x.type !== "pricing" && x.type !== "testimonials");
  assert.equal(validateSiteBrief(b, "saas").ok, true);
});
test("the FAQ, how it works, closing call to action and footer are required", () => {
  for (const need of ["faq", "how_it_works", "closing_cta", "footer", "hero"]) {
    const b = example(); b.blocks = b.blocks.filter((x: any) => x.type !== need);
    assert.equal(validateSiteBrief(b, "saas").ok, false, need);
  }
});
test("the main button link must be https or mailto, or empty", () => {
  for (const [link, ok] of [[null, true], ["https://example.com/start", true], ["mailto:hi@example.com", true], ["javascript:alert(1)", false], ["example.com", false]] as const) {
    const b = example(); b.main_button.link = link;
    assert.equal(validateSiteBrief(b, "saas").ok, ok, String(link));
  }
});
test("the brief card reads the bento benefits, the tone and the placeholders", () => {
  const c = briefCard(example());
  assert.equal(c.benefits.length, 3);
  assert.ok(c.look.includes("calm"));
  assert.ok(c.placeholders.length >= 3);
  assert.deepEqual(c.fields, []);
});
test("the planner knows the showcase sections", () => {
  const names = sectionsOf(example()).join(" | ");
  assert.match(names, /FAQ/);
  assert.match(names, /benefits grid/);
});
test("the showcase checklist lists placeholders and has no owner-area or sign-up lines", () => {
  const list = checklist(example()).join(" ");
  assert.match(list, /Sample|placeholder|empty/i);
  assert.ok(!/owner area|sign-ups|Blob/i.test(list));
  assert.match(list, /ask me in the chat/);
});

async function systemFor(pack?: "saas") {
  let seen = "";
  const chat = async (req: { system: string }) => { seen = req.system; return { text: "ok", toolUses: [], content: [], usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } }; };
  await makeSiteInterviewer(chat as never, "m").turn({ ...initialState(), phase: "intake", ...(pack ? { sitePack: pack } : {}) }, "hello there");
  return seen;
}
try {
  const saas = await systemFor("saas");
  const waitlist = await systemFor();
  assert.match(saas, /SaaS product showcase/);
  assert.match(waitlist, /waitlist website/);
  assert.ok(!/SaaS product showcase/.test(waitlist));
  console.log("PASS the interview prompt follows the project's pack");
} catch (e) { failed++; console.log(`FAIL the interview prompt follows the project's pack\n  ${e instanceof Error ? e.message : e}`); }
if (failed) process.exit(1);
