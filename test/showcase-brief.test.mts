import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { briefCard, isShowcase, normalizePack, validateSiteBrief, yearlyPrice, perMonthOf } from "../src/lib/builder/site-brief";
import { checklist } from "../worker/site-build";
import { SHOWCASE_EXAMPLE_BRIEF } from "../src/lib/builder/site-pack.generated";
import { makeSiteInterviewer } from "../src/lib/agents/site-interviewer";
import { sectionsOf } from "../src/lib/agents/change-planner";
import { initialState } from "../src/lib/workspace/state";

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message : e}`); }
}
test("a link asks for the showcase pack only by its own names; everything else is the waitlist", () => {
  for (const p of ["showcase", "product-showcase", "saas"]) assert.equal(isShowcase(p), true, p);
  for (const p of [undefined, null, "", "waitlist", "other"]) assert.equal(isShowcase(p as string | undefined), false, String(p));
});
const example = () => JSON.parse(SHOWCASE_EXAMPLE_BRIEF) as Record<string, any>;
const pricing = (b: Record<string, any>) => b.blocks.find((x: any) => x.type === "pricing");

test("the pack's example brief is a valid showcase brief", () => {
  const v = validateSiteBrief(example(), "showcase");
  assert.equal(v.ok, true, v.ok ? "" : v.error);
});
test("a showcase brief is rejected by the waitlist check and the other way round", () => {
  assert.equal(validateSiteBrief(example(), "waitlist").ok, false);
  const waitlist = JSON.parse(readFileSync("../appnomics-runner/vertical-packs/site/brief.example.json", "utf8"));
  assert.equal(validateSiteBrief(waitlist, "showcase").ok, false);
});
test("the old sign-up brief shape is no longer accepted for the showcase pack", () => {
  const b = example(); b.site.kind = "saas";
  assert.equal(validateSiteBrief(b, "showcase").ok, false);
});
test("the example brief uses the new kind, and the old kind name still validates", () => {
  const b = example();
  assert.equal(b.site.kind, "product-showcase");
  b.site.kind = "saas-showcase";
  assert.equal(validateSiteBrief(b, "showcase").ok, true);
  assert.equal(validateSiteBrief(b, "saas").ok, true);
});
test("old pack names still open the showcase pack", () => {
  for (const p of ["showcase", "product-showcase", "saas"]) assert.equal(normalizePack(p), "showcase", p);
  for (const p of [undefined, null, "", "waitlist", "store"]) assert.equal(normalizePack(p), "waitlist", String(p));
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
  const v = validateSiteBrief(b, "showcase");
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.error, /must be 950/);
  const b2 = example();
  pricing(b2).plans[1].yearly_per_month = 240;
  const v2 = validateSiteBrief(b2, "showcase");
  assert.equal(v2.ok, false);
  assert.match(v2.ok ? "" : v2.error, /must be 239/);
});
test("more than three plans, or a plan with no monthly price, is refused", () => {
  const b = example(); pricing(b).plans = [1, 2, 3, 4].map((i) => ({ name: `P${i}`, monthly_price: i, yearly_price: yearlyPrice(i, 20), yearly_per_month: perMonthOf(yearlyPrice(i, 20)) }));
  assert.equal(validateSiteBrief(b, "showcase").ok, false);
  const b2 = example(); delete pricing(b2).plans[0].monthly_price;
  assert.equal(validateSiteBrief(b2, "showcase").ok, false);
});
test("monthly-only billing needs no yearly figures", () => {
  const b = example(); const p = pricing(b);
  p.billing = "monthly"; p.plans = p.plans.map((x: any) => ({ name: x.name, monthly_price: x.monthly_price }));
  assert.equal(validateSiteBrief(b, "showcase").ok, true);
});
test("pricing and testimonials can be switched off", () => {
  const b = example();
  b.blocks = b.blocks.filter((x: any) => x.type !== "pricing" && x.type !== "testimonials");
  assert.equal(validateSiteBrief(b, "showcase").ok, true);
});
test("the FAQ, how it works, closing call to action and footer are required", () => {
  for (const need of ["faq", "how_it_works", "closing_cta", "footer", "hero"]) {
    const b = example(); b.blocks = b.blocks.filter((x: any) => x.type !== need);
    assert.equal(validateSiteBrief(b, "showcase").ok, false, need);
  }
});
test("the main button link must be https or mailto, or empty", () => {
  for (const [link, ok] of [[null, true], ["https://example.com/start", true], ["mailto:hi@example.com", true], ["javascript:alert(1)", false], ["example.com", false]] as const) {
    const b = example(); b.main_button.link = link;
    assert.equal(validateSiteBrief(b, "showcase").ok, ok, String(link));
  }
});
test("a secondary button is optional, limited to https or mailto, and may have no link yet", () => {
  const b = example(); delete b.secondary_button;
  assert.equal(validateSiteBrief(b, "showcase").ok, true);
  const b2 = example(); b2.secondary_button = { label: "Watch demo", link: null };
  assert.equal(validateSiteBrief(b2, "showcase").ok, true);
  const b3 = example(); b3.secondary_button = { label: "Watch demo", link: "javascript:alert(1)" };
  assert.equal(validateSiteBrief(b3, "showcase").ok, false);
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

async function systemFor(pack?: "showcase") {
  let seen = "";
  const chat = async (req: { system: string }) => { seen = req.system; return { text: "ok", toolUses: [], content: [], usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } }; };
  await makeSiteInterviewer(chat as never, "m").turn({ ...initialState(), phase: "intake", ...(pack ? { sitePack: pack } : {}) }, "hello there");
  return seen;
}
try {
  const showcase = await systemFor("showcase");
  const waitlist = await systemFor();
  assert.match(showcase, /product showcase/i);
  assert.ok(!/SaaS/.test(showcase));
  assert.match(waitlist, /waitlist website/);
  assert.ok(!/product showcase/i.test(waitlist));
  console.log("PASS the interview prompt follows the project's pack");
} catch (e) { failed++; console.log(`FAIL the interview prompt follows the project's pack\n  ${e instanceof Error ? e.message : e}`); }

import { parsePlan, planReply } from "../src/lib/builder/plan-card";
const PLAN = `Thanks, that's clear. Here's the page plan for DispatchOS.

I've added these sections:
- Hero with the main button and a product image placeholder
- Benefits
- How it works
- Pricing
- Testimonials
- FAQ
- Closing call to action
- Footer

More sections to add:
- Examples gallery
- Comparison table
- Use-case cards

Want any of the extra ones, or want to drop one of the added ones? You can also ask for a section of your own.`;
test("the page plan is read out of Scout's message", () => {
  const p = parsePlan(PLAN)!;
  assert.equal(p.added.length, 8);
  assert.deepEqual(p.extra, ["Examples gallery", "Comparison table", "Use-case cards"]);
  assert.match(p.before, /DispatchOS/);
  assert.match(p.after, /^Want any of the extra/);
  assert.equal(parsePlan("What is your product?"), null);
});
test("the plan card's choices go back as one plain sentence", () => {
  const p = parsePlan(PLAN)!;
  assert.equal(planReply(p, new Set(p.added)), "Looks good. No changes to the plan.");
  const on = new Set(p.added.filter((n) => n !== "Testimonials"));
  on.add("Use-case cards");
  assert.equal(planReply(p, on), "Looks good. Add: Use-case cards. Drop: Testimonials.");
  // a locked section cannot be dropped, even if it is missing from the set
  const off = new Set(p.added.filter((n) => n !== "FAQ"));
  assert.equal(planReply(p, off), "Looks good. No changes to the plan.");
});
test("a sign-in link and a different pair of closing buttons are accepted; bad links are refused", () => {
  const b = example();
  b.sign_in = { label: "Sign in", link: "https://example.com/signin" };
  const closing = b.blocks.find((x: any) => x.type === "closing_cta");
  closing.cta = { label: "Claim your room", target: "custom", link: "https://example.com/claim" };
  closing.secondary_cta = { label: "Book a demo", target: "custom", link: null };
  assert.equal(validateSiteBrief(b, "showcase").ok, true);
  b.sign_in.link = "http://example.com/signin";
  assert.equal(validateSiteBrief(b, "showcase").ok, false);
  b.sign_in.link = null;
  closing.cta.link = "javascript:alert(1)";
  assert.equal(validateSiteBrief(b, "showcase").ok, false);
});
if (failed) process.exit(1);
