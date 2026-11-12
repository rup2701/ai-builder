import assert from "node:assert/strict";
import { cleanBody, httpsOnly, importToLocalBrief } from "../src/lib/builder/import-to-local-brief";
import type { ImportResult } from "../src/lib/builder/site-import";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e); }
}
const FOOTER = "© 2024 by Test Kitchen 1 Test St Tel 555-0100 Open daily 10 to 10";
const r = {
  name: "Test Kitchen", kind: "Indian and Himalayan restaurant", tagline: "Real food, cooked to order.", about: "We cook food from the Himalayas and India.",
  address: "1 Test St, Oakland, CA", phone: "510-555-0100", hours: ["Open Everyday : 10:00 AM to 10:00 PM"],
  menu: [{ category: "Appetizers", items: [{ name: "Veg Samosa", price: "$6.95" }, { name: "Papadam" }] }, { category: "Momo", items: [{ name: "Veg Steam Momo", price: "$15" }] }],
  socials: [], testimonials: [], signup: true, sourceUrl: "https://example.com/", dropped: [], pagesRead: 4, readPages: [], textChars: 100, warnings: [], linksSeen: [], catalog: [],
  images: [{ src: "https://img.example.com/1.jpg", alt: "Kale Chat" }, { src: "https://img.example.com/2.jpg", alt: "outdoor dining" }, { src: "https://img.example.com/3.jpg", alt: "Chef and Waitress" }, { src: "https://img.example.com/4.jpg", alt: "" }, { src: "http://img.example.com/5.jpg", alt: "insecure" }],
  actions: [{ label: "Menu", url: "https://example.com/menu" }, { label: "Catering", url: "https://example.com/catering" }, { label: "Contact & Reservation", url: "https://example.com/contact-reservation" }, { label: "Online Orders", url: "https://example.com/online-ordering" }],
  extras: [
    { title: "Our story", body: "We pride ourselves on food.\nOrder Now", url: "https://example.com/ourstory" },
    { title: "Customized catering menus", body: "Choose your own spread.", url: "https://example.com/catering" },
    { title: "Tailored catering for events", body: `Every event is unique.\n${FOOTER}`, url: "https://example.com/catering" },
    { title: "Fresh catering delivery", body: "Choose your own spread.", url: "https://example.com/catering" },
    { title: "Outdoor dining", body: "Dine outside.", url: "https://example.com/services-1" },
  ],
} as unknown as ImportResult;
const test_ = { privateTest: true, by: "rp@example.com" } as const;

await test("nothing is built without consent", () => {
  assert.throws(() => importToLocalBrief(r, { ownerConfirmed: false } as never), /confirmed/);
  assert.throws(() => importToLocalBrief(r, { privateTest: true } as never), /confirmed/);
});
await test("a site with no name or no sign of a restaurant is refused", () => {
  assert.throws(() => importToLocalBrief({ ...r, name: undefined }, test_), /no name/);
  assert.throws(() => importToLocalBrief({ ...r, menu: [], kind: "landscape painter" }, test_), /restaurants/);
});
await test("the brief names the pack, the design and the kind", () => {
  const { brief } = importToLocalBrief(r, test_);
  assert.deepEqual((brief.site as { kind: string }).kind, "local-business");
  assert.equal((brief.look as { design: string }).design, "restaurant_001");
  assert.equal((brief.site as { name: string }).name, "Test Kitchen");
});
await test("the menu keeps names and prices exactly, and a missing price stays missing", () => {
  const { brief } = importToLocalBrief(r, test_);
  const cats = (brief.menu as { categories: { name: string; items: { name: string; price?: string }[] }[] }).categories;
  assert.deepEqual(cats[0], { name: "Appetizers", items: [{ name: "Veg Samosa", price: "$6.95" }, { name: "Papadam" }] });
  assert.equal("price" in cats[0].items[1], false);
  assert.equal((brief.menu as { show_prices: boolean }).show_prices, true);
});
await test("links come only from the site's own https addresses", () => {
  const { brief } = importToLocalBrief(r, test_);
  const l = brief.links as Record<string, unknown>;
  assert.equal(l.reserve, "https://example.com/contact-reservation");
  assert.equal(l.order, "https://example.com/online-ordering");
  assert.equal(l.catering, "https://example.com/catering");
  const none = importToLocalBrief({ ...r, actions: [{ label: "Reservations", url: "http://example.com/r" }, { label: "Order", url: "javascript:alert(1)" }] } as ImportResult, test_);
  assert.equal((none.brief.links as Record<string, unknown>).reserve, null);
  assert.equal((none.brief.links as Record<string, unknown>).order, null);
  assert.ok(none.notFound.includes("booking link") && none.notFound.includes("online ordering link"));
});
await test("pictures: only https ones with a description, and the rest are counted", () => {
  const { brief, notFound } = importToLocalBrief(r, test_);
  const g = (brief.images as { gallery: { alt: string }[] }).gallery;
  assert.deepEqual(g.map((x) => x.alt), ["Kale Chat", "outdoor dining", "Chef and Waitress"]);
  assert.ok(notFound.some((n) => /2 pictures with no description/.test(n)));
});
await test("hero and about pictures are chosen by their description only", () => {
  const { brief } = importToLocalBrief(r, test_);
  const im = brief.images as { hero: { alt: string } | null; about: { alt: string } | null };
  assert.equal(im.hero?.alt, "outdoor dining");
  assert.equal(im.about?.alt, "Chef and Waitress");
  const bare = importToLocalBrief({ ...r, images: [{ src: "https://x/1.jpg", alt: "Kale Chat" }] } as ImportResult, test_).brief.images as { hero: unknown };
  assert.equal(bare.hero, null, "no guess when no description fits");
});
await test("catering words lose the footer line and button labels, and repeats are dropped", () => {
  const { brief } = importToLocalBrief(r, test_);
  const c = brief.catering as { features: { title: string; body: string }[] };
  assert.deepEqual(c.features.map((f) => f.title), ["Customized catering menus", "Tailored catering for events"]);
  assert.equal(c.features[1].body, "Every event is unique.");
  assert.ok(!JSON.stringify(brief).includes("©"));
  assert.equal(cleanBody("Hello\nOrder Now\nWorld"), "Hello\nWorld");
  assert.equal(importToLocalBrief({ ...r, extras: [] } as ImportResult, test_).brief.catering, null);
});
await test("the about heading is the site's own, and the text is copied", () => {
  const { brief } = importToLocalBrief(r, test_);
  assert.deepEqual(brief.about, { heading: "Our story", body: "We cook food from the Himalayas and India." });
  assert.equal(importToLocalBrief({ ...r, about: undefined }, test_).brief.about, null);
});
await test("what the site did not give is listed, and nothing is made up", () => {
  const { brief, notFound } = importToLocalBrief(r, test_);
  for (const k of ["email", "customer reviews", "social links"]) assert.ok(notFound.includes(k), k);
  assert.deepEqual(brief.testimonials, []);
  assert.deepEqual(brief.socials, []);
  assert.equal((brief.contact as { email: unknown }).email, null);
});
await test("a private test is marked so the runner refuses to deploy it", () => {
  const t = importToLocalBrief(r, test_).brief;
  assert.equal(t.private_test, true);
  assert.match(String(t.purpose), /Private test/);
  const o = importToLocalBrief(r, { ownerConfirmed: true, confirmedBy: "owner@example.com" }).brief;
  assert.equal("private_test" in o, false);
  assert.equal((o.images as { owner_confirmed: boolean }).owner_confirmed, true);
  assert.equal((t.images as { owner_confirmed: boolean }).owner_confirmed, false);
});
await test("the accent is a default unless a valid colour is given", () => {
  assert.equal((importToLocalBrief(r, test_).brief.look as { accent: string }).accent, "#c2410c");
  assert.equal((importToLocalBrief(r, test_, { accent: "#112233" }).brief.look as { accent: string }).accent, "#112233");
  assert.equal((importToLocalBrief(r, test_, { accent: "red; x" }).brief.look as { accent: string }).accent, "#c2410c");
});
await test("httpsOnly", () => {
  assert.equal(httpsOnly("https://a.com"), "https://a.com");
  assert.equal(httpsOnly("http://a.com"), null);
  assert.equal(httpsOnly("javascript:x"), null);
  assert.equal(httpsOnly(undefined), null);
});
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("import-to-local-brief tests passed");
