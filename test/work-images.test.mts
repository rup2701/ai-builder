import assert from "node:assert/strict";
import { localRunDatabaseUrl, planImages } from "../src/lib/builder/work-images";
import { safeFetchImage } from "../src/lib/builder/safe-fetch";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e); }
}

await test("only works with a picture address are planned", () => {
  const plan = planImages({ catalog: { works: [{ title: "A", image_source: "https://x/a.jpg" }, { title: "B", image_source: null }, { title: "C" }] } });
  assert.deepEqual(plan, [{ title: "A", source: "https://x/a.jpg" }]);
  assert.deepEqual(planImages({}), []);
  // the whole answer of the brief route, with the brief under "brief"
  assert.deepEqual(planImages({ brief: { catalog: { works: [{ title: "A", image_source: "https://x/a.jpg" }] } }, notFound: [] }), [{ title: "A", source: "https://x/a.jpg" }]);
});
await test("it only runs against a local run database", () => {
  assert.equal(localRunDatabaseUrl("DATABASE_URL=postgres://localhost:5432/run_2026_abc\n"), "postgres://app@localhost:5432/run_2026_abc");
  assert.throws(() => localRunDatabaseUrl("DATABASE_URL=postgres://u:p@ep-cool.neon.tech/neondb"), /local run database/);
  assert.throws(() => localRunDatabaseUrl("DATABASE_URL=postgres://localhost:5432/builder"), /local run database/);
  assert.throws(() => localRunDatabaseUrl("OTHER=1"), /no DATABASE_URL/);
});
await test("a picture address that is private or not a picture is refused", async () => {
  const resolve = async () => ["10.0.0.5"];
  await assert.rejects(safeFetchImage("https://x.example.com/a.jpg", { resolve }), /not a public website/);
  const ok = async () => ["93.184.216.34"];
  const html = (async () => new Response("<html></html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  await assert.rejects(safeFetchImage("https://x.example.com/a.jpg", { resolve: ok, fetchImpl: html }), /not a JPG, PNG or WebP/);
});
await test("a real picture comes back as bytes", async () => {
  const ok = async () => ["93.184.216.34"];
  const img = (async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
  const r = await safeFetchImage("https://x.example.com/a.jpg", { resolve: ok, fetchImpl: img });
  assert.equal(r.bytes.length, 3);
});
if (failed) process.exit(1);
