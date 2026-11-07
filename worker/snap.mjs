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

  // A picture of one section is cut from the window, so a sticky header or any fixed bar paints over the section's top edge
  // (and half-hides its heading). Hide them for that picture only. They stay in the layout (visibility, not display), so nothing moves.
  const bars = (hide, id) =>
    page.evaluate(
      ([hide, id]) => {
        const key = "data-snap-hidden";
        if (!hide) {
          for (const el of document.querySelectorAll(`[${key}]`)) {
            el.style.visibility = el.getAttribute(key) ?? "";
            el.removeAttribute(key);
          }
          return;
        }
        const target = id ? document.getElementById(id) : null;
        for (const el of document.querySelectorAll("body *")) {
          const p = getComputedStyle(el).position;
          if (p !== "fixed" && p !== "sticky") continue;
          if (target && (target.contains(el) || el.contains(target))) continue; // part of the section itself, or holds it
          el.setAttribute(key, el.style.visibility);
          el.style.visibility = "hidden";
        }
      },
      [hide, id],
    );
  const sectionShot = async (id, file) => {
    await bars(true, id);
    try {
      await page.waitForTimeout(80);
      await page.locator(`[id="${id}"]`).first().screenshot({ ...shot, path: path.join(outDir, file) });
    } finally {
      await bars(false, id);
    }
  };

  if (anchorArg) {
    const id = clean(anchorArg);
    const found = id && id !== "top" && (await page.locator(`[id="${id}"]`).first().count());
    if (found) await sectionShot(id, "after.jpg");
    else await top("after.jpg");
  } else {
    const ids = await page.$$eval("section[id]", (els) => els.map((e) => e.id).filter(Boolean));
    const saved = [];
    for (const id of ids) {
      const safe = clean(id);
      if (!safe) continue;
      try {
        await sectionShot(safe, `${safe}.jpg`);
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
