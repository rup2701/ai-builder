import assert from "node:assert/strict";
import { crawlSite, pickSubpages, extractPage, MAX_PAGES } from "../src/lib/builder/site-extract";
import { fillFromPage, splitPrints, type ImportResult, type Work } from "../src/lib/builder/site-import";
import { importToBrief } from "../src/lib/builder/import-to-brief";

/** A Squarespace artist site that sells originals and prints: menu folders, a prints page with starting prices, and prints named after originals. */
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e); }
}
const pub = async () => ["93.184.216.34"];
const page = (h: string) => new Response(h, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const doc = (title: string, body: string) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const NAV = ["selectedworks|Selected Works", "originals|Originals", "portfolio-1|Folder: Portfolio", "fineartprints|Fine Art Prints", "printsfull|Folder: Prints", "about|Artist Bio", "about-1|Folder: About", "contact-1|Contact", "cart|0", "privacy-policy|Privacy Policy"]
  .map((x) => { const [p, t] = x.split("|"); return `<a href="/${p}">${t}</a>`; }).join("");
const HOME = doc("ADA LANE ART", `${NAV}<p>Original art and prints</p>`);
const WORKS = doc("Selected Works", `<p>"hallucinating joy," 2026, 30x24 charcoal/pastel/acrylic on canvas</p><p>"bathers," 2026, 24x30 charcoal/acrylic on canvas</p>`);
const ORIGINALS = doc("Originals", `<p>"Bathers"</p><p>$1,200.00</p><p>Add to Cart</p>`);
const PRINTS = doc("Fine Art Prints", `<h2>Fine Art Prints</h2><p>"Hallucinating Joy"</p><p>$95.00</p><p>"Cactus Tree"</p><p>from $50.00</p>`);
const ABOUT = doc("About", `<p>Ada Lane paints in Los Angeles.</p>`);
const CONTACT = doc("Contact", `<p>Write to Ada.</p>`);
// Like Squarespace, a folder opens its first page.
const fetchImpl = (async (u: string) => {
  const p = new URL(u).pathname;
  return page(p === "/selectedworks" || p === "/portfolio-1" ? WORKS : p === "/originals" ? ORIGINALS : p === "/fineartprints" || p === "/printsfull" ? PRINTS : p === "/about" || p === "/about-1" ? ABOUT : p === "/contact-1" ? CONTACT : HOME);
}) as unknown as typeof fetch;

await test("the prints page is picked with the works, and menu folders are not", () => {
  const p = extractPage(HOME, "https://adalane.example.com/");
  const chosen = pickSubpages(p.links, "https://adalane.example.com/").map((u) => new URL(u).pathname);
  assert.ok(chosen.includes("/fineartprints"));
  assert.ok(chosen.indexOf("/fineartprints") < chosen.indexOf("/contact-1"), "prints rank with the works, ahead of contact");
  for (const f of ["/portfolio-1", "/printsfull", "/about-1"]) assert.ok(!chosen.includes(f), f);
});
await test("the link list says why each page was not read", async () => {
  const s = await crawlSite("adalane.example.com", { fetchImpl, resolve: pub });
  assert.ok(s.pages.length <= MAX_PAGES);
  const link = (p: string) => s.linksSeen.find((l) => new URL(l.href).pathname === p)!;
  assert.equal(link("/fineartprints").read, true);
  for (const f of ["/portfolio-1", "/printsfull", "/about-1"]) { assert.equal(link(f).read, false); assert.match(link(f).why ?? "", /menu folder/); }
  assert.match(link("/cart").why ?? "", /not a page name/);
  assert.equal(link("/about").why, undefined);
});
await test("pages over the limit are named as such", async () => {
  const many = doc("Studio", Array.from({ length: 12 }, (_, i) => `<a href="/work-${i}">Work ${i}</a>`).join(""));
  const f = (async (u: string) => page(new URL(u).pathname === "/" ? many : doc("W", `<p>Work page ${u}</p>`))) as unknown as typeof fetch;
  const s = await crawlSite("studio.example.com", { fetchImpl: f, resolve: pub });
  assert.equal(s.pages.length, MAX_PAGES);
  assert.ok(s.linksSeen.some((l) => !l.read && /page limit/.test(l.why ?? "")));
});
await test("a print and its original share a name but not a price", async () => {
  const s = await crawlSite("adalane.example.com", { fetchImpl, resolve: pub });
  // The model gave the original the print's price; the page lists the original with no price.
  const works: Work[] = [{ title: "Hallucinating Joy", year: "2026", medium: "charcoal/pastel/acrylic on canvas", price: "$95.00" }, { title: "Bathers", year: "2026" }, { title: "Cactus Tree" }];
  const out = fillFromPage(splitPrints(works, s), s);
  const find = (t: string, kind: string) => out.find((w) => w.title === t && w.kind === kind);
  assert.equal(find("Hallucinating Joy", "original")?.price, undefined, "the original does not take the print's price");
  assert.equal(find("Hallucinating Joy", "original")?.medium, "charcoal/pastel/acrylic on canvas");
  assert.equal(find("Hallucinating Joy", "print")?.price, "$95.00");
  assert.equal(find("Hallucinating Joy", "print")?.medium, undefined, "a print does not take the original's medium");
  assert.equal(find("Bathers", "original")?.price, "$1,200.00");
  assert.equal(find("Bathers", "original")?.status, "Available");
  assert.equal(find("Bathers", "print"), undefined);
  assert.deepEqual([find("Cactus Tree", "print")?.price, find("Cactus Tree", "print")?.priceFrom], ["$50.00", true]);
  assert.equal(find("Cactus Tree", "original"), undefined);
});
await test("a site with no prints page is left as it was", () => {
  const snap = { pages: [{ url: "https://x.example.com/work", title: "Work", text: "Low Tide\n$900" }] } as never;
  const out = fillFromPage(splitPrints([{ title: "Low Tide", price: "$900" }], snap), snap);
  assert.deepEqual(out, [{ title: "Low Tide", price: "$900" }]);
});
await test("the brief lists prints as their own works, tied to their original", () => {
  const base = { store: { name: "Studio Avant" }, orders: { currency: "USD" } };
  const catalog: Work[] = [{ title: "Hallucinating Joy", kind: "original" }, { title: "Hallucinating Joy", kind: "print", price: "$95.00" }, { title: "Cactus Tree", kind: "print", price: "$50.00", priceFrom: true }];
  const r = { name: "ADA LANE ART", catalog, socials: [], images: [], actions: [], extras: [], testimonials: [], signup: false, sourceUrl: "https://adalane.example.com/", dropped: [], pagesRead: 5, readPages: [], textChars: 1, warnings: [], linksSeen: [] } as unknown as ImportResult;
  const b = importToBrief(base, r, { privateTest: true, by: "test" }).brief as { categories: string[]; catalog: { works: Record<string, unknown>[]; prints_found?: string } };
  assert.deepEqual(b.categories, ["Original work", "Prints"]);
  assert.equal(b.catalog.works[1].kind, "print");
  assert.equal(b.catalog.works[1].print_of, "Hallucinating Joy");
  assert.equal(b.catalog.works[1].price_minor, 9500);
  assert.equal(b.catalog.works[2].print_of, undefined, "no original of that name");
  assert.equal(b.catalog.works[2].price_from, true);
  assert.match(b.catalog.prints_found ?? "", /starting price/);
});
if (failed) process.exit(1);
