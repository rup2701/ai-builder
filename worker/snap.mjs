// Takes screenshots of a live site, for the before and after pictures in the chat.
//   node worker/snap.mjs <appDir> <url> <outDir>            one JPEG per page section that has an id, plus top.jpg and manifest.json
//   node worker/snap.mjs <appDir> <url> <outDir> <anchor>   one JPEG, after.jpg, of that section (or the top of the page)
// Playwright comes from the built site's own folder (the one its end-to-end tests use), so the worker needs no extra install.
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const [appDir, url, outDir, anchorArg] = process.argv.slice(2);
if (!appDir || !url || !outDir) {
  console.error("Usage: node snap.mjs <appDir> <url> <outDir> [anchor]");
  process.exit(2);
}
const require = createRequire(path.join(appDir, "package.json"));
const { chromium } = require("@playwright/test");
fs.mkdirSync(outDir, { recursive: true });

const shot = { type: "jpeg", quality: 62 };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
  await page.waitForTimeout(600);

  // Photographing a section scrolls the page, and the clip below is measured from the top of the window, so go back to the top first.
  const top = async (file) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    return topShot(file);
  };
  const topShot = async (file) => page.screenshot({ ...shot, path: path.join(outDir, file), clip: { x: 0, y: 0, width: 1280, height: 900 } });
  const clean = (a) => String(a ?? "").replace(/^#/, "").replace(/[^\w-]/g, "");

  if (anchorArg) {
    const id = clean(anchorArg);
    const el = id && id !== "top" ? page.locator(`[id="${id}"]`).first() : null;
    if (el && (await el.count())) await el.screenshot({ ...shot, path: path.join(outDir, "after.jpg") });
    else await top("after.jpg");
  } else {
    const ids = await page.$$eval("section[id]", (els) => els.map((e) => e.id).filter(Boolean));
    const saved = [];
    for (const id of ids) {
      const safe = clean(id);
      if (!safe) continue;
      try {
        await page.locator(`[id="${safe}"]`).first().screenshot({ ...shot, path: path.join(outDir, `${safe}.jpg`) });
        saved.push(safe);
      } catch {
        /* a section that cannot be photographed is simply left out */
      }
    }
    await top("top.jpg");
    fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ ids: saved }));
  }
} finally {
  await browser.close();
}
