/**
 * Tests the real build path without a model: a stand-in runner prints the same stage markers as the real one,
 * and an in-memory stand-in for the database records what the worker writes.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checklist, nameCandidates, parseLiveUrl, parseSummary, runSiteBuild, type Db } from "../worker/site-build";
import { SITE_EXAMPLE_BRIEF } from "../src/lib/builder/site-pack.generated";
import { DONE_STAGE } from "../src/lib/builder/site-stages";
import { emptyState } from "../src/lib/workspace/state";
import type { SiteBuild, WorkspaceState } from "../src/lib/workspace/types";

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
async function makeRunner(opts: { checks?: boolean; takenBase?: string }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runner-"));
  await mkdir(path.join(dir, "runs", "r1", "app"), { recursive: true });
  await writeFile(path.join(dir, "runs", "r1", "transcript.jsonl"), '{"turn":1,"tool":"write_file"}\n{"turn":2,"tool":"write_file"}\n{"turn":3,"tool":"run_command"}\n');
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ scripts: { create: "node create.mjs", deploy: "node deploy.mjs" } }),
  );
  await writeFile(
    path.join(dir, "create.mjs"),
    `console.log("1/4 Writing the brief…");
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
    `const name = process.argv[process.argv.indexOf("--name") + 1];
if (name === ${JSON.stringify(opts.takenBase ?? "")}) { console.log('A Vercel project named "' + name + '" already exists in this account. Nothing was changed.'); process.exit(1); }
for (let i = 1; i <= 7; i++) console.log(i + "/7 step");
if (!process.env.ADMIN_PASSWORD) process.exit(2);
console.log("Live: https://" + name + ".appnomics.live");
`,
  );
  return dir;
}

function fakeDb(email = "owner@example.com") {
  const st: WorkspaceState = { ...emptyState(), phase: "build", jobId: "j1", site: { brief: JSON.parse(SITE_EXAMPLE_BRIEF), build: { stage: 0, startedAt: new Date().toISOString(), files: 0 } } };
  const rec = { state: st, usage: [] as unknown[][], status: "building" };
  const db: Db = {
    async query(text, params = []) {
      if (text.includes("FROM projects p JOIN users")) return { rows: [{ state: rec.state, email }] };
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
  const last = rec.state.msgs[rec.state.msgs.length - 1];
  assert.ok(last.kind === "bot" && last.text.includes("owner@example.com") && last.text.includes("Check these before you share it"));
  assert.ok(b.heartbeatAt, "the heartbeat was written");
  assert.equal(rec.usage.length, 1);
  assert.ok(b.files >= 2, `files counted: ${b.files}`);
  const written = await readFile(path.join(dir, "briefs", (await readdir(path.join(dir, "briefs")))[0]), "utf8");
  assert.ok(JSON.parse(written).site.name);
});

await test("a taken name is skipped and the next candidate is used", async () => {
  const dir = await makeRunner({ takenBase: "mealwise" });
  const { db, rec } = fakeDb();
  await runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick });
  assert.match(rec.state.site!.build!.url!, /^https:\/\/mealwise-[0-9a-f]{4}\.appnomics\.live$/);
});

await test("failing checks stop the build at Testing and nothing is deployed", async () => {
  const dir = await makeRunner({ checks: false });
  const { db, rec } = fakeDb();
  await assert.rejects(() => runSiteBuild(db, { id: "job-1234abcd", project_id: "p1" }, { ...process.env, RUNNER_DIR: dir, ...quick }));
  assert.equal(rec.state.site!.build!.failedStage, 3);
  assert.equal(rec.state.site!.build!.url, undefined);
});

await test("no RUNNER_DIR is a clear error", async () => {
  const { db } = fakeDb();
  const env = { ...process.env };
  delete env.RUNNER_DIR;
  await assert.rejects(() => runSiteBuild(db, { id: "j", project_id: "p" }, env), /RUNNER_DIR/);
});

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
