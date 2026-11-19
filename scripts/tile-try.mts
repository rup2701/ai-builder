// Draws the style tile (APP-42 step 3) for a project's saved design brief, runs the five checks, measures the page at
// 390 px in a real browser and takes screenshots at 1280 and 390 px. Nothing is saved to the database: the session is
// read-only, and the files go to the out folder.
//
//   npx tsx --env-file=.env scripts/tile-try.mts --title GWins --out <folder>
//   npx tsx --env-file=.env scripts/tile-try.mts --project <projects id> --out <folder>
//   npx tsx scripts/tile-try.mts --file source.json --out <folder>          (a source.json from design-brief-try --export)
//   add --design-brief design-brief.json to draw from another design brief (for example a rerun) with the same brief.
//   add --no-shots to skip the browser.
//   npx tsx scripts/tile-try.mts --html <folder>/tile.html --out <folder>  (only the browser part, on a tile already drawn)
//
// Writes tile.html, tokens.json, checks.json and, with the browser, tile-1280.png, tile-390.png and measure.json.
// The browser is the Playwright Chromium in node_modules. Never prints DATABASE_URL or database error text.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { DesignBrief } from "../src/lib/builder/design-brief";
import { designTokens } from "../src/lib/builder/design-tokens";
import { renderTile, tileSources } from "../src/lib/builder/style-tile";
import { checkTile, PHONE } from "../src/lib/builder/tile-checks";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
class Plain extends Error {}

type Source = { site: string; brief: Record<string, unknown>; designBrief: DesignBrief | null; note: string };

async function fromProject(by: { id?: string; title?: string }): Promise<Source> {
  if (!process.env.DATABASE_URL) throw new Plain("Set DATABASE_URL to the database that holds the project.");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const dbError = (e: unknown) => new Plain(`Could not read the project from the database (error code ${(e as { code?: string })?.code ?? "unknown"}).`);
  c.on("error", () => {});
  try {
    await c.connect();
  } catch (e) {
    throw dbError(e);
  }
  try {
    await c.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    await c.query("SET default_transaction_read_only = on");
    // Only the project's title, brief and saved design brief are read.
    const cols = `title, updated_at, state->'site'->'brief' AS brief, design_brief`;
    const { rows } = by.id
      ? await c.query(`SELECT ${cols} FROM projects WHERE id = $1::uuid`, [by.id])
      : await c.query(`SELECT ${cols} FROM projects WHERE lower(title) = lower($1) OR lower(state->'site'->'brief'->'site'->>'name') = lower($1) ORDER BY updated_at DESC LIMIT 1`, [by.title]);
    const row = rows[0];
    if (!row) throw new Plain(by.id ? "That project does not exist." : "No project has that title or site name.");
    const saved = row.design_brief as { status?: string; finishedAt?: string; result?: { json?: DesignBrief } } | null;
    return { site: row.title, brief: row.brief, designBrief: saved?.result?.json ?? null, note: `saved design brief: ${saved?.status ?? "none"}${saved?.finishedAt ? `, finished ${saved.finishedAt}` : ""}` };
  } catch (e) {
    throw e instanceof Plain ? e : dbError(e);
  } finally {
    await c.end().catch(() => {});
  }
}

async function shots(html: string, out: string) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const result: Record<string, unknown> = {};
    for (const width of [1280, PHONE]) {
      const page = await browser.newPage({ viewport: { width, height: width === PHONE ? 844 : 800 } });
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.screenshot({ path: path.join(out, `tile-${width}.png`), fullPage: true });
      // Check 5 measured: the page's scroll width, and any text box past the right edge (the page may hide overflow).
      result[width] = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        const outside = [...document.querySelectorAll("body *")]
          .filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.right > w + 0.5;
          })
          .map((e) => (e.textContent ?? "").trim().slice(0, 40));
        return { clientWidth: w, scrollWidth: document.documentElement.scrollWidth, textOutside: outside, h1: getComputedStyle(document.querySelector("h1")!).fontSize };
      });
      await page.close();
    }
    const phone = result[PHONE] as { clientWidth: number; scrollWidth: number; textOutside: string[] };
    const ok = phone.scrollWidth <= PHONE && phone.textOutside.length === 0;
    await writeFile(path.join(out, "measure.json"), JSON.stringify({ ok, ...result }, null, 2));
    return ok;
  } finally {
    await browser.close();
  }
}

async function main() {
  const out = path.resolve(arg("out") ?? "tile-try");
  if (arg("html")) {
    await mkdir(out, { recursive: true });
    const ok = await shots(await readFile(arg("html")!, "utf8"), out);
    console.log(`  ${ok ? "pass" : "FAIL"}  5. measured at ${PHONE} px in a browser (measure.json). Files in ${out}`);
    return;
  }
  let source: Source;
  if (arg("file")) {
    const d = JSON.parse(await readFile(arg("file")!, "utf8"));
    source = { site: d.site ?? d.brief?.site?.name ?? "project", brief: d.brief, designBrief: d.savedDesignBrief ?? null, note: `from ${path.basename(arg("file")!)}` };
  } else if (arg("project")) source = await fromProject({ id: arg("project")! });
  else if (arg("title")) source = await fromProject({ title: arg("title")! });
  else throw new Plain("Give --title, --project or --file.");
  if (arg("design-brief")) {
    const j = JSON.parse(await readFile(arg("design-brief")!, "utf8"));
    source.designBrief = j.json ?? j;
    source.note += `; design brief from ${path.basename(arg("design-brief")!)}`;
  }
  if (!source.brief) throw new Plain("The project has no approved brief.");
  if (!source.designBrief) throw new Plain("The project has no design brief that passed. Approve the brief in Scout first.");

  const tokens = designTokens(source.designBrief, source.brief);
  const html = renderTile(source.designBrief, source.brief, tokens);
  const result = checkTile(html, tileSources(source.designBrief, source.brief), tokens);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "tile.html"), html);
  await writeFile(path.join(out, "tokens.json"), JSON.stringify(tokens, null, 2));
  await writeFile(path.join(out, "checks.json"), JSON.stringify(result, null, 2));
  console.log(`${source.site} (${source.note})`);
  for (const c of result.checks) console.log(`  ${c.ok ? "pass" : "FAIL"}  ${c.id}. ${c.name}: ${c.detail}`);
  if (!process.argv.includes("--no-shots")) {
    const ok = await shots(html, out);
    console.log(`  ${ok ? "pass" : "FAIL"}  5. measured at ${PHONE} px in a browser (measure.json)`);
  }
  console.log(`Files in ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Plain ? e.message : `Stopped: ${(e instanceof Error ? e.message : String(e)).replace(/postgres(ql)?:\/\/\S+/g, "[database]").slice(0, 300)}`);
  process.exit(1);
});
