import assert from "node:assert/strict";
import { assertPublicUrl, ImportError, isBlockedAddress, safeFetchHtml, MAX_BYTES } from "../src/lib/builder/safe-fetch";
import { crawlSite, extractPage, pickSubpages } from "../src/lib/builder/site-extract";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e); }
}
const pub = async () => ["93.184.216.34"];
const html = (body: string, head = "") => `<html><head><title>Luna Cafe</title>${head}</head><body>${body}</body></html>`;
const page = (h: string, extra: Record<string, string> = {}) => new Response(h, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...extra } });

await test("private and internal addresses are blocked", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3"]) assert.equal(isBlockedAddress(ip), true, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) assert.equal(isBlockedAddress(ip), false, ip);
});
await test("bad addresses are refused with a plain message", async () => {
  for (const bad of ["", "ftp://x.com", "http://user:pw@x.com", "https://127.0.0.1", "https://localhost", "https://intranet", "https://x.com:8080", "https://service.internal", "javascript:alert(1)"])
    await assert.rejects(assertPublicUrl(bad, pub), ImportError, bad);
});
await test("a name that resolves to a private address is refused", async () => {
  await assert.rejects(assertPublicUrl("evil.example.com", async () => ["10.0.0.1"]), /not a public website/);
  await assert.rejects(assertPublicUrl("evil.example.com", async () => ["93.184.216.34", "169.254.169.254"]), /not a public website/);
});
await test("a bare name gets https and the hash is dropped", async () => {
  const u = await assertPublicUrl("lunacafe.com/menu#top", pub);
  assert.equal(u.toString(), "https://lunacafe.com/menu");
});
await test("a redirect to a private address is refused", async () => {
  const resolve = async (h: string) => (h === "evil.com" ? ["93.184.216.34"] : ["10.0.0.9"]);
  const fetchImpl = (async () => new Response(null, { status: 302, headers: { location: "http://intranet.corp.example/admin" } })) as typeof fetch;
  await assert.rejects(safeFetchHtml("evil.com", { fetchImpl, resolve }), /not a public website/);
});
await test("too many redirects stop", async () => {
  const fetchImpl = (async () => new Response(null, { status: 301, headers: { location: "https://a.example.com/" } })) as typeof fetch;
  await assert.rejects(safeFetchHtml("a.example.com", { fetchImpl, resolve: pub }), /redirects too many/);
});
await test("non-HTML and error answers are refused", async () => {
  await assert.rejects(safeFetchHtml("a.example.com", { fetchImpl: (async () => new Response("{}", { headers: { "content-type": "application/json" } })) as typeof fetch, resolve: pub }), /not a web page/);
  await assert.rejects(safeFetchHtml("a.example.com", { fetchImpl: (async () => new Response("no", { status: 404 })) as typeof fetch, resolve: pub }), /error \(404\)/);
});
await test("a huge page is cut at the size cap", async () => {
  const big = "x".repeat(MAX_BYTES * 2);
  const r = await safeFetchHtml("a.example.com", { fetchImpl: (async () => page(big)) as typeof fetch, resolve: pub });
  assert.ok(r.html.length <= MAX_BYTES);
});

const HOME = html(
  `<header><a href="tel:+15105551234">Call (510) 555-1234</a></header><nav><a href="/menu">Menu</a></nav>
   <h1>Luna Cafe</h1><p>Neighbourhood coffee and pastries.</p>
   <ul><li>Latte 5</li><li>Croissant 4</li></ul>
   <a href="/menu">Our menu</a><a href="/about-us">About</a><a href="/contact">Contact</a><a href="/assets/menu.pdf">PDF</a><a href="https://other.com/menu">elsewhere</a>
   <img src="/img/hero.jpg" alt="The cafe front"><img src="/img/logo.png" alt=""><img src="/img/tiny.jpg" width="40">
   <footer><address>12 Grand Ave, Oakland CA</address><p>Mon-Fri 7am-5pm</p><a href="mailto:hi@lunacafe.com">Email</a><a href="https://www.instagram.com/lunacafe">IG</a></footer>`,
  `<meta name="description" content="Coffee in Oakland"><meta property="og:image" content="/img/og.jpg">
   <script type="application/ld+json">{"@type":"Restaurant","name":"Luna Cafe","telephone":"+1 510 555 1234","address":{"streetAddress":"12 Grand Ave"}}</script>`,
);
await test("a page keeps footer text, short lines, phone, email, social, structured data and good images", () => {
  const p = extractPage(HOME, "https://lunacafe.com/");
  assert.match(p.page.text, /12 Grand Ave, Oakland CA/);
  assert.match(p.page.text, /Mon-Fri 7am-5pm/);
  assert.match(p.page.text, /Latte 5/);
  assert.deepEqual(p.phones, ["+15105551234"]);
  assert.deepEqual(p.emails, ["hi@lunacafe.com"]);
  assert.equal(p.socials[0].network, "instagram");
  assert.equal(p.structured.length, 1);
  assert.deepEqual(p.images.map((i) => i.src), ["https://lunacafe.com/img/og.jpg", "https://lunacafe.com/img/hero.jpg"]);
  assert.equal(p.description, "Coffee in Oakland");
});
await test("thumbnails, logos and the same picture spelled two ways are skipped", () => {
  const w = html(`<img src="https://static.wixstatic.com/media/a%7Emv2.png/v1/fill/w_45,h_45/a.png" alt="x"><img src="https://static.wixstatic.com/media/b~mv2.jpg/v1/fill/w_900,h_600/b.jpg" alt="Spices"><img src="https://static.wixstatic.com/media/b%7Emv2.jpg/v1/fill/w_900,h_600/b.jpg" alt="Spices"><img src="/c.jpg" alt="Our Logo">`);
  const p = extractPage(w, "https://x.example.com/");
  assert.deepEqual(p.images.map((i) => i.alt), ["Spices"]);
  assert.equal(p.images[0].src, "https://static.wixstatic.com/media/b~mv2.jpg"); // the original, not the resized copy
});
await test("picture descriptions lose file extensions", () => {
  const p = extractPage(html('<img src="https://x.example.com/a.jpg" alt="dining .jpg"><img src="https://x.example.com/b.jpg" alt="Vegetarian Thali">'), "https://x.example.com/");
  assert.deepEqual(p.images.map((i) => i.alt), ["dining", "Vegetarian Thali"]);
});
await test("camera file names are not kept as descriptions", () => {
  const p = extractPage(html('<img src="https://x.example.com/1.jpg" alt="IMG_6028_edited"><img src="https://x.example.com/2.jpg" alt="260305_SIMONE8706_edited"><img src="https://x.example.com/3.jpg" alt="DSC00412"><img src="https://x.example.com/4.jpg" alt="Golden hour over the Thames">'), "https://x.example.com/");
  assert.deepEqual(p.images.map((i) => i.alt), ["", "", "", "Golden hour over the Thames"]);
});
await test("shop and painting pages are worth reading, and come before the story", () => {
  const links = ["/about-4", "/shop", "/original-paintings", "/commissions"].map((p) => ({ href: `https://x.example.com${p}`, text: "" }));
  assert.deepEqual(pickSubpages(links, "https://x.example.com/", 3), ["https://x.example.com/shop", "https://x.example.com/original-paintings", "https://x.example.com/commissions"]);
});
await test("the menu page is read first, even when it is not the first link", () => {
  const links = ["/story", "/catering", "/online-ordering", "/contact-us", "/menu"].map((p) => ({ href: `https://x.example.com${p}`, text: "" }));
  assert.equal(pickSubpages(links, "https://x.example.com/", 2)[0], "https://x.example.com/menu");
});
await test("the home page's buttons are captured with their addresses", () => {
  const h = html(`<a href="https://order.example.com/x">Order online</a><a href="/menu">View menu</a><a href="/reservations">Make a reservation</a><a href="/about">About us</a><a href="/menu">Menu</a>`);
  const p = extractPage(h, "https://x.example.com/");
  assert.deepEqual(p.actions, [
    { label: "Order online", url: "https://order.example.com/x" },
    { label: "View menu", url: "https://x.example.com/menu" },
    { label: "Make a reservation", url: "https://x.example.com/reservations" },
  ]);
});
await test("catering and events pages are worth reading", () => {
  const links = ["/catering", "/events", "/privacy"].map((p) => ({ href: `https://x.example.com${p}`, text: "" }));
  assert.deepEqual(pickSubpages(links, "https://x.example.com/"), ["https://x.example.com/catering", "https://x.example.com/events"]);
});
await test("scripts and styles never reach the text", () => {
  const p = extractPage(html("<p>Hello there</p><script>var secret='abc'</script><style>.x{}</style>"), "https://a.example.com/");
  assert.ok(!p.page.text.includes("secret") && !p.page.text.includes(".x"));
});
await test("only useful same-site pages are chosen", () => {
  const p = extractPage(HOME, "https://lunacafe.com/");
  assert.deepEqual(pickSubpages(p.links, "https://lunacafe.com/"), ["https://lunacafe.com/menu", "https://lunacafe.com/contact", "https://lunacafe.com/about-us"]);
});
await test("crawl reads the home page and sub-pages, and survives a failing sub-page", async () => {
  const fetchImpl = (async (u: string) => {
    if (u.endsWith("/contact")) throw new Error("down");
    if (u.endsWith("/menu")) return page(html("<h2>Drinks</h2><p>Flat white 5</p>"));
    if (u.endsWith("/about-us")) return page(html("<p>Family run since 1999</p>"));
    return page(HOME);
  }) as unknown as typeof fetch;
  const s = await crawlSite("lunacafe.com", { fetchImpl, resolve: pub });
  assert.equal(s.pages.length, 3);
  assert.ok(s.pages.some((p) => /Flat white 5/.test(p.text)));
  assert.equal(s.phones.length, 1);
});
await test("a home page that fails is a plain error", async () => {
  await assert.rejects(crawlSite("lunacafe.com", { fetchImpl: (async () => { throw new Error("x"); }) as unknown as typeof fetch, resolve: pub }), /could not open/);
});
if (failed) process.exit(1);
