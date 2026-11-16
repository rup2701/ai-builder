/**
 * Archived projects and one active project per site address (APP-29, level 1). No database: an in-memory stand-in keeps
 * projects and jobs, and refuses a second active project on the same address the way the unique index
 * projects_active_address_uq does in Postgres (error code 23505 with that constraint name).
 */
import assert from "node:assert/strict";
import {
  ADDRESS_INDEX,
  ARCHIVED_JOB_ERROR,
  addressClaim,
  addressOf,
  addressTakenText,
  archiveProject,
  archiveResultText,
  isAddressTaken,
  isArchived,
  restoreProject,
  siteAddress,
  type Db,
} from "../src/lib/project-archive";
import { refuseIfArchived } from "../worker/archived-job";
import { emptyState } from "../src/lib/workspace/state";
import type { WorkspaceState } from "../src/lib/workspace/types";

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message : e}`);
  }
}

type P = { id: string; owner_id: string; title: string; kind: string; status: string; state: WorkspaceState; archived_at: Date | null; created_at: Date };
type J = { id: string; project_id: string; type: string; status: string; error?: string };

const OWNER = "owner-1";
const live = (url: string, extra: Partial<WorkspaceState> = {}): WorkspaceState =>
  ({ ...emptyState(), phase: "summary", site: { brief: {}, build: { stage: 6, startedAt: "t", files: 3, finishedAt: "t2", url, runDir: "/data/runs/x" } }, ...extra }) as WorkspaceState;

function fakeDb(projects: P[], jobs: J[] = []) {
  const byId = (id: unknown) => projects.find((p) => p.id === id);
  /** The unique index: no two projects that are not archived may share an address. */
  const checkIndex = () => {
    const seen = new Set<string>();
    for (const p of projects) {
      const a = addressOf(p.state);
      if (!a || p.archived_at) continue;
      if (seen.has(a)) throw Object.assign(new Error(`duplicate key value violates unique constraint "${ADDRESS_INDEX}"`), { code: "23505", constraint: ADDRESS_INDEX });
      seen.add(a);
    }
  };
  const db: Db = {
    async query(text, params = []) {
      const t = text.replace(/\s+/g, " ").trim();
      if (t.startsWith("SELECT archived_at FROM projects WHERE id = $1 AND owner_id = $2")) {
        const p = byId(params[0]);
        return { rows: p && p.owner_id === params[1] ? [{ archived_at: p.archived_at }] : [] };
      }
      if (t.startsWith("SELECT archived_at FROM projects WHERE id = $1")) return { rows: byId(params[0]) ? [{ archived_at: byId(params[0])!.archived_at }] : [] };
      if (t.startsWith("SELECT state, archived_at FROM projects")) {
        const p = byId(params[0]);
        return { rows: p && p.owner_id === params[1] ? [{ state: p.state, archived_at: p.archived_at }] : [] };
      }
      if (t.startsWith("SELECT state FROM projects WHERE id = $1")) return { rows: byId(params[0]) ? [{ state: byId(params[0])!.state }] : [] };
      if (t.includes("AS same_owner")) {
        const self = byId(params[1]);
        const found = projects
          .filter((p) => p.id !== params[1] && addressOf(p.state) === params[0] && (!t.includes("archived_at IS NULL AND") || !p.archived_at))
          .sort((a, b) => Number(Boolean(a.archived_at)) - Number(Boolean(b.archived_at)));
        const p = found[0];
        return { rows: p ? [{ id: p.id, title: p.title, created_at: p.created_at, archived: Boolean(p.archived_at), same_owner: p.owner_id === self?.owner_id }] : [] };
      }
      if (t.startsWith("UPDATE projects SET archived_at = now()")) {
        const p = byId(params[0]);
        const running = jobs.some((j) => j.project_id === params[0] && j.status === "running");
        if (!p || p.owner_id !== params[1] || p.archived_at || running) return { rows: [] };
        p.archived_at = new Date();
        return { rows: [{ id: p.id }] };
      }
      if (t.startsWith("UPDATE projects SET archived_at = NULL")) {
        const p = byId(params[0]);
        if (p && p.owner_id === params[1]) {
          const before = p.archived_at;
          p.archived_at = null;
          try {
            checkIndex();
          } catch (e) {
            p.archived_at = before;
            throw e;
          }
        }
        return { rows: [] };
      }
      if (t.startsWith("UPDATE projects SET state = $2")) {
        const p = byId(params[0]);
        if (p) {
          p.state = JSON.parse(String(params[1]));
          if (t.includes("status = CASE")) p.status = p.kind === "site" ? "ready" : "draft";
        }
        return { rows: [] };
      }
      if (t.startsWith("UPDATE jobs SET status = 'failed'")) {
        const j = jobs.find((x) => x.id === params[0]);
        if (j) Object.assign(j, { status: "failed", error: String(params[1]) });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${t.slice(0, 70)}`);
    },
  };
  return db;
}

const project = (id: string, url: string | null, extra: Partial<P> = {}): P => ({
  id,
  owner_id: OWNER,
  title: "CurryLeaf",
  kind: "site",
  status: "ready",
  state: url ? live(url) : ({ ...emptyState(), phase: "summary" } as WorkspaceState),
  archived_at: null,
  created_at: new Date("2026-11-10T00:00:00Z"),
  ...extra,
});

const lastBot = (s: WorkspaceState) => [...s.msgs].reverse().find((m) => m.kind === "bot");

// ---- the address ----

await test("siteAddress reads the lowercase host, the same way as the unique index", () => {
  assert.equal(siteAddress("https://curryleaf.appnomics.live"), "curryleaf.appnomics.live");
  assert.equal(siteAddress("https://CurryLeaf.appnomics.live/menu?x=1"), "curryleaf.appnomics.live");
  assert.equal(siteAddress(" http://a.b:3000/ "), "a.b");
  assert.equal(siteAddress(""), null);
  assert.equal(siteAddress(undefined), null);
  assert.equal(siteAddress("curryleaf.appnomics.live"), null, "no scheme is not a deployed address");
  assert.equal(addressOf(live("https://x.appnomics.live")), "x.appnomics.live");
  assert.equal(addressOf(emptyState()), null);
});

await test("isAddressTaken only matches the address rule, not other duplicate keys", () => {
  assert.equal(isAddressTaken({ code: "23505", constraint: ADDRESS_INDEX }), true);
  assert.equal(isAddressTaken({ code: "23505", constraint: "users_email_unique" }), false);
  assert.equal(isAddressTaken(new Error("x")), false);
  assert.equal(isAddressTaken(null), false);
});

// ---- archive and restore ----

await test("archive freezes the project; archiving twice is fine; someone else cannot archive it", async () => {
  const ps = [project("a", "https://curryleaf.appnomics.live")];
  const db = fakeDb(ps);
  assert.deepEqual(await archiveProject(db, "a", "someone-else"), { ok: false, reason: "not_found" });
  assert.equal(ps[0].archived_at, null);
  assert.deepEqual(await archiveProject(db, "a", OWNER), { ok: true });
  assert.ok(ps[0].archived_at);
  assert.equal(await isArchived(db, "a"), true);
  assert.deepEqual(await archiveProject(db, "a", OWNER), { ok: true });
});

await test("archive is refused while a job is running, in plain words; a queued job does not block it", async () => {
  const ps = [project("a", "https://curryleaf.appnomics.live")];
  const jobs: J[] = [{ id: "j1", project_id: "a", type: "site_change", status: "running" }];
  const db = fakeDb(ps, jobs);
  const r = await archiveProject(db, "a", OWNER);
  assert.deepEqual(r, { ok: false, reason: "busy" });
  assert.match(archiveResultText(r as Exclude<typeof r, { ok: true }>), /Wait for it to finish, then archive it/);
  jobs[0].status = "queued";
  assert.deepEqual(await archiveProject(db, "a", OWNER), { ok: true });
});

await test("archiving keeps the history: the brief, the chat and the live address are untouched", async () => {
  const ps = [project("a", "https://curryleaf.appnomics.live")];
  const before = JSON.stringify(ps[0].state);
  await archiveProject(fakeDb(ps), "a", OWNER);
  assert.equal(JSON.stringify(ps[0].state), before);
});

await test("restore makes the project active again, and its jobs run again", async () => {
  const ps = [project("a", "https://curryleaf.appnomics.live", { archived_at: new Date() })];
  const jobs: J[] = [{ id: "j1", project_id: "a", type: "site_change", status: "running" }];
  const db = fakeDb(ps, jobs);
  assert.equal(await refuseIfArchived(db, { id: "j1", project_id: "a", type: "site_change" }), true);
  assert.deepEqual(await restoreProject(db, "a", OWNER), { ok: true });
  assert.equal(ps[0].archived_at, null);
  const j2: J = { id: "j2", project_id: "a", type: "site_change", status: "running" };
  jobs.push(j2);
  assert.equal(await refuseIfArchived(db, { id: "j2", project_id: "a", type: "site_change" }), false, "restored: the job runs");
  assert.equal(j2.status, "running", "the worker's check does not touch a job it lets through");
  assert.deepEqual(await restoreProject(db, "a", OWNER), { ok: true }, "restoring an active project is fine");
  assert.deepEqual(await restoreProject(db, "a", "someone-else"), { ok: false, reason: "not_found" });
});

// ---- one active project per site address ----

await test("restore is refused when another active project of the same owner now uses the address, and says which one", async () => {
  // The CurryLeaf case: the old project is archived, the new one is live at the same address.
  const ps = [
    project("old", "https://curryleaf.appnomics.live", { archived_at: new Date(), created_at: new Date("2026-11-01T00:00:00Z") }),
    project("new", "https://curryleaf.appnomics.live", { created_at: new Date("2026-11-10T00:00:00Z") }),
  ];
  const r = await restoreProject(fakeDb(ps), "old", OWNER);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === "taken" && r.claim?.id === "new");
  assert.equal(
    archiveResultText(r as Exclude<typeof r, { ok: true }>),
    'curryleaf.appnomics.live is already used by your project "CurryLeaf" (created Nov 10, 2026). Archive that project first, then try again.',
  );
  assert.ok(ps[0].archived_at, "the old project stays archived");
});

await test("another person's project on the address is never named", async () => {
  const ps = [
    project("mine", "https://curryleaf.appnomics.live", { archived_at: new Date() }),
    project("theirs", "https://curryleaf.appnomics.live", { owner_id: "owner-2", title: "Their secret project" }),
  ];
  const r = await restoreProject(fakeDb(ps), "mine", OWNER);
  const text = archiveResultText(r as Exclude<typeof r, { ok: true }>);
  assert.ok(!text.includes("Their secret project"), text);
  assert.match(text, /already used by another project\. Email us/);
});

await test("the database has the last word: a second active project on the address is refused even when the check misses it", async () => {
  const ps = [project("old", "https://curryleaf.appnomics.live", { archived_at: new Date() }), project("new", "https://curryleaf.appnomics.live")];
  const db = fakeDb(ps);
  // A stand-in for a race: the check finds nothing, then the write meets the unique index.
  const racing: Db = { query: (text, params) => (text.includes("AS same_owner") ? Promise.resolve({ rows: [] }) : db.query(text, params)) };
  const r = await restoreProject(racing, "old", OWNER);
  assert.deepEqual(r, { ok: false, reason: "taken", address: "curryleaf.appnomics.live", claim: null });
  assert.ok(ps[0].archived_at);
  assert.match(addressTakenText("curryleaf.appnomics.live", null), /If it is yours, archive it first/);
});

await test("an archived project keeps its address claimed: its site is still online until it is taken down", async () => {
  // Take down is not built yet (level 2), so nothing frees the address.
  const ps = [project("old", "https://curryleaf.appnomics.live", { archived_at: new Date(), created_at: new Date("2026-11-01T00:00:00Z") }), project("third", null)];
  const db = fakeDb(ps);
  const claim = await addressClaim(db, "curryleaf.appnomics.live", "third", { includeArchived: true });
  assert.ok(claim && claim.id === "old" && claim.archived && claim.sameOwner);
  assert.match(addressTakenText("curryleaf.appnomics.live", claim), /still used by your archived project "CurryLeaf" \(created Nov 1, 2026\)\. Its site is still online/);
  assert.equal(await addressClaim(db, "curryleaf.appnomics.live", "third"), null, "for Restore and the unique index only active projects count");
});

await test("a project without an address restores freely, and does not block another one", async () => {
  const ps = [project("a", null, { archived_at: new Date() }), project("b", null)];
  assert.deepEqual(await restoreProject(fakeDb(ps), "a", OWNER), { ok: true });
});

// ---- the worker refuses jobs of an archived project ----

for (const type of ["site_build", "site_publish", "build"] as const) {
  await test(`an archived project refuses a waiting ${type} job: the job fails in plain words and the build screen is left`, async () => {
    const base = live("https://curryleaf.appnomics.live");
    const state: WorkspaceState = { ...base, phase: "build", jobId: "j1", site: { ...base.site!, build: { ...base.site!.build!, stage: type === "site_publish" ? 4 : 0 } } };
    const ps = [project("a", null, { state, status: "building", archived_at: new Date(), kind: type === "build" ? "store" : "site" })];
    const jobs: J[] = [{ id: "j1", project_id: "a", type, status: "running" }];
    const db = fakeDb(ps, jobs);
    assert.equal(await refuseIfArchived(db, { id: "j1", project_id: "a", type }), true);
    assert.equal(jobs[0].status, "failed");
    assert.equal(jobs[0].error, ARCHIVED_JOB_ERROR);
    const s = ps[0].state;
    assert.equal(s.phase, "summary");
    assert.equal(s.jobId, null);
    assert.equal(ps[0].status, type === "build" ? "draft" : "ready", "the project no longer shows as building");
    assert.equal(lastBot(s)?.kind === "bot" && lastBot(s)!.text, ARCHIVED_JOB_ERROR);
    assert.equal(s.site!.build!.url, "https://curryleaf.appnomics.live", "the live address is kept");
    assert.equal(s.site!.build!.failedStage, type === "site_publish" ? 4 : 0, "after Restore the right button comes back");
  });
}

await test("an archived project refuses a waiting site_change job: the change card says why, and nothing is deployed", async () => {
  const base = live("https://curryleaf.appnomics.live");
  const state: WorkspaceState = {
    ...base,
    msgs: [{ id: 1, kind: "site_change", instruction: "Make the headline shorter", status: "queued", action: "make", jobId: "j1" }],
    nextId: 2,
  } as WorkspaceState;
  const ps = [project("a", null, { state, archived_at: new Date() })];
  const jobs: J[] = [{ id: "j1", project_id: "a", type: "site_change", status: "running" }];
  const db = fakeDb(ps, jobs);
  assert.equal(await refuseIfArchived(db, { id: "j1", project_id: "a", type: "site_change" }), true);
  assert.equal(jobs[0].status, "failed");
  const card = ps[0].state.msgs[0];
  assert.ok(card.kind === "site_change" && card.status === "failed" && card.error === ARCHIVED_JOB_ERROR, JSON.stringify(card));
});

await test("an archived project refuses a waiting site_admin job, and the chat says the public site is fine", async () => {
  const ps = [project("a", "https://curryleaf.appnomics.live", { archived_at: new Date() })];
  const jobs: J[] = [{ id: "j1", project_id: "a", type: "site_admin", status: "running" }];
  const db = fakeDb(ps, jobs);
  assert.equal(await refuseIfArchived(db, { id: "j1", project_id: "a", type: "site_admin" }), true);
  assert.equal(jobs[0].status, "failed");
  const note = lastBot(ps[0].state);
  assert.ok(note?.kind === "bot" && /Your site is live and works as before/.test(note.text) && /archived before it could run/.test(note.text), JSON.stringify(note));
});

await test("an active project's jobs are let through untouched", async () => {
  const ps = [project("a", "https://curryleaf.appnomics.live")];
  const before = JSON.stringify(ps[0].state);
  const jobs: J[] = [{ id: "j1", project_id: "a", type: "site_build", status: "running" }];
  for (const type of ["site_build", "site_publish", "site_change", "site_admin", "build"]) {
    assert.equal(await refuseIfArchived(fakeDb(ps, jobs), { id: "j1", project_id: "a", type }), false);
  }
  assert.equal(jobs[0].status, "running");
  assert.equal(JSON.stringify(ps[0].state), before);
});

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
