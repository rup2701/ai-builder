// Slice A: the Builder knows the local business pack. A brief from the converter is valid, an unsafe one is not, and the template cannot start a site yet.
import assert from "node:assert/strict";
import { importToLocalBrief } from "../src/lib/builder/import-to-local-brief";
import { isLocal, normalizePack, packParam, validateSiteBrief } from "../src/lib/builder/site-brief";
import { LOCAL_EXAMPLE_BRIEF, LOCAL_QUESTIONS_JSON } from "../src/lib/builder/site-pack.generated";
import { LOCAL_NOT_READY, LOCAL_OPENER, makeSiteInterviewer, type Chat } from "../src/lib/agents/site-interviewer";
import { emptyState, pushMsg } from "../src/lib/workspace/state";
import type { ImportResult } from "../src/lib/builder/site-import";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e); }
}

const r = {
  name: "Test Kitchen", kind: "Indian and Himalayan restaurant", tagline: "Real food.", about: "We cook food from the hills.", address: "1 Test St", phone: "510-555-0100",
  hours: ["Open daily 10 to 10"], menu: [{ category: "Starters", items: [{ name: "Veg Samosa", price: "$6.95" }, { name: "Papadam" }] }],
  socials: [{ network: "instagram", url: "https://instagram.com/x" }], testimonials: [], images: [{ src: "https://img.example.com/1.jpg", alt: "Veg Samosa" }],
  actions: [{ label: "Reservations", url: "https://example.com/reserve" }], extras: [], sourceUrl: "https://example.com/",
} as unknown as ImportResult;
const test_ = { privateTest: true, by: "rp@example.com" } as const;
const owner = { ownerConfirmed: true, confirmedBy: "owner@example.com" } as const;

await test("pack names", () => {
  assert.equal(normalizePack("local"), "local");
  assert.equal(normalizePack("local-business"), "local");
  assert.equal(normalizePack("showcase"), "showcase");
  assert.equal(normalizePack("saas"), "showcase");
  assert.equal(normalizePack(undefined), "waitlist");
  assert.equal(normalizePack("nonsense"), "waitlist");
  assert.equal(isLocal("local"), true);
  assert.equal(isLocal("showcase"), false);
  assert.equal(packParam("local"), "local");
  assert.equal(packParam("saas"), "showcase");
  assert.equal(packParam("waitlist"), undefined);
  assert.equal(packParam(null), undefined);
});

await test("a brief from the converter is valid, as a private test and as a confirmed owner", () => {
  const a = validateSiteBrief(importToLocalBrief(r, test_).brief, "local");
  assert.ok(a.ok, a.ok ? "" : a.error);
  const b = validateSiteBrief(importToLocalBrief(r, owner).brief, "local");
  assert.ok(b.ok, b.ok ? "" : b.error);
});

await test("a brief with no consent, or consent that does not match, is refused", () => {
  const good = importToLocalBrief(r, owner).brief as Record<string, any>;
  const noConsent = { ...good }; delete noConsent.consent;
  assert.equal(validateSiteBrief(noConsent, "local").ok, false);
  const wrong = { ...good, consent: { private_test: true, by: "x" } };
  assert.equal(validateSiteBrief(wrong, "local").ok, false, "an owner brief cannot carry private test consent");
  const unconfirmedPics = { ...good, images: { ...good.images, owner_confirmed: false } };
  assert.equal(validateSiteBrief(unconfirmedPics, "local").ok, false);
  const priv = importToLocalBrief(r, test_).brief as Record<string, any>;
  assert.equal(validateSiteBrief({ ...priv, consent: { owner_confirmed: true, by: "x" } }, "local").ok, false, "a private test cannot claim the owner agreed");
});

await test("unsafe or wrong parts are refused with a plain message", () => {
  const good = importToLocalBrief(r, owner).brief as Record<string, any>;
  const http = validateSiteBrief({ ...good, links: { ...good.links, order: "http://example.com/order" } }, "local");
  assert.equal(http.ok, false);
  assert.match(http.ok ? "" : http.error, /links\.order.*https/);
  assert.equal(validateSiteBrief({ ...good, socials: [{ label: "x", url: "javascript:alert(1)" }] }, "local").ok, false);
  assert.equal(validateSiteBrief({ ...good, site: { ...good.site, kind: "waitlist" } }, "local").ok, false);
  assert.equal(validateSiteBrief({ ...good, look: { ...good.look, design: "other" } }, "local").ok, false);
  assert.equal(validateSiteBrief({ ...good, look: { ...good.look, accent: "red; x" } }, "local").ok, false);
  assert.equal(validateSiteBrief({ ...good, menu: { categories: [{ name: "A", items: [{ name: "" }] }] } }, "local").ok, false);
  assert.equal(validateSiteBrief({ ...good, testimonials: [{ quote: "  " }] }, "local").ok, false);
});

await test("the waitlist and showcase checks are unchanged", () => {
  assert.equal(validateSiteBrief(importToLocalBrief(r, owner).brief).ok, false, "a local brief is not a waitlist brief");
  assert.equal(validateSiteBrief(importToLocalBrief(r, owner).brief, "showcase").ok, false);
});

await test("the pack files are embedded", () => {
  const ex = JSON.parse(LOCAL_EXAMPLE_BRIEF);
  assert.equal(ex.site.kind, "local-business");
  assert.equal(ex.look.design, "restaurant_001");
  const q = JSON.parse(LOCAL_QUESTIONS_JSON);
  assert.equal(q.kind, "restaurant");
  assert.ok(q.questions.length >= 8);
});

await test("the local template cannot start a site yet, and says so without calling the model", async () => {
  let called = 0;
  const chat: Chat = async () => { called++; throw new Error("the model must not be called"); };
  const ai = makeSiteInterviewer(chat, "test-model");
  const start = pushMsg({ ...emptyState(), phase: "intake", sitePack: "local" }, { kind: "bot", text: LOCAL_OPENER });
  const res = await ai.turn(start, "Bayleaf, an Indian restaurant in Oakland");
  assert.equal(called, 0);
  const last = res.state.msgs[res.state.msgs.length - 1] as { kind: string; text: string };
  assert.equal(last.text, LOCAL_NOT_READY);
  assert.ok(!res.state.site?.brief, "no brief is saved");
  assert.match(LOCAL_OPENER, /website/i);
});

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("local-pack tests passed");
