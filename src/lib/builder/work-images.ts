import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { safeFetchImage } from "./safe-fetch";
import { convertToWebp } from "./site-assets";

/**
 * Puts the pictures of an imported store's works into a built store's own folder and database.
 * It runs next to the built app (on the build machine), never against the Builder's database: it reads only the app's own .env,
 * and refuses to run unless that points at a local run database. It saves each picture the way the app does (.uploads/<name>.webp, served as /uploads/<name>.webp)
 * and adds a product_images row. A work that already has a picture is left alone, so running it twice is safe.
 */

export type BriefWork = { title: string; image_source?: string | null };
export type Plan = { title: string; source: string };

/** The works that have a picture address, in the brief's order. */
export function planImages(briefJson: unknown): Plan[] {
  // The file may be the brief itself or the whole answer of the brief route, which holds it under "brief".
  const top = briefJson as { brief?: unknown } | null;
  const brief = (top && typeof top === "object" && top.brief && typeof top.brief === "object" ? top.brief : briefJson) as { catalog?: { works?: BriefWork[] } } | null;
  const works = brief?.catalog?.works;
  if (!Array.isArray(works)) return [];
  return works.filter((w) => typeof w?.title === "string" && typeof w?.image_source === "string" && w.image_source).map((w) => ({ title: w.title, source: w.image_source as string }));
}

/** The database address from the app's own .env. It must be a local run database, so this can never touch the Builder's database. */
export function localRunDatabaseUrl(envText: string): string {
  const line = envText.split("\n").find((l) => /^DATABASE_URL=/.test(l));
  if (!line) throw new Error("The app's .env has no DATABASE_URL.");
  const raw = line.replace(/^DATABASE_URL=/, "").trim().replace(/^["']|["']$/g, "");
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("The app's DATABASE_URL is not an address."); }
  const db = u.pathname.replace(/^\//, "");
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || !/^run_[a-z0-9_]+$/.test(db)) {
    throw new Error("Refusing to run: the app's DATABASE_URL is not a local run database.");
  }
  return raw.includes("@") ? raw : `postgres://app@${u.host}/${db}`;
}

export type Report = { saved: string[]; skipped: { title: string; why: string }[] };

type Pg = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> };

export async function importWorkImages(appDir: string, briefFile: string, opts: { dryRun?: boolean; fetchImage?: typeof safeFetchImage } = {}): Promise<Report> {
  const brief = JSON.parse(await readFile(briefFile, "utf8"));
  const plan = planImages(brief);
  const dbUrl = localRunDatabaseUrl(await readFile(path.join(appDir, ".env"), "utf8"));
  const { Client } = createRequire(path.join(appDir, "package.json"))("pg") as { Client: new (o: { connectionString: string }) => Pg & { connect: () => Promise<void> } };
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const report: Report = { saved: [], skipped: [] };
  const fetchImage = opts.fetchImage ?? safeFetchImage;
  try {
    for (const p of plan) {
      const found = await client.query("select id from products where title = $1", [p.title]);
      if (found.rows.length !== 1) { report.skipped.push({ title: p.title, why: found.rows.length ? "more than one work has this title" : "no work with this title in the store" }); continue; }
      const productId = found.rows[0].id as number;
      const have = await client.query("select 1 from product_images where product_id = $1 limit 1", [productId]);
      if (have.rows.length) { report.skipped.push({ title: p.title, why: "already has a picture" }); continue; }
      try {
        const { bytes } = await fetchImage(p.source);
        const webp = await convertToWebp(bytes, 15 * 1024 * 1024);
        if (opts.dryRun) { report.saved.push(`${p.title} (${webp.width}x${webp.height}, ${Math.round(webp.size / 1024)} KB, not saved)`); continue; }
        const name = `${randomUUID()}.webp`;
        await mkdir(path.join(appDir, ".uploads"), { recursive: true });
        await writeFile(path.join(appDir, ".uploads", name), webp.bytes);
        await client.query("insert into product_images (product_id, url, alt, width, height, position) values ($1, $2, $3, $4, $5, 0)", [productId, `/uploads/${name}`, p.title, webp.width, webp.height]);
        report.saved.push(`${p.title} (${webp.width}x${webp.height}, ${Math.round(webp.size / 1024)} KB)`);
      } catch (e) {
        report.skipped.push({ title: p.title, why: e instanceof Error ? e.message : "failed" });
      }
    }
  } finally {
    await client.end();
  }
  return report;
}
