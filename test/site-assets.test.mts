import assert from "node:assert/strict";
import sharp from "sharp";
import { attachmentNote, cleanFileName, convertToWebp, MAX_UPLOAD_BYTES, MAX_WIDTH, UploadError } from "../src/lib/builder/site-assets";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e); }
}
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 120, b: 64 } } }).png().toBuffer();

await test("a PNG becomes a WebP of the same size", async () => {
  const r = await convertToWebp(await png(800, 500));
  const m = await sharp(r.bytes).metadata();
  assert.equal(m.format, "webp");
  assert.deepEqual([r.width, r.height], [800, 500]);
  assert.equal(r.size, r.bytes.length);
});
await test("a very wide picture is shrunk to the maximum width", async () => {
  const r = await convertToWebp(await png(MAX_WIDTH + 800, 600));
  assert.equal(r.width, MAX_WIDTH);
});
await test("a JPEG is accepted", async () => {
  const jpg = await sharp({ create: { width: 100, height: 60, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  assert.equal((await convertToWebp(jpg)).width, 100);
});
await test("an SVG is refused, even when named .png", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
  await assert.rejects(convertToWebp(svg), UploadError);
});
await test("text and empty files are refused", async () => {
  await assert.rejects(convertToWebp(Buffer.from("hello")), UploadError);
  await assert.rejects(convertToWebp(Buffer.alloc(0)), UploadError);
});
await test("a file over 3 MB is refused", async () => {
  await assert.rejects(convertToWebp(Buffer.alloc(MAX_UPLOAD_BYTES + 1)), /3 MB/);
});
await test("file names are cleaned", () => {
  assert.equal(cleanFileName("C:\\Users\\me\\shot 1.png"), "shot 1.png");
  assert.equal(cleanFileName("../../etc/<b>x</b>.png"), "b.png");
  assert.equal(cleanFileName("   "), "picture");
});
await test("the note names each file's path and size", () => {
  const n = attachmentNote([{ id: "abc", name: "hero.png", width: 1600, height: 900 }]);
  assert.match(n, /\/art\/abc\.webp \(1600 by 900 pixels/);
  assert.equal(attachmentNote([]), "");
});
if (failed) process.exit(1);
