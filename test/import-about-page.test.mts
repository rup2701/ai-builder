import assert from "node:assert/strict";
import { crawlSite, extractPage } from "../src/lib/builder/site-extract";
import { aboutPageImages, groundCheck, mapSnapshot, type ImportResult } from "../src/lib/builder/site-import";
import { importToBrief } from "../src/lib/builder/import-to-brief";

/** An About page like a Squarespace artist site: one long bio paragraph, three pictures, an email and socials. */
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e); }
}
const pub = async () => ["93.184.216.34"];
const page = (h: string) => new Response(h, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const BIO =
  "Ada Lane is an emerging artist based in Los Angeles. Working in acrylic, oil pastel, charcoal and graphite, Lane's work renders the body in abstraction. " +
  "Drawing on years spent in the modeling industry, the work looks at the discomfort of being seen. Using abstraction and layered mediums, it explores voyeurism, " +
  "objectification and the gaze, and asks who a body belongs to once it has been looked at. Lane shows in group exhibitions across the city and works from a small studio near the coast.";
const HOME = `<html><head><title>ADA LANE ART</title></head><body><img src="https://cdn.example.com/header.jpg" alt="Header painting">
  <a href="/about">About</a><a href="/about-1">About</a><a href="/originals">Originals</a><p>Abstract paintings</p></body></html>`;
const ABOUT = `<html><head><title>About | ADA LANE ART</title></head><body><img src="https://cdn.example.com/header.jpg" alt="Header painting">
  <h2>ABOUT THE ARTIST</h2><img src="https://cdn.example.com/portrait.jpg" alt="A woman on a beach at night"><img src="https://cdn.example.com/rain.png" alt=""><img src="https://cdn.example.com/studio.jpg" alt="The studio">
  <div><span><section><p style="white-space:pre-wrap;">${BIO}</p></section></span></div><p>Contact Ada here: <a href="mailto:ada@example.com">ada@example.com</a></p>
  <p>Follow Ada here: <a href="https://www.instagram.com/adalane">INSTAGRAM</a> <a href="https://www.tiktok.com/@adalane">TIKTOK</a></p></body></html>`;
const fetchImpl = (async (u: string) => page(/\/about(-1)?$/.test(u) ? ABOUT : /originals/.test(u) ? "<html><body><p>Untitled 1</p></body></html>" : HOME)) as unknown as typeof fetch;

await test("a long paragraph is kept whole, not dropped", () => {
  assert.ok(BIO.length > 400);
  const p = extractPage(ABOUT, "https://adalane.example.com/about");
  assert.ok(p.page.text.split("\n").includes(BIO));
  assert.ok(!p.page.text.split("\n").some((l) => l.includes(BIO) && l !== BIO), "a wrapper around the bio is not kept as a second, longer copy");
});
await test("a page that repeats one already read is skipped, and the next page is read instead", async () => {
  const s = await crawlSite("adalane.example.com", { fetchImpl, resolve: pub });
  assert.equal(s.pages.filter((p) => p.text.includes("ABOUT THE ARTIST")).length, 1);
  assert.ok(s.pages.some((p) => p.url.endsWith("/originals")));
});
await test("the about text is copied word for word, and a reworded one is dropped", async () => {
  const s = await crawlSite("adalane.example.com", { fetchImpl, resolve: pub });
  assert.equal(groundCheck({ about: BIO }, s).site.about, BIO);
  const reworded = groundCheck({ about: "Ada is a celebrated painter who has shown in New York and Paris. Her work is loved by collectors." }, s);
  assert.equal(reworded.site.about, undefined);
  assert.ok(reworded.dropped.includes("about text"));
  const padded = groundCheck({ about: `${BIO} She has won many prizes.` }, s);
  assert.equal(padded.site.about, BIO);
  assert.ok(padded.dropped.includes("part of the about text"));
});
await test("the About page's own pictures go with it, not the header the home page also shows", async () => {
  const s = await crawlSite("adalane.example.com", { fetchImpl, resolve: pub });
  const a = aboutPageImages(s, BIO);
  assert.equal(a.page, "https://adalane.example.com/about");
  assert.deepEqual(a.images.map((i) => i.src), ["https://cdn.example.com/portrait.jpg", "https://cdn.example.com/rain.png", "https://cdn.example.com/studio.jpg"]);
  assert.equal(aboutPageImages(s).page, "https://adalane.example.com/about", "with no about text, the about address is used");
});
await test("the reader returns the bio, the About pictures, the email and the socials", async () => {
  const s = await crawlSite("adalane.example.com", { fetchImpl, resolve: pub });
  const u = { inputTokens: 1, outputTokens: 1, costUsd: 0 };
  const complete = async (req: { tool: { name: string } }) => ({ input: req.tool.name === "save_site_facts" ? { name: "ADA LANE ART", about: BIO } : {}, usage: u });
  const { result } = await mapSnapshot(complete as never, s, complete as never, "catalog");
  assert.equal(result.about, BIO);
  assert.equal(result.aboutImages?.length, 3);
  assert.equal(result.email, "ada@example.com");
  assert.deepEqual(result.socials.map((x) => x.network).sort(), ["instagram", "tiktok"]);
});
await test("the brief's About page points at the owner's words and pictures", () => {
  const base = { store: { name: "Studio Avant" }, pages: { about: "A page with the artist's statement, a short bio and a portrait. Owner editable." }, orders: { currency: "USD" } };
  const r = { name: "ADA LANE ART", about: BIO, aboutImages: [{ src: "https://cdn.example.com/portrait.jpg", alt: "A woman on a beach at night" }], socials: [], images: [], actions: [], extras: [], testimonials: [], catalog: [], signup: false, sourceUrl: "https://adalane.example.com/", dropped: [], pagesRead: 2, readPages: [], textChars: 1, warnings: [], linksSeen: [] } as unknown as ImportResult;
  const { brief } = importToBrief(base, r, { privateTest: true, by: "test" });
  const b = brief as { pages: { about: string }; content: { about: string; about_images: { image_source: string; alt: string | null }[] } };
  assert.equal(b.content.about, BIO);
  assert.deepEqual(b.content.about_images, [{ image: null, image_source: "https://cdn.example.com/portrait.jpg", alt: "A woman on a beach at night" }]);
  assert.match(b.pages.about, /content\.about, word for word/);
  assert.doesNotMatch(b.pages.about, /short bio and a portrait\. Owner editable\.$/);
  const none = importToBrief(base, { ...r, about: undefined, aboutImages: [] } as ImportResult, { privateTest: true, by: "test" }).brief as { pages: { about: string } };
  assert.match(none.pages.about, /nothing is written for them/);
});
if (failed) process.exit(1);
