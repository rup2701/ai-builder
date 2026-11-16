/**
 * Migration 0004 (APP-29) and its dry run, against a real Postgres. Set TEST_DATABASE_URL to an empty test database: each case
 * wipes its public schema, applies migrations 0000 to 0003, adds its own projects, then runs the read-only dry run
 * (scripts/app-29-archive-dry-run.sql) and the migration, and checks they agree. Like access-code.test.mts, it refuses any
 * database whose name does not start with "t" or contain "test", and it is skipped when TEST_DATABASE_URL is not set.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("SKIP set TEST_DATABASE_URL to an empty test database to run these");
  process.exit(0);
}
if (!/\/(t[a-z0-9_]*|[a-z0-9_]*test[a-z0-9_]*)(\?|$)/i.test(url)) throw new Error("TEST_DATABASE_URL must point at a database named like test or t1");

const { Pool } = (await import("pg")).default;
const pool = new Pool({ connectionString: url, max: 1 });

let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message : e}`);
  }
}

const sqlFiles = readdirSync("drizzle").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const before0004 = sqlFiles.filter((f) => f < "0004");
const MIGRATION = readFileSync("drizzle/0004_project_archive.sql", "utf8");
const DRY_RUN = readFileSync("scripts/app-29-archive-dry-run.sql", "utf8");
const OWNER = "00000000-0000-0000-0000-000000000001";
const uid = (short: string) => `${short.padEnd(8, "0")}-0000-0000-0000-000000000000`;

async function fresh() {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  for (const f of before0004) await pool.query(readFileSync(`drizzle/${f}`, "utf8"));
  await pool.query(`INSERT INTO users (id, email) VALUES ($1, 'owner@example.com')`, [OWNER]);
}

type Seed = {
  id: string;
  created: string;
  /** The site address it was deployed to. Leave out for a project that was never deployed. */
  url?: string;
  /** When its build finished (site.build.finishedAt). Leave out for no build on record. */
  built?: string;
  /** When a change was published (a done site_change job that the chat marks published). */
  changePublished?: string;
  /** A done site_change job that was never published (a preview): must not count. */
  changePreview?: string;
  /** When a publish retry finished (a done site_publish job). */
  publishRetry?: string;
};

async function seed(rows: Seed[]) {
  let n = 0;
  for (const r of rows) {
    const msgs: unknown[] = [];
    const jobs: [string, string, string][] = [];
    const job = (type: string, at: string) => {
      const id = `bbbbbbbb-0000-0000-0000-${String(++n).padStart(12, "0")}`;
      jobs.push([id, type, at]);
      return id;
    };
    if (r.changePublished) msgs.push({ id: msgs.length + 1, kind: "site_change", status: "done", published: true, jobId: job("site_change", r.changePublished) });
    if (r.changePreview) msgs.push({ id: msgs.length + 1, kind: "site_change", status: "review", jobId: job("site_change", r.changePreview) });
    if (r.publishRetry) job("site_publish", r.publishRetry);
    const build = r.url ? { url: r.url, stage: 6, ...(r.built ? { finishedAt: r.built } : {}) } : undefined;
    const state = { msgs, ...(build ? { site: { brief: {}, build } } : {}) };
    await pool.query(`INSERT INTO projects (id, owner_id, title, kind, state, created_at) VALUES ($1, $2, $3, 'site', $4, $5)`, [uid(r.id), OWNER, `Project ${r.id}`, JSON.stringify(state), r.created]);
    for (const [id, type, at] of jobs) await pool.query(`INSERT INTO jobs (id, project_id, type, status, finished_at) VALUES ($1, $2, $3, 'done', $4)`, [id, uid(r.id), type, at]);
  }
}

type DryRow = { outcome: string; address: string | null; id: string | null };
async function dryRun(): Promise<DryRow[]> {
  const before = (await pool.query("SELECT id, state, created_at FROM projects ORDER BY id")).rows;
  const results = (await pool.query(DRY_RUN)) as unknown as { command: string; rows: DryRow[] }[];
  const rows = results.find((r) => r.command === "SELECT")!.rows;
  const after = (await pool.query("SELECT id, state, created_at FROM projects ORDER BY id")).rows;
  assert.deepEqual(after, before, "the dry run changed nothing");
  return rows;
}

/** Runs 0004 in one transaction, as drizzle's migrator does. Returns the error message when it stops. */
async function migrate(): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(MIGRATION);
    await client.query("COMMIT");
    return null;
  } catch (e) {
    await client.query("ROLLBACK");
    return e instanceof Error ? e.message : String(e);
  } finally {
    client.release();
  }
}

const archivedIds = async () => (await pool.query("SELECT id FROM projects WHERE archived_at IS NOT NULL ORDER BY id")).rows.map((r) => String(r.id).slice(0, 8));
const hasColumn = async () => (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'archived_at'`)).rows.length > 0;
const hasIndex = async () => (await pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'projects_active_address_uq'`)).rows.length > 0;
const wouldArchive = (rows: DryRow[]) => rows.filter((r) => r.outcome === "would archive").map((r) => String(r.id).slice(0, 8)).sort();

/** The case where the migration stops: the dry run names the address, and the migration changes nothing at all. */
async function expectStop(address: string) {
  const dry = await dryRun();
  assert.deepEqual(dry.map((r) => [r.outcome, r.address]), [["would stop the migration", address]]);
  const err = await migrate();
  assert.match(err ?? "", new RegExp(`APP-29 migration stopped, nothing was changed: at ${address.replace(/\./g, "\\.")} the newest project does not have the live files`));
  assert.equal(await hasColumn(), false, "rolled back: not even the new column was added");
  assert.equal(await hasIndex(), false);
}

const CURRY = "https://curryleaf.appnomics.live";

await test("1. newer project has the live files: only the older one is archived; a never-deployed project is left alone", async () => {
  await fresh();
  await seed([
    { id: "a01d", created: "2026-11-01T10:00Z", url: CURRY, built: "2026-11-01T12:00Z", changePreview: "2026-11-12T09:00Z" },
    { id: "a02e", created: "2026-11-10T10:00Z", url: "https://CurryLeaf.appnomics.live/", built: "2026-11-10T12:00Z" },
    { id: "b01a", created: "2026-11-05T10:00Z", url: "https://mealwise.appnomics.live", built: "2026-11-05T12:00Z" },
    { id: "c01d", created: "2026-11-06T10:00Z" },
  ]);
  const dry = await dryRun();
  assert.deepEqual(wouldArchive(dry), ["a01d0000"]);
  assert.equal(dry.length, 1, "only the would-archive row");
  assert.equal(await migrate(), null);
  assert.deepEqual(await archivedIds(), ["a01d0000"], "the dry run and the migration agree");
  assert.equal(await hasIndex(), true);
  await assert.rejects(pool.query(`UPDATE projects SET archived_at = NULL WHERE id = $1`, [uid("a01d")]), /projects_active_address_uq/);
});

await test("2. older project published last, so it has the live files: the migration stops and changes nothing", async () => {
  await fresh();
  await seed([
    { id: "a01d", created: "2026-11-01T10:00Z", url: CURRY, built: "2026-11-01T12:00Z", changePublished: "2026-11-14T09:00Z" },
    { id: "a02e", created: "2026-11-10T10:00Z", url: CURRY, built: "2026-11-10T12:00Z" },
  ]);
  await expectStop("curryleaf.appnomics.live");
});

await test("2b. a publish retry on the older project also counts as its live deploy", async () => {
  await fresh();
  await seed([
    { id: "a01d", created: "2026-11-01T10:00Z", url: CURRY, built: "2026-11-01T12:00Z", publishRetry: "2026-11-11T09:00Z" },
    { id: "a02e", created: "2026-11-10T10:00Z", url: CURRY, built: "2026-11-10T12:00Z" },
  ]);
  await expectStop("curryleaf.appnomics.live");
});

await test("3. three projects on one address and the newest has the live files: the two older ones are archived", async () => {
  await fresh();
  await seed([
    { id: "a01d", created: "2026-11-01T10:00Z", url: CURRY, built: "2026-11-01T12:00Z" },
    { id: "a02e", created: "2026-11-05T10:00Z", url: CURRY, built: "2026-11-05T12:00Z", changePublished: "2026-11-08T09:00Z" },
    { id: "a03f", created: "2026-11-10T10:00Z", url: CURRY, built: "2026-11-12T12:00Z" },
  ]);
  const dry = await dryRun();
  assert.deepEqual(wouldArchive(dry), ["a01d0000", "a02e0000"]);
  assert.equal(await migrate(), null);
  assert.deepEqual(await archivedIds(), ["a01d0000", "a02e0000"]);
});

await test("4. no shared address: nothing is archived, and the dry run says so", async () => {
  await fresh();
  await seed([
    { id: "a01d", created: "2026-11-01T10:00Z", url: CURRY, built: "2026-11-01T12:00Z" },
    { id: "b01a", created: "2026-11-05T10:00Z", url: "https://mealwise.appnomics.live", built: "2026-11-05T12:00Z" },
    { id: "c01d", created: "2026-11-06T10:00Z" },
  ]);
  const dry = await dryRun();
  assert.deepEqual(dry.map((r) => r.outcome), ["would archive nothing"]);
  assert.equal(await migrate(), null);
  assert.deepEqual(await archivedIds(), []);
  assert.equal(await hasIndex(), true);
});

await test("5. a project with no deploy at all has no address: it is never archived, even next to a shared address", async () => {
  // A project gets its address only when a deploy finishes, so one that was never deployed is not part of any shared address.
  await fresh();
  await seed([
    { id: "c01d", created: "2026-11-20T10:00Z" },
    { id: "a01d", created: "2026-11-01T10:00Z", url: CURRY, built: "2026-11-01T12:00Z" },
    { id: "a02e", created: "2026-11-10T10:00Z", url: CURRY, built: "2026-11-10T12:00Z" },
  ]);
  const dry = await dryRun();
  assert.deepEqual(wouldArchive(dry), ["a01d0000"], "the newest project overall has no deploy, but it is not at the address");
  assert.equal(await migrate(), null);
  assert.deepEqual(await archivedIds(), ["a01d0000"]);
});

await test("5b. an address on record but no deploy on record: as an older project it is archived; as the newest it stops the migration", async () => {
  await fresh();
  await seed([
    { id: "a01d", created: "2026-11-01T10:00Z", url: CURRY },
    { id: "a02e", created: "2026-11-10T10:00Z", url: CURRY, built: "2026-11-10T12:00Z" },
  ]);
  assert.deepEqual(wouldArchive(await dryRun()), ["a01d0000"]);
  assert.equal(await migrate(), null);
  assert.deepEqual(await archivedIds(), ["a01d0000"]);

  await fresh();
  await seed([
    { id: "a01d", created: "2026-11-01T10:00Z", url: CURRY, built: "2026-11-01T12:00Z" },
    { id: "a02e", created: "2026-11-10T10:00Z", url: CURRY },
  ]);
  await expectStop("curryleaf.appnomics.live");

  await fresh();
  await seed([
    { id: "a01d", created: "2026-11-01T10:00Z", url: CURRY },
    { id: "a02e", created: "2026-11-10T10:00Z", url: CURRY },
  ]);
  await expectStop("curryleaf.appnomics.live");
});

await test("one stopping address stops everything, even where another address would be fine", async () => {
  await fresh();
  await seed([
    { id: "a01d", created: "2026-11-01T10:00Z", url: CURRY, built: "2026-11-01T12:00Z", changePublished: "2026-11-14T09:00Z" },
    { id: "a02e", created: "2026-11-10T10:00Z", url: CURRY, built: "2026-11-10T12:00Z" },
    { id: "b01a", created: "2026-11-01T10:00Z", url: "https://mealwise.appnomics.live", built: "2026-11-01T12:00Z" },
    { id: "b02b", created: "2026-11-10T10:00Z", url: "https://mealwise.appnomics.live", built: "2026-11-10T12:00Z" },
  ]);
  await expectStop("curryleaf.appnomics.live");
});

await test("the whole migration also runs through drizzle's own migrator, as npm run db:migrate does", async () => {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate: drizzleMigrate } = await import("drizzle-orm/node-postgres/migrator");
  await drizzleMigrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  assert.equal(await hasColumn(), true);
  assert.equal(await hasIndex(), true);
  const applied = (await pool.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)).rows[0].n;
  assert.equal(applied, sqlFiles.length);
});

await pool.end();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
