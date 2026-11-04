import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { briefCard, validateSiteBrief } from "../src/lib/builder/site-brief";
import { checklist } from "../worker/site-build";
import { SAAS_EXAMPLE_BRIEF } from "../src/lib/builder/site-pack.generated";
import { makeSiteInterviewer } from "../src/lib/agents/site-interviewer";
import { initialState } from "../src/lib/workspace/state";

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message : e}`); }
}
const example = () => JSON.parse(SAAS_EXAMPLE_BRIEF) as Record<string, any>;

test("the pack's example brief is a valid SaaS brief", () => {
  const v = validateSiteBrief(example(), "saas");
  assert.equal(v.ok, true, v.ok ? "" : v.error);
});
test("a SaaS brief is rejected by the waitlist check and the other way round", () => {
  assert.equal(validateSiteBrief(example(), "waitlist").ok, false);
  const waitlist = JSON.parse(readFileSync("../appnomics-runner/vertical-packs/site/brief.example.json", "utf8"));
  assert.equal(validateSiteBrief(waitlist, "saas").ok, false);
});
test("a pricing block with no plans, and a testimonials block with no quotes, are refused (nothing invented)", () => {
  const b = example();
  b.blocks = b.blocks.map((x: any) => (x.type === "pricing" ? { type: "pricing" } : x));
  const v = validateSiteBrief(b, "saas");
  assert.equal(v.ok, false);
  const b2 = example();
  b2.blocks = b2.blocks.map((x: any) => (x.type === "testimonials" ? { type: "testimonials", items: [] } : x));
  assert.equal(validateSiteBrief(b2, "saas").ok, false);
});
test("leaving the pricing and testimonials blocks out entirely is fine", () => {
  const b = example();
  b.blocks = b.blocks.filter((x: any) => x.type !== "pricing" && x.type !== "testimonials");
  assert.equal(validateSiteBrief(b, "saas").ok, true);
});
test("a signup without an email field is refused", () => {
  const b = example();
  b.signup.fields = [{ key: "name", type: "text" }];
  assert.equal(validateSiteBrief(b, "saas").ok, false);
});
test("the brief card shows the pills as the features and the signup button and message", () => {
  const c = briefCard(example());
  assert.equal(c.benefits.length, 3);
  assert.ok(c.benefits[0].title.length > 3);
  assert.deepEqual(c.fields, ["Work email (required)"]);
  assert.ok(c.thanks.length > 0);
});
test("the SaaS checklist does not promise image uploads or page editing screens", () => {
  const list = checklist(example()).join(" ");
  assert.ok(!/Blob|owner area says uploads/.test(list));
  assert.match(list, /ask the builder/);
});
test("unconfirmed claims reach the checklist", () => {
  const list = checklist(example());
  assert.ok(list.some((l) => l.includes("Make sure this is true")));
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
  assert.match(saas, /product website/);
  assert.match(saas, /Interview: a product site for a software product/);
  assert.match(waitlist, /waitlist website/);
  assert.ok(!/product site for a software product/.test(waitlist));
  console.log("PASS the interview prompt follows the project's pack");
} catch (e) { failed++; console.log(`FAIL the interview prompt follows the project's pack\n  ${e instanceof Error ? e.message : e}`); }
if (failed) process.exit(1);
