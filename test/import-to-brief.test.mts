import assert from "node:assert/strict";
import { currencyOf, importToBrief, priceToMinor } from "../src/lib/builder/import-to-brief";
import { fillFromPage, type ImportResult } from "../src/lib/builder/site-import";
import type { SiteSnapshot } from "../src/lib/builder/site-extract";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e); }
}
const base = { store: { name: "Studio Avant", sells: "x", artist: { name: "Neil Patrick" } }, sample_catalog: { mode: "generate_sample" }, orders: { currency: "USD" }, assumptions: ["The artist, all works, are fictional samples."] };
const result = {
  name: "Simone Russell Art", kind: "contemporary landscape artist", tagline: "Calm, warm landscapes", about: "I paint landscapes in London.",
  socials: [], images: [], actions: [], extras: [{ title: "Returns", body: "There is a 14-day return policy." }], testimonials: [{ quote: "Lovely work, highly recommended.", author: "Ron" }],
  signup: true, sourceUrl: "https://www.simonerussellart.com/", dropped: [], pagesRead: 3, readPages: [], textChars: 100, warnings: [], linksSeen: [],
  catalog: [{ title: "Dreams Tonite", price: "£3,500.00", image: "https://x/a.jpg" }, { title: "Rapture" }, { title: "Windfall", status: "Sold" }],
} as unknown as ImportResult;

await test("prices become whole minor units", () => {
  assert.equal(priceToMinor("£2,250.00"), 225000);
  assert.equal(priceToMinor("£395"), 39500);
  assert.equal(priceToMinor("$12.5"), 1250);
  assert.equal(priceToMinor(undefined), null);
});
await test("the currency comes from the prices", () => {
  assert.equal(currencyOf([{ title: "a", price: "£1" }], "USD"), "GBP");
  assert.equal(currencyOf([{ title: "a" }], "USD"), "USD");
});
await test("nothing is built without the owner confirming", () => {
  assert.throws(() => importToBrief(base, result, { ownerConfirmed: false } as never), /confirmed/);
});
await test("the brief carries real works, her words, and lists what was not found", () => {
  const { brief, notFound } = importToBrief(base, result, { ownerConfirmed: true, confirmedBy: "Rupesh, with Simone's okay" });
  const b = brief as Record<string, any>;
  assert.equal(b.store.name, "Simone Russell Art");
  assert.equal(b.sample_catalog, undefined);
  assert.equal(b.catalog.mode, "provided");
  assert.equal(b.catalog.works[0].price_minor, 350000);
  assert.equal(b.catalog.works[1].price_minor, null);
  assert.equal(b.catalog.works[2].status, "Sold");
  assert.equal(b.orders.currency, "GBP");
  assert.equal(b.content.sections[0].text, "There is a 14-day return policy.");
  assert.ok(notFound.includes("price of Rapture") && !notFound.includes("price of Windfall"));
  assert.ok(!b.assumptions.some((a: string) => /fictional/.test(a)));
  assert.equal((base as any).sample_catalog.mode, "generate_sample"); // the base is not changed
});
await test("price and sold mark come from the page lines, not the model", () => {
  const snap = { pages: [{ url: "u", title: "t", text: "Sunshine\n£2,250.00\nSOLD\nBeautiful Day\nWarm Nights\n£950.00" }] } as unknown as SiteSnapshot;
  const w = fillFromPage([{ title: "Sunshine", price: "£1" }, { title: "Beautiful Day" }, { title: "Warm Nights" }], snap);
  assert.equal(w[0].status, "Sold");
  assert.equal(w[0].price, undefined);
  assert.equal(w[1].price, undefined);
  assert.equal(w[2].price, "£950.00");
});
if (failed) process.exit(1);
