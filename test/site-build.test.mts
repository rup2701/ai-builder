/**
 * Tests the real build path without a model: a stand-in runner prints the same stage markers as the real one,
 * and an in-memory stand-in for the database records what the worker writes.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { briefForRunner, checklist, nameCandidates, packFor, parseAdminUrl, parseLiveUrl, parseSummary, recordsSettled, runSiteAdmin, runSiteBuild, runSitePublish, wantsAdmin, type Db } from "../worker/site-build";
import { SITE_EXAMPLE_BRIEF } from "../src/lib/builder/site-pack.generated";
import { DONE_STAGE } from "../src/lib/builder/site-stages";
import { emptyState } from "../src/lib/workspace/state";
import type { SiteBuild, WorkspaceState } from "../src/lib/workspace/types";
import type { ToolCall } from "../src/lib/agents/design-brief-writer";
import { designBriefInput } from "../src/lib/agents/design-brief-step";

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

// ---- pure helpers ----
await test("parseSummary reads the last JSON block", () => {
  const out = 'noise\n\n{\n  "runId": "r1",\n  "stopReason": "finished",\n  "checks": {\n    "typecheck": true,\n    "build": true\n  }\n}\n\nRead x first.';
  const s = parseSummary(out);
  assert.equal(s?.runId, "r1");
  assert.equal(s?.checks?.build, true);
});
await test("parseSummary returns null without a summary", () => assert.equal(parseSummary("no json here"), null));
await test("parseLiveUrl finds the address", () => assert.equal(parseLiveUrl("x\nLive: https://a-b.appnomics.live\ny"), "https://a-b.appnomics.live"));
await test("nameCandidates: slug first, then suffixes, all valid", () => {
  const n = nameCandidates("DispatchOS", () => "ab12");
  assert.deepEqual(n, ["dispatchos", "dispatchos-ab12", "dispatchos-ab12", "dispatchos-ab12"]);
  for (const x of nameCandidates("A very long name that goes on and on and on forever")) assert.match(x, /^[a-z0-9-]{3,40}$/);
  assert.match(nameCandidates("é")[0], /^[a-z0-9-]{3,40}$/);
});
await test("checklist is built from the brief's unconfirmed claims", () => {
  const brief = JSON.parse(SITE_EXAMPLE_BRIEF) as Record<string, unknown>;
  (brief as { claims: unknown }).claims = [{ text: "Your details are private.", confirmed: false }, { text: "Fine.", confirmed: true }];
  const items = checklist(brief);
  assert.ok(items.some((i) => i.includes("Your details are private.")));
  assert.ok(!items.some((i) => i.includes('"Fine."')));
});

// ---- the whole worker path against a stand-in runner ----
async function makeRunner(opts: { checks?: boolean; takenBase?: string; static?: boolean }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runner-"));
  await mkdir(path.join(dir, "runs", "r1", "app"), { recursive: true });
  await writeFile(path.join(dir, "runs", "r1", "transcript.jsonl"), '{"turn":1,"tool":"write_file"}\n{"turn":2,"tool":"write_file"}\n{"turn":3,"tool":"run_command"}\n');
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ scripts: { create: "node create.mjs", deploy: "node deploy.mjs" } }),
  );
  await writeFile(
    path.join(dir, "create.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync(new URL("./create-args.json", import.meta.url), JSON.stringify(process.argv.slice(2)));
console.log("1/4 Writing the brief…");
console.log("2/4 Setting up a fresh folder and database…");
console.log("    ${dir}/runs/r1/app\\n    database run_x");
console.log("3/4 Agent is building…");
console.log("3b/4 Look pass");
console.log("4/4 Independent checks");
console.log("\\n" + JSON.stringify({ runId: "r1", stopReason: "finished", estimatedCostUsd: 3.1, model: "m", tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 5 }, checks: { typecheck: true, build: ${opts.checks ?? true} } }, null, 2));
`,
  );
  await writeFile(
    path.join(dir, "deploy.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync(new URL("./deploy-args.json", import.meta.url), JSON.stringify(process.argv.slice(2)));
const name = process.argv[process.argv.indexOf("--name") + 1];
if (name === ${JSON.stringify(opts.takenBase ?? "")}) { console.log('A Vercel project named "' + name + '" already exists in this account. Nothing was changed.'); process.exit(1); }
for (let i = 1; i <= 7; i++) console.log(i + "/7 step");
${opts.static ? 'if (process.env.ADMIN_PASSWORD || process.argv.includes("--email")) process.exit(3);' : 'if (!process.env.ADMIN_PASSWORD) process.exit(2);'}
console.log("Live: https://" + name + ".appnomics.live");
`,
  );
  return dir;
}

/** claimed: site addresses that another active project already uses (APP-29), with whether it is the same owner. */
function fakeDb(email = "owner@example.com", brief: Record<string, unknown> = JSON.parse(SITE_EXAMPLE_BRIEF), claimed: Record<string, boolean> = {}) {
  const st: WorkspaceState = { ...emptyState(), phase: "build", jobId: "j1", site: { brief, build: { stage: 0, startedAt: new Date().toISOString(), files: 0 } } };
  const rec = { state: st, usage: [] as unknown[][], status: "building", jobs: [] as string[], records: [] as { pack: string; outcome: string; details: any }[], designBrief: null as any };
  const db: Db = {
    async query(text, params = []) {
      // projects.design_brief (APP-49), with the store's compare-and-set on the token.
      if (text.startsWith("SELECT design_brief FROM projects")) return { rows: [{ design_brief: rec.designBrief }] };
      if (text.startsWith("UPDATE projects SET design_brief")) {
        if ((rec.designBrief?.token ?? "") !== String(params[2] ?? "")) return { rows: [] };
        rec.designBrief = JSON.parse(String(params[1]));
        return { rows: [{ id: params[0] }] };
      }
      if (text.includes("FROM projects p JOIN users")) return { rows: [{ state: rec.state, email }] };
      if (text.includes("AS same_owner")) {
        // The deploy check counts archived projects too: their sites keep running.
        assert.ok(!text.includes("archived_at IS NULL AND"), "the deploy check must count archived projects");
        const address = String(params[0]);
        return { rows: address in claimed ? [{ id: "other", title: "Old Mealwise", created_at: "2026-11-01T00:00:00Z", archived: false, same_owner: claimed[address] }] : [] };
      }
      if (text.startsWith("UPDATE projects\n        SET state = jsonb_set")) {
        const patch = JSON.parse(params[1] as string) as Partial<SiteBuild>;
        rec.state = { ...rec.state, site: { ...rec.state.site!, build: { ...rec.state.site!.build!, ...patch } } };
        return { rows: [] };
      }
      if (text.startsWith("SELECT state FROM projects")) return { rows: [{ state: rec.state }] };
      if (text.startsWith("UPDATE projects SET state = $2")) {
        rec.state = JSON.parse(params[1] as string);
        rec.status = "ready";
        return { rows: [] };
      }
      if (text.startsWith("INSERT INTO jobs")) {
        rec.jobs.push(String(params[0]) + ":" + /'(\w+)'/.exec(text)?.[1]);
        return { rows: [] };
      }
      if (text.startsWith("INSERT INTO build_records")) {
        rec.records.push({ pack: String(params[2]), outcome: String(params[3]), details: JSON.parse(String(params[4])) });
        return { rows: [] };
      }
      if (text.startsWith("INSERT INTO usage")) {
        rec.usage.push(params);
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text.slice(0, 60)}`);
    },
  };
  return { db, rec };
}

const quick = { WORKER_HEARTBEAT_MS: "50", WORKER_FILES_MS: "50" };

await test("a good build ends Ready with the address, the password and the checklist", async () => {
  const dir = await makeRunner({});
  const { db, rec } = fakeDb();
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  const b = rec.state.site!.build!;
  assert.equal(b.stage, DONE_STAGE);
  assert.equal(b.url, "https://" + "mealwise" + ".appnomics.live");
  assert.equal(b.adminUrl, b.url + "/admin/sign-in");
  assert.equal(rec.state.phase, "summary");
  assert.equal(rec.state.jobId, null);
  const last = [...rec.state.msgs].reverse().find((m) => m.kind === "site_ready") ?? rec.state.msgs[rec.state.msgs.length - 1];
  assert.ok(last.kind === "site_ready" && last.ownerEmail === "owner@example.com" && last.checks.length > 0 && /\S{10,}/.test(last.password ?? ""), "the ready card has the sign-in, the password and the checklist");
  assert.ok(b.heartbeatAt, "the heartbeat was written");
  assert.equal(rec.usage.length, 1);
  assert.ok(b.files >= 2, `files counted: ${b.files}`);
  const written = await readFile(path.join(dir, "briefs", (await readdir(path.join(dir, "briefs")))[0]), "utf8");
  assert.ok(JSON.parse(written).site.name);
});

// ---- the restaurant pack ----
const localBrief = (): Record<string, unknown> => ({
  source_url: "https://testkitchen.example",
  site: { name: "Test Kitchen", kind: "local-business", business_type: "restaurant" },
  not_found: ["customer reviews", "booking link"],
  assumptions: ["Prices are shown exactly as the site wrote them."],
  consent: { owner_confirmed: true, by: "owner@example.com" },
});

await test("packFor picks the specs, the words and whether the site is static", () => {
  assert.deepEqual(packFor(localBrief()), { id: "local", specs: "vertical-packs/local-business/specs", label: "restaurant", static: true });
  assert.equal(packFor({ site: { kind: "product-showcase" } }).specs, "vertical-packs/product-showcase/specs");
  assert.equal(packFor({ site: { kind: "saas-showcase" } }).static, true);
  assert.deepEqual(packFor(JSON.parse(SITE_EXAMPLE_BRIEF)), { id: "waitlist", specs: "vertical-packs/site/specs", label: "waitlist", static: false });
  assert.equal(packFor({ site: { kind: "local-business", business_type: "x; rm -rf" } }).label, "local business");
});

await test("a restaurant build uses the local specs, deploys without an owner area, and ends with a checklist and no sign-in", async () => {
  const dir = await makeRunner({ static: true });
  const { db, rec } = fakeDb("owner@example.com", localBrief());
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  const args = JSON.parse(await readFile(path.join(dir, "create-args.json"), "utf8")) as string[];
  assert.ok(args.includes("vertical-packs/local-business/specs"), args.join(" "));
  assert.equal(args[0], "A restaurant website for Test Kitchen");
  const b = rec.state.site!.build!;
  assert.equal(b.stage, DONE_STAGE);
  assert.match(b.url!, /^https:\/\/test-kitchen\.appnomics\.live$/);
  assert.equal(b.adminUrl, undefined);
  const card = rec.state.msgs.find((m) => m.kind === "site_ready");
  assert.ok(card && card.kind === "site_ready" && card.password === undefined && card.adminUrl === undefined);
  assert.ok(card.kind === "site_ready" && card.checks.some((c) => c.includes("customer reviews")) && card.checks.some((c) => /against your own copy/.test(c)));
  const last = rec.state.msgs[rec.state.msgs.length - 1];
  assert.ok(last.kind === "bot" && /not ready for restaurant sites/.test(last.text));
});

await test("a private test deploys with --private under a private- name, with no hero picture and a private-test card", async () => {
  const dir = await makeRunner({ static: true });
  const brief = { ...localBrief(), private_test: true, consent: { private_test: true, by: "rp@example.com" } };
  const { db, rec } = fakeDb("rp@example.com", brief);
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  const args = JSON.parse(await readFile(path.join(dir, "deploy-args.json"), "utf8")) as string[];
  assert.ok(args.includes("--private"), args.join(" "));
  assert.match(args[args.indexOf("--name") + 1], /^private-test-kitchen$/);
  assert.ok(!args.includes("--email"));
  const b = rec.state.site!.build!;
  assert.equal(b.url, "https://private-test-kitchen.appnomics.live");
  assert.equal(b.heroJobId, undefined);
  const card = rec.state.msgs.find((m) => m.kind === "site_ready");
  assert.ok(card && card.kind === "site_ready" && card.checks.some((c) => /private test/i.test(c)) && card.password === undefined);
  const last = rec.state.msgs[rec.state.msgs.length - 1];
  assert.ok(last.kind === "bot" && /not published/.test(last.text));
});

await test("an owner-confirmed restaurant build never passes --private", async () => {
  const dir = await makeRunner({ static: true });
  const { db } = fakeDb("owner@example.com", localBrief());
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  const args = JSON.parse(await readFile(path.join(dir, "deploy-args.json"), "utf8")) as string[];
  assert.ok(!args.includes("--private"));
  assert.ok(!args[args.indexOf("--name") + 1].startsWith("private-"));
});

await test("a restaurant brief goes to the runner with this project's request address, and the saved brief is not changed", async () => {
  const b = localBrief();
  const out = briefForRunner(b, "proj-1", { APP_URL: "https://builder.example/" } as NodeJS.ProcessEnv);
  assert.deepEqual(out.reservations, { requests: true, endpoint: "https://builder.example/api/reserve/proj-1" });
  assert.equal((b as { reservations?: unknown }).reservations, undefined);
  assert.equal((briefForRunner(b, "p", {} as NodeJS.ProcessEnv).reservations as { endpoint: string }).endpoint, "https://builder.appnomics.dev/api/reserve/p");
});

await test("the request address is left out when the owner switched the form off, and never added to other packs", () => {
  const off = { ...localBrief(), reservations: { requests: false } };
  assert.equal(briefForRunner(off, "p"), off);
  const wl = JSON.parse(SITE_EXAMPLE_BRIEF) as Record<string, unknown>;
  assert.equal(briefForRunner(wl, "p"), wl);
});

await test("the file the runner reads carries the request address", async () => {
  const dir = await makeRunner({ static: true });
  const { db } = fakeDb("owner@example.com", localBrief());
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, APP_URL: "https://builder.example", ...quick });
  const written = JSON.parse(await readFile(path.join(dir, "briefs", (await readdir(path.join(dir, "briefs")))[0]), "utf8"));
  assert.equal(written.reservations.endpoint, "https://builder.example/api/reserve/p1");
});

await test("the waitlist build still uses the waitlist specs", async () => {
  const dir = await makeRunner({});
  const { db } = fakeDb();
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  const args = JSON.parse(await readFile(path.join(dir, "create-args.json"), "utf8")) as string[];
  assert.ok(args.includes("vertical-packs/site/specs"));
  assert.equal(args[0], "A waitlist website for Mealwise");
});

await test("a taken name is skipped and the next candidate is used", async () => {
  const dir = await makeRunner({ takenBase: "mealwise" });
  const { db, rec } = fakeDb();
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  assert.match(rec.state.site!.build!.url!, /^https:\/\/mealwise-[0-9a-f]{4}\.appnomics\.live$/);
});

await test("an address another active project uses is never deployed over: the next name is used", async () => {
  // Vercel would allow "mealwise" here (makeRunner takes nothing), but an active project already claims it.
  const dir = await makeRunner({});
  const { db, rec } = fakeDb(undefined, undefined, { "mealwise.appnomics.live": true });
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  assert.match(rec.state.site!.build!.url!, /^https:\/\/mealwise-[0-9a-f]{4}\.appnomics\.live$/);
});

await test("when every name is claimed by an active project, the build stops at publishing in plain words and deploys nothing", async () => {
  const dir = await makeRunner({});
  // Every address is taken, whatever random suffix the candidates get.
  const claimed = new Proxy({} as Record<string, boolean>, { has: () => true, get: () => true });
  const { db, rec } = fakeDb(undefined, undefined, claimed);
  await assert.rejects(() => runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick }));
  const b = rec.state.site!.build!;
  assert.equal(b.failedStage, 4);
  assert.equal(b.url, undefined);
  assert.match(b.error!, /is already used by your project "Old Mealwise" \(created Nov 1, 2026\)\. Archive that project first/);
});

await test("failing checks stop the build at Testing and nothing is deployed", async () => {
  const dir = await makeRunner({ checks: false });
  const { db, rec } = fakeDb();
  await assert.rejects(() => runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick }));
  assert.equal(rec.state.site!.build!.failedStage, 3);
  assert.equal(rec.state.site!.build!.url, undefined);
});

await test("the build records its folder, so a failed publish can be retried", async () => {
  const dir = await makeRunner({ takenBase: "" });
  const { db, rec } = fakeDb();
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  assert.ok(rec.state.site!.build!.runDir?.endsWith("runs/r1"), String(rec.state.site!.build!.runDir));
});

await test("retrying a failed publish deploys the saved site without building again", async () => {
  const dir = await makeRunner({});
  const { db, rec } = fakeDb();
  rec.state.site!.build = { stage: 4, startedAt: new Date().toISOString(), files: 12, failedStage: 4, error: "boom", runDir: path.join(dir, "runs", "r1") };
  // Poison create: a retry must not call it.
  await writeFile(path.join(dir, "create.mjs"), "process.exit(9)");
  await runSitePublish(db, { id: "job-aaaa1111", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  const b = rec.state.site!.build!;
  assert.equal(b.stage, DONE_STAGE);
  assert.match(b.url!, /^https:\/\/mealwise\.appnomics\.live$/);
  assert.equal(rec.usage.length, 0, "no build cost is logged for a retry");
  const last = [...rec.state.msgs].reverse().find((m) => m.kind === "site_ready") ?? rec.state.msgs[rec.state.msgs.length - 1];
  assert.ok(last.kind === "site_ready");
});

await test("a retry whose folder is gone stops and clears the saved folder", async () => {
  const dir = await makeRunner({});
  const { db, rec } = fakeDb();
  rec.state.site!.build = { stage: 4, startedAt: new Date().toISOString(), files: 12, failedStage: 4, runDir: path.join(dir, "runs", "nope") };
  await assert.rejects(() => runSitePublish(db, { id: "job-bbbb2222", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick }), /built again/);
  assert.equal(rec.state.site!.build!.runDir, "");
  assert.equal(rec.state.site!.build!.failedStage, 1);
});

await test("no RUNNER_DIR is a clear error", async () => {
  const { db } = fakeDb();
  const env = { ...process.env };
  delete env.RUNNER_DIR;
  await assert.rejects(() => runSiteBuild(db, { id: "j", project_id: "p" }, env), /RUNNER_DIR/);
});

await test("a restaurant with no website gets notes that fit it, and placeholders are named as placeholders", () => {
  const brief = { site: { kind: "local-business" }, source_url: null, not_found: ["tagline", "menu", "pictures", "phone"], assumptions: ["There is no website, so everything here is what was typed in the chat. Nothing was added."], page_plan: { scaffold: true } };
  const items = checklist(brief);
  assert.ok(!items.some((i) => /website did not give|copied from your website/.test(i)));
  assert.ok(items.includes('Not given, so the page shows "coming soon" blocks you can fill in later: menu and pictures.'), items.join(" | "));
  assert.ok(items.includes("Not given, so it is left off the page: tagline and phone."), items.join(" | "));
  assert.equal(items.filter((i) => /^Not given/.test(i)).length, 2, "one line for each kind of gap");
  assert.ok(items.some((i) => /what you typed in the chat/.test(i)));
  const site = checklist({ ...brief, source_url: "https://x.example", not_found: ["menu"] });
  assert.ok(site.some((i) => /Not found on your website, so the page shows "coming soon" blocks/.test(i)));
  assert.ok(site.some((i) => /copied from your website/.test(i)));
});

// ---- stage two: the owner area and the site's own database ----
await test("wantsAdmin: a restaurant site yes; a private test, a showcase, a waitlist site or the off switch no", () => {
  assert.equal(wantsAdmin(localBrief(), {} as NodeJS.ProcessEnv), true);
  assert.equal(wantsAdmin(localBrief(), { WORKER_RESTAURANT_ADMIN: "off" } as NodeJS.ProcessEnv), false);
  assert.equal(wantsAdmin({ ...localBrief(), private_test: true }, {} as NodeJS.ProcessEnv), false);
  assert.equal(wantsAdmin({ site: { kind: "product-showcase" } }, {} as NodeJS.ProcessEnv), false);
  assert.equal(wantsAdmin(JSON.parse(SITE_EXAMPLE_BRIEF), {} as NodeJS.ProcessEnv), false);
});

await test("parseAdminUrl finds the owner sign-in address", () => assert.equal(parseAdminUrl("x\nAdmin: https://a.appnomics.live/admin/login\ny"), "https://a.appnomics.live/admin/login"));

await test("a live restaurant site queues the owner area job and says so; the other kinds do not", async () => {
  const dir = await makeRunner({ static: true });
  const { db, rec } = fakeDb("owner@example.com", localBrief());
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  assert.deepEqual(rec.jobs, ["p1:site_admin"]);
  const last = rec.state.msgs[rec.state.msgs.length - 1];
  assert.ok(last.kind === "bot" && /adding your owner area now/.test(last.text) && /stays live/.test(last.text));
  const off = fakeDb("owner@example.com", localBrief());
  await runSiteBuild(off.db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, WORKER_RESTAURANT_ADMIN: "off", ...quick });
  assert.deepEqual(off.rec.jobs, []);
  const lastOff = off.rec.state.msgs[off.rec.state.msgs.length - 1];
  assert.ok(lastOff.kind === "bot" && !/owner area/.test(lastOff.text));
  const wl = fakeDb();
  await runSiteBuild(wl.db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: await makeRunner({}), ...quick });
  assert.deepEqual(wl.rec.jobs, []);
});

// ---- the design brief before a showcase build (APP-42) ----
const showcaseBrief = (): Record<string, unknown> => ({ site: { name: "PickPal", kind: "product-showcase" }, look: { mode: "dark", tone: "bold", accent: "#F97316" }, blocks: [] });
const showcaseMsgs = [
  { id: 1, kind: "bot" as const, text: "What is it called?" },
  { id: 2, kind: "user" as const, text: "it is called PickPal, daily picks for casual and serious fans. Bold is fine" },
];
const designAnswer = (audienceQuote: string) => ({
  name: { quote: "it is called PickPal", msg: 2 },
  audience: [{ value: "casual and serious fans", quote: audienceQuote, msg: 2 }],
  voice: { summary: "Plain and confident.", quotes: [{ quote: "Bold is fine", msg: 2 }] },
  owner_facts: [],
  messages: [{ text: "Daily picks.", quote: "daily picks for casual and serious fans", msg: 2 }],
  plans: [],
  look_quotes: { mode: null, accent: null, tone: { quote: "Bold is fine", msg: 2 } },
  direction: { pairing: { value: "Heavy geometric", why: "Bold." }, motif: { value: "Stack", why: "A feed of picks." }, hero_kind: { value: "fragment", why: "Pick cards." }, signatures: [{ value: "status-chips", why: "Chips on every card." }] },
  sample_card: { item: "one pick", fields: [{ label: "League", filler: "League" }, { label: "Line", filler: "0.0" }] },
  care: [{ flag: "Betting", rule: "No win claims." }],
  placeholders: [],
  other_proposals: [],
  gaps: [],
});
const fakeModel = (answer: unknown): ToolCall => async () => ({ toolUse: { id: "tu1", input: answer }, usage: { input: 2000, output: 3000, cacheRead: 0, cacheWrite: 4000 } });

await test("a showcase build writes the design brief first and passes it to the runner when it passes its checks", async () => {
  const dir = await makeRunner({ static: true });
  await mkdir(path.join(dir, "briefs"), { recursive: true });
  const { db, rec } = fakeDb("owner@example.com", showcaseBrief());
  rec.state = { ...rec.state, msgs: showcaseMsgs };
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick }, { designBriefCall: fakeModel(designAnswer("casual and serious fans")) });
  await recordsSettled();
  const args = JSON.parse(await readFile(path.join(dir, "create-args.json"), "utf8")) as string[];
  const i = args.indexOf("--design-brief");
  assert.ok(i > -1, args.join(" "));
  assert.equal(args[i + 1], "briefs/pickpal-job-1234.design-brief.md");
  assert.match(await readFile(path.join(dir, args[i + 1]), "utf8"), /^# Design brief: PickPal/);
  const d = rec.records[0].details.designBrief;
  assert.equal(d.passed, true);
  assert.equal(d.passedToRunner, true);
  assert.equal(d.model, "claude-opus-5-5");
  assert.equal(d.json.direction.pairing.value, "Heavy geometric");
  assert.match(d.markdown, /## Recommended direction/);
  assert.equal(d.quoteCheck.failed.length, 0);
  assert.equal(d.costUsd, 0.088);
  assert.equal(rec.usage.length, 2, "one usage row for the design brief, one for the build");
  assert.equal(rec.usage[0][2], "claude-opus-5-5");
  assert.equal(d.source, "build_start");
  assert.equal(rec.designBrief?.by, "build_start", "a brief written at build start is saved on the project too");
  assert.equal(rec.designBrief?.status, "done");
  assert.equal(rec.state.site!.build!.stage, DONE_STAGE);
});

await test("a design brief that still fails after its retry is kept in the record and not given to the runner", async () => {
  const dir = await makeRunner({ static: true });
  const { db, rec } = fakeDb("owner@example.com", showcaseBrief());
  rec.state = { ...rec.state, msgs: showcaseMsgs };
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick }, { designBriefCall: fakeModel(designAnswer("every sports fan in America")) });
  await recordsSettled();
  const args = JSON.parse(await readFile(path.join(dir, "create-args.json"), "utf8")) as string[];
  assert.ok(!args.includes("--design-brief"), args.join(" "));
  const d = rec.records[0].details.designBrief;
  assert.equal(d.attempts, 2);
  assert.equal(d.passed, false);
  assert.equal(d.passedToRunner, false);
  assert.deepEqual(d.quoteCheck.failed.map((f: { quote: string }) => f.quote), ["every sports fan in America"]);
  assert.ok(d.json && d.markdown, "the failing brief is saved for review");
  assert.equal(rec.state.site!.build!.stage, DONE_STAGE, "the build goes on");
});

await test("a showcase build uses the design brief saved at review, with no model call and no second cost", async () => {
  const dir = await makeRunner({ static: true });
  await mkdir(path.join(dir, "briefs"), { recursive: true });
  const { db, rec } = fakeDb("owner@example.com", showcaseBrief());
  rec.state = { ...rec.state, msgs: showcaseMsgs };
  const md = "# Design brief: PickPal\n\nWritten at review.\n";
  const { fingerprint, upToMsg } = designBriefInput(showcaseMsgs, showcaseBrief());
  rec.designBrief = {
    v: 1, fingerprint, upToMsg, status: "done", token: "t1", by: "review", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), reason: null,
    result: { skipped: null, fingerprint, model: "claude-opus-5-5", attempts: 1, passed: true, quoteCheck: { checked: 3, passed: 3, failed: [], msgCorrected: 0 }, problems: [], firstAttempt: null, json: {}, markdown: md, costUsd: 0.2, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, durationMs: 1, error: null },
  };
  let called = false;
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick }, { designBriefCall: async () => { called = true; throw new Error("no"); } });
  await recordsSettled();
  assert.equal(called, false);
  const args = JSON.parse(await readFile(path.join(dir, "create-args.json"), "utf8")) as string[];
  assert.equal(await readFile(path.join(dir, args[args.indexOf("--design-brief") + 1]), "utf8"), md);
  const d = rec.records[0].details.designBrief;
  assert.equal(d.source, "review");
  assert.equal(d.passedToRunner, true);
  assert.equal(rec.usage.length, 1, "only the build's own usage row: the brief was paid for at review");
});

await test("other packs get no design brief, and a showcase build without a key goes on without one", async () => {
  const dir = await makeRunner({});
  const { db, rec } = fakeDb();
  rec.state = { ...rec.state, msgs: showcaseMsgs };
  let called = false;
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick }, { designBriefCall: async () => { called = true; throw new Error("no"); } });
  await recordsSettled();
  assert.equal(called, false);
  assert.equal(rec.records[0].details.designBrief, null);
  const sdir = await makeRunner({ static: true });
  const s = fakeDb("owner@example.com", showcaseBrief());
  s.rec.state = { ...s.rec.state, msgs: showcaseMsgs };
  const env = { ...process.env, RUNNER_DIR: sdir, ...quick };
  delete env.ANTHROPIC_API_KEY;
  await runSiteBuild(s.db, { id: "job-1234abcd", project_id: "p1" }, env);
  await recordsSettled();
  assert.match(s.rec.records[0].details.designBrief.skipped, /no ANTHROPIC_API_KEY/);
  assert.ok(!(JSON.parse(await readFile(path.join(sdir, "create-args.json"), "utf8")) as string[]).includes("--design-brief"));
});

/** A stand-in runner for stage two. mode: ok | once (fails the first time) | always | kept. It records each call's arguments and whether ADMIN_PASSWORD was set. */
async function makeAdminRunner(mode: "ok" | "once" | "always" | "kept") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runner-admin-"));
  await mkdir(path.join(dir, "runs", "r1", "app"), { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { deploy: "node deploy.mjs" } }));
  await writeFile(
    path.join(dir, "deploy.mjs"),
    `import { appendFileSync, readFileSync, existsSync } from "node:fs";
const calls = new URL("./calls.log", import.meta.url);
appendFileSync(calls, JSON.stringify({ args: process.argv.slice(2), pw: process.env.ADMIN_PASSWORD }) + "\\n");
const n = readFileSync(calls, "utf8").trim().split("\\n").length;
const mode = ${JSON.stringify(mode)};
if (mode === "always" || (mode === "once" && n === 1)) { console.log("FAILED. The live site was not changed."); console.log("Neon did not create the project (402): project limit " + process.env.ADMIN_PASSWORD); process.exit(1); }
if (mode === "kept") { console.log("The new version is deployed, but the site did not answer as expected. The database was kept."); process.exit(1); }
console.log("Admin: https://test-kitchen.appnomics.live/admin/login");
console.log("Owner sign-in: owner@example.com");
`,
  );
  return dir;
}
const liveState = (dir: string, extra: Partial<SiteBuild> = {}) => {
  const f = fakeDb("owner@example.com", localBrief());
  f.rec.state.msgs = [{ id: 1, kind: "site_ready", name: "Test Kitchen", url: "https://test-kitchen.appnomics.live", checks: ["Read it once."] }];
  f.rec.state.nextId = 2;
  f.rec.state.site!.build = { stage: DONE_STAGE, startedAt: new Date().toISOString(), files: 3, url: "https://test-kitchen.appnomics.live", runDir: path.join(dir, "runs", "r1"), ...extra };
  return f;
};
const callsOf = async (dir: string) => (await readFile(path.join(dir, "calls.log"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { args: string[]; pw?: string });

await test("the owner area job runs --add-database with the owner email and a password, then puts the sign-in on the ready card", async () => {
  const dir = await makeAdminRunner("ok");
  const { db, rec } = liveState(dir);
  await runSiteAdmin(db, { id: "job-adm00001", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir });
  const calls = await callsOf(dir);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes("--add-database") && calls[0].args[calls[0].args.indexOf("--email") + 1] === "owner@example.com", calls[0].args.join(" "));
  assert.ok(!calls[0].args.includes(calls[0].pw!), "the password is not on the command line");
  assert.ok(/\S{10,}/.test(calls[0].pw ?? ""), "a generated password reaches the deploy script through the environment");
  const card = rec.state.msgs.find((m) => m.kind === "site_ready");
  assert.ok(card && card.kind === "site_ready" && card.adminUrl === "https://test-kitchen.appnomics.live/admin/login" && card.ownerEmail === "owner@example.com" && card.password === calls[0].pw);
  assert.equal(rec.state.site!.build!.adminUrl, "https://test-kitchen.appnomics.live/admin/login");
  const last = rec.state.msgs[rec.state.msgs.length - 1];
  assert.ok(last.kind === "bot" && /owner area is ready/.test(last.text) && !last.text.includes(calls[0].pw!));
  assert.equal(rec.state.site!.build!.url, "https://test-kitchen.appnomics.live", "the live address is untouched");
});

await test("the owner area job tries once more after a failure, and the second try is enough", async () => {
  const dir = await makeAdminRunner("once");
  const { db, rec } = liveState(dir);
  await runSiteAdmin(db, { id: "job-adm00002", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir });
  assert.equal((await callsOf(dir)).length, 2);
  assert.ok(rec.state.site!.build!.adminUrl);
});

await test("when it fails twice the chat says the public site is fine, the password never appears, and the job fails", async () => {
  const dir = await makeAdminRunner("always");
  const { db, rec } = liveState(dir);
  await assert.rejects(() => runSiteAdmin(db, { id: "job-adm00003", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir }), /owner area was not added/);
  const calls = await callsOf(dir);
  assert.equal(calls.length, 2);
  const last = rec.state.msgs[rec.state.msgs.length - 1];
  assert.ok(last.kind === "bot" && /live and works as before/.test(last.text) && /project limit/.test(last.text), last.kind === "bot" ? last.text : "");
  assert.ok(!JSON.stringify(rec.state).includes(calls[0].pw!), "the password is not in the saved state or the message");
  assert.equal(rec.state.site!.build!.adminUrl, undefined);
  assert.equal(rec.state.site!.build!.url, "https://test-kitchen.appnomics.live");
});

await test("a database that was kept is never created a second time", async () => {
  const dir = await makeAdminRunner("kept");
  const { db } = liveState(dir);
  await assert.rejects(() => runSiteAdmin(db, { id: "job-adm00004", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir }));
  assert.equal((await callsOf(dir)).length, 1);
});

await test("a site that already has an owner area is left alone; a missing folder or a non-restaurant site is refused", async () => {
  const dir = await makeAdminRunner("ok");
  const done = liveState(dir, { adminUrl: "https://x/admin/login" });
  await runSiteAdmin(done.db, { id: "j", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir });
  assert.equal(await readFile(path.join(dir, "calls.log"), "utf8").catch(() => ""), "");
  const gone = liveState(dir, { runDir: path.join(dir, "runs", "nope") });
  await assert.rejects(() => runSiteAdmin(gone.db, { id: "j", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir }), /not added/);
  const last = gone.rec.state.msgs[gone.rec.state.msgs.length - 1];
  assert.ok(last.kind === "bot" && /no longer on the builder/.test(last.text));
  const wl = fakeDb();
  wl.rec.state.site!.build = { stage: DONE_STAGE, startedAt: "x", files: 1, url: "https://m.appnomics.live", runDir: path.join(dir, "runs", "r1") };
  await assert.rejects(() => runSiteAdmin(wl.db, { id: "j", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir }), /restaurant/);
});


// ---- learning data (APP-15) ----
await test("a good build saves one build record, with the approved brief, Scout's draft, the run and the transcript counts", async () => {
  const dir = await makeRunner({});
  const { db, rec } = fakeDb();
  const draft = { ...rec.state.site!.brief, site: { name: "Draft name" } };
  const chat: WorkspaceState["msgs"] = [
    { id: 1, kind: "bot", text: "What is your idea about?" },
    { id: 2, kind: "user", text: "Meal plans for busy parents, called Mealwise" },
  ];
  rec.state = { ...rec.state, msgs: chat, nextId: 3, site: { ...rec.state.site!, draftBrief: draft, draftBriefAt: "2026-11-16T10:00:00.000Z" } };
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  await recordsSettled();
  assert.equal(rec.records.length, 1);
  const r = rec.records[0];
  assert.equal(r.pack, "waitlist");
  assert.equal(r.outcome, "live");
  assert.deepEqual(r.details.draftBrief, draft);
  assert.equal(r.details.draftBriefAt, "2026-11-16T10:00:00.000Z");
  assert.equal(r.details.brief.site.name, rec.state.site!.brief.site && (rec.state.site!.brief.site as { name: string }).name);
  assert.equal(r.details.run.estimatedCostUsd, 3.1, "no run.json, so the printed summary is kept");
  assert.deepEqual(r.details.transcript.toolCalls, { write_file: 2, run_command: 1 });
  assert.equal(r.details.site.address, "mealwise.appnomics.live");
  assert.equal(r.details.failure, null);
  assert.ok(r.details.timing.startedAt <= r.details.timing.finishedAt);
  // The interview as it was when the build started (APP-42): the ready card this build posted is not part of it.
  assert.deepEqual(r.details.interview, { messageCount: 2, messages: chat });
  assert.ok(rec.state.msgs.some((m) => m.kind === "site_ready"), "the build itself still posted its ready card");
  // The finished state keeps the draft, so a later build in the same project has it too.
  assert.deepEqual(rec.state.site!.draftBrief, draft);
});

await test("a failed build is recorded as failed with the stage it stopped at, and the build still fails as before", async () => {
  const dir = await makeRunner({ checks: false });
  const { db, rec } = fakeDb();
  await assert.rejects(() => runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick }));
  await recordsSettled();
  assert.equal(rec.records.length, 1);
  assert.equal(rec.records[0].outcome, "failed");
  assert.equal(rec.records[0].details.failure.stage, 3);
  assert.match(rec.records[0].details.failure.error, /final checks/);
});

await test("a record that cannot be saved changes nothing about the build", async () => {
  const dir = await makeRunner({});
  const { db, rec } = fakeDb();
  const broken: Db = { query: (text, params) => (text.startsWith("INSERT INTO build_records") ? Promise.reject(new Error("no such table")) : db.query(text, params)) };
  await runSiteBuild(broken, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  await recordsSettled();
  assert.equal(rec.state.site!.build!.stage, DONE_STAGE);
  assert.equal(rec.records.length, 0);
});

await test("a publish retry is not a new build, so it saves no record", async () => {
  const dir = await makeRunner({});
  const { db, rec } = fakeDb();
  rec.state = { ...rec.state, site: { ...rec.state.site!, build: { ...rec.state.site!.build!, failedStage: 4, runDir: path.join(dir, "runs", "r1") } } };
  await runSitePublish(db, { id: "job-aaaa1111", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  await recordsSettled();
  assert.equal(rec.records.length, 0);
});

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
