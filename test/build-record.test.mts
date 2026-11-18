/**
 * Learning data (APP-15): the build record's parts, read from a stand-in run folder, and the draft brief kept in the
 * workspace state. No database: the record's insert goes to an in-memory stand-in.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gatherBuildRecord, logSections, lookPassChanges, parseNumstat, redact, saveBuildRecord, specsHash, transcriptFacts, type BuildRecordInput } from "../worker/build-record";
import { keepDraftBrief, noteOnBuildRecords } from "../src/lib/build-records";
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

const LOG = `# AGENT_LOG: Test site

## What I built and where
A page.

## Not verified
- The form on a phone.

## Unclear, missing or misleading in the specs
- The grid table does not say what to do with five cards.

## Mistakes made and fixed
- Used DATABASE_URL=postgres://user:hunter2@db.example/app by mistake, then fixed it.

## Look pass
### Grids
Four cards are now 2 by 2.
### Not verified
- Dark mode.

## Change: Shorter headline
Done.

## Change: Shorter headline
Again.
`;

// ---- pure helpers ----
await test("redact masks database addresses, API keys and NAME=value secrets", () => {
  const t = redact("url postgres://u:pw@h/db and sk-ant-abc123def456ghi and ADMIN_PASSWORD=s3cret and RESEND_API_KEY = re_x and plain words");
  assert.ok(!/pw@|abc123|s3cret|re_x/.test(t), t);
  assert.match(t, /postgres:\/\/\*\*\*/);
  assert.match(t, /ADMIN_PASSWORD=\*\*\*/);
  assert.match(t, /plain words/);
});

await test("logSections keeps every ## section by heading, with its ### parts, and masks secrets", () => {
  const s = logSections(LOG);
  assert.deepEqual(Object.keys(s), ["What I built and where", "Not verified", "Unclear, missing or misleading in the specs", "Mistakes made and fixed", "Look pass", "Change: Shorter headline", "Change: Shorter headline (2)"]);
  assert.match(s["Look pass"], /### Grids[\s\S]*### Not verified[\s\S]*Dark mode/);
  assert.equal(s["Not verified"], "- The form on a phone.");
  assert.ok(!s["Mistakes made and fixed"].includes("hunter2"));
  assert.deepEqual(logSections("no headings at all"), {});
});

await test("transcriptFacts counts tool and model calls and finds where the look pass started", () => {
  const lines = [
    { t: "2026-11-16T10:00:00Z", turn: 1, model_call: {} },
    { t: "2026-11-16T10:00:01Z", turn: 1, tool: "write_file" },
    { t: "2026-11-16T10:05:00Z", turn: 2, tool: "run_command" },
    "not json",
    { t: "2026-11-16T10:30:00Z", turn: 1, model_call: {} },
    { t: "2026-11-16T10:30:05Z", turn: 1, tool: "write_file" },
    { t: "2026-11-16T10:40:00Z", turn: 2, final: "done" },
  ].map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n");
  const f = transcriptFacts(lines);
  assert.equal(f.lines, 7);
  assert.equal(f.modelCalls, 2);
  assert.deepEqual(f.toolCalls, { write_file: 2, run_command: 1 });
  assert.equal(f.lookPassStartedAt, "2026-11-16T10:30:00Z");
  assert.equal(transcriptFacts('{"turn":1}\n{"turn":2}\n').lookPassStartedAt, null, "no look pass (for example --no-look-pass)");
});

await test("parseNumstat reads files and line counts, binary files as null", () => {
  assert.deepEqual(parseNumstat("12\t3\tsrc/app/page.tsx\n-\t-\tpublic/hero.png\n"), [
    { path: "src/app/page.tsx", added: 12, removed: 3 },
    { path: "public/hero.png", added: null, removed: null },
  ]);
});

await test("specsHash is the same for the same files and changes when a file changes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "specs-"));
  await mkdir(path.join(dir, "sub"));
  await writeFile(path.join(dir, "look.md"), "rules");
  await writeFile(path.join(dir, "sub", "edges.json"), "[]");
  const a = await specsHash(dir);
  assert.match(a ?? "", /^[0-9a-f]{16}$/);
  assert.equal(await specsHash(dir), a);
  await writeFile(path.join(dir, "look.md"), "rules, changed");
  assert.notEqual(await specsHash(dir), a);
  assert.equal(await specsHash(path.join(dir, "missing")), null);
});

// ---- the draft brief ----
const withSite = (phase: WorkspaceState["phase"], brief: Record<string, unknown>, extra: Partial<NonNullable<WorkspaceState["site"]>> = {}): WorkspaceState => ({ ...emptyState(), phase, site: { brief, ...extra } });

await test("Scout's draft is taken the first time the interview reaches the review screen", () => {
  const before = { ...emptyState(), phase: "intake" as const };
  const next = keepDraftBrief(before, withSite("summary", { v: "draft" }), () => "2026-11-16T10:00:00.000Z");
  assert.deepEqual(next.site!.draftBrief, { v: "draft" });
  assert.equal(next.site!.draftBriefAt, "2026-11-16T10:00:00.000Z");
});

await test("the owner's later edits never replace the draft, even when the interview rebuilds the site object", () => {
  const prev = withSite("summary", { v: "edited once" }, { draftBrief: { v: "draft" }, draftBriefAt: "t0" });
  // site-interviewer writes site: { brief } from scratch, which drops the draft; it is carried over from before the turn.
  const next = keepDraftBrief(prev, withSite("summary", { v: "edited twice" }));
  assert.deepEqual(next.site!.draftBrief, { v: "draft" });
  assert.equal(next.site!.draftBriefAt, "t0");
  assert.deepEqual(next.site!.brief, { v: "edited twice" });
});

await test("no draft is taken before the review screen, and a state without a brief is left alone", () => {
  assert.equal(keepDraftBrief(emptyState(), withSite("intake", { v: "half done" })).site!.draftBrief, undefined);
  const bare = { ...emptyState(), phase: "intake" as const };
  assert.equal(keepDraftBrief(withSite("summary", { v: "x" }, { draftBrief: { v: "x" } }), bare), bare, "start over clears the brief, so there is nothing to keep");
});

await test("archived and restored are appended to the project's records, and a failure is swallowed", async () => {
  const seen: unknown[][] = [];
  await noteOnBuildRecords({ query: async (text, params = []) => { seen.push([text, ...params]); return { rows: [] }; } }, "p1", "archived", "2026-11-16T12:00:00.000Z");
  assert.match(String(seen[0][0]), /UPDATE build_records[\s\S]*'\{events\}'[\s\S]*WHERE project_id = \$1/);
  assert.deepEqual(JSON.parse(String(seen[0][2])), [{ event: "archived", at: "2026-11-16T12:00:00.000Z" }]);
  await noteOnBuildRecords({ query: async () => { throw new Error("down"); } }, "p1", "restored");
});

// ---- a whole record from a stand-in run folder ----
function sh(cwd: string, args: string[], date?: string) {
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) };
  return execFileSync("git", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

async function makeRun() {
  const runner = await mkdtemp(path.join(os.tmpdir(), "runner-"));
  await mkdir(path.join(runner, "vertical-packs", "site", "specs"), { recursive: true });
  await writeFile(path.join(runner, "vertical-packs", "site", "specs", "look.md"), "rules");
  const runDir = path.join(runner, "runs", "r1");
  const app = path.join(runDir, "app");
  await mkdir(path.join(app, "src"), { recursive: true });
  sh(app, ["init", "-q"]);
  await writeFile(path.join(app, "src", "page.tsx"), "a\nb\n");
  sh(app, ["add", "."]);
  sh(app, ["commit", "-qm", "Main build"], "2026-11-16T10:10:00Z");
  await writeFile(path.join(app, "src", "page.tsx"), "a\nb\nc\nd\n");
  await writeFile(path.join(app, "AGENT_LOG.md"), LOG);
  sh(app, ["add", "."]);
  sh(app, ["commit", "-qm", "Look pass: grids"], "2026-11-16T10:35:00Z");
  await writeFile(path.join(runDir, "transcript.jsonl"), ['{"t":"2026-11-16T10:00:00Z","turn":1}', '{"t":"2026-11-16T10:09:00Z","turn":9,"tool":"write_file"}', '{"t":"2026-11-16T10:30:00Z","turn":1}', '{"t":"2026-11-16T10:34:00Z","turn":2,"tool":"write_file"}'].join("\n"));
  await writeFile(path.join(runDir, "run.json"), JSON.stringify({ runId: "r1", turns: 42, durationMinutes: 25.5, estimatedCostUsd: 3.2, tokens: { input: 1, output: 2 }, checks: { typecheck: true, build: true } }));
  await writeFile(path.join(runDir, "deploy.json"), JSON.stringify({ name: "testsite", host: "testsite.appnomics.live", adminPassword: "never", deployedAt: "2026-11-16T10:50:00Z" }));
  return { runner, runDir, app };
}

const input = (over: Partial<BuildRecordInput>): BuildRecordInput => ({
  projectId: "p1",
  jobId: "job-1234abcd",
  pack: { id: "waitlist", specs: "vertical-packs/site/specs" },
  brief: { schema_version: "1.0", site: { name: "Test site" } },
  draftBrief: { schema_version: "1.0", site: { name: "Draft" } },
  draftBriefAt: "2026-11-16T09:00:00Z",
  runner: "/nowhere",
  startedAt: "2026-11-16T10:00:00Z",
  finishedAt: "2026-11-16T10:55:00Z",
  outcome: "live",
  url: "https://testsite.appnomics.live",
  siteName: "Test site",
  privateTest: false,
  heroShot: true,
  env: {},
  ...over,
});

await test("the look pass changes are the commits after it started, with files and line counts", async () => {
  const { app } = await makeRun();
  const lp = await lookPassChanges(app, "2026-11-16T10:30:00Z");
  assert.deepEqual(lp.files, [{ path: "AGENT_LOG.md", added: LOG.split("\n").length - 1, removed: 0 }, { path: "src/page.tsx", added: 2, removed: 0 }]);
  assert.deepEqual(lp.commits.map((c) => c.subject), ["Look pass: grids"]);
  assert.match(lp.base ?? "", /^[0-9a-f]{12}$/);
});

await test("a record holds the brief and draft, the pack, run.json, the log sections, the look pass and the deploy facts", async () => {
  const { runner, runDir } = await makeRun();
  const r = await gatherBuildRecord(input({ runner, runDir, env: { FLY_IMAGE_REF: "registry.fly.io/x:1" } }));
  const d = r.details as any;
  assert.equal(r.pack, "waitlist");
  assert.equal(r.outcome, "live");
  assert.equal(d.draftBrief.site.name, "Draft");
  assert.equal(d.brief.site.name, "Test site");
  assert.equal(d.briefSchemaVersion, "1.0");
  assert.match(d.packInfo.specsHash, /^[0-9a-f]{16}$/);
  assert.equal(d.packInfo.builderImage, "registry.fly.io/x:1");
  assert.equal(d.run.turns, 42);
  assert.equal(d.run.durationMinutes, 25.5);
  assert.ok(d.agentLog["Unclear, missing or misleading in the specs"].includes("five cards"));
  assert.ok(d.agentLog["Mistakes made and fixed"] && d.agentLog["Not verified"]);
  assert.equal(d.lookPass.startedAt, "2026-11-16T10:30:00Z");
  assert.ok(d.lookPass.files.some((f: { path: string }) => f.path === "src/page.tsx"));
  assert.match(d.lookPass.why, /Four cards are now 2 by 2/);
  assert.deepEqual(d.transcript, { lines: 4, modelCalls: 0, toolCalls: { write_file: 2 } });
  assert.equal(d.deploy.host, "testsite.appnomics.live");
  assert.equal(d.deploy.adminPassword, undefined, "anything that looks like a secret is left out of deploy.json");
  assert.deepEqual(d.site, { name: "Test site", url: "https://testsite.appnomics.live", address: "testsite.appnomics.live", privateTest: false, heroShot: true });
  assert.equal(d.failure, null);
  assert.ok(!JSON.stringify(d).includes("hunter2"), "no secret from the log ends up in the record");
});

await test("a build that failed before it had a folder still gets a record, with the stage and the masked error", async () => {
  const r = await gatherBuildRecord(input({ outcome: "failed", failedStage: 1, error: "boom at postgres://u:pw@h/db", url: null, runDir: undefined, summary: { stopReason: "max_cost" } }));
  const d = r.details as any;
  assert.equal(r.outcome, "failed");
  assert.deepEqual(d.failure, { stage: 1, error: "boom at postgres://***" });
  assert.deepEqual(d.run, { stopReason: "max_cost" });
  assert.equal(d.agentLog, null);
  assert.equal(d.lookPass, null);
  assert.equal(d.packInfo.specsHash, null);
  assert.equal(d.packInfo.runnerCommit, null);
});

await test("saving inserts one row with the typed columns and adds the owner and project date in the database", async () => {
  const seen: unknown[][] = [];
  const ok = await saveBuildRecord({ query: async (text, params = []) => { seen.push([text, ...params]); return { rows: [] }; } }, input({}));
  assert.equal(ok, true);
  assert.match(String(seen[0][0]), /^INSERT INTO build_records \(project_id, job_id, pack, outcome, details\)/);
  assert.match(String(seen[0][0]), /'ownerId', owner_id, 'projectCreatedAt', created_at/);
  assert.deepEqual(seen[0].slice(1, 5), ["p1", "job-1234abcd", "waitlist", "live"]);
});

await test("saving never throws: a database error or a slow database just means no record", async () => {
  assert.equal(await saveBuildRecord({ query: async () => { throw new Error("relation build_records does not exist"); } }, input({})), false);
  const started = Date.now();
  assert.equal(await saveBuildRecord({ query: () => new Promise(() => {}) }, input({ env: { WORKER_RECORD_MS: "100" } })), false);
  assert.ok(Date.now() - started < 2000, "it gave up after the time limit");
});

// ---- the interview (APP-42) ----
const CHAT: WorkspaceState["msgs"] = [
  { id: 1, kind: "bot", text: "What's your product, in one or two sentences?" },
  { id: 2, kind: "user", text: "it is called SureBetz. They get daily picks for all major amercian sports league" },
  { id: 3, kind: "bot", text: "Sporty and orange?", options: ["Yes", "No"], palette: ["#F97316"] },
  { id: 4, kind: "user", text: "my key is sk-ant-abc123def456ghi and ADMIN_PASSWORD=s3cret" },
  { id: 5, kind: "recap", items: [{ label: "Name", value: "SureBetz" }] },
  { id: 6, kind: "site_ready", name: "SureBetz", url: "https://surebetz.appnomics.live", adminUrl: "https://surebetz.appnomics.live/admin", ownerEmail: "o@example.com", password: "hunter2-owner", checks: ["Check the prices"] },
];

await test("the record keeps the whole interview in order, under details.interview", async () => {
  const d = (await gatherBuildRecord(input({ interview: CHAT }))).details as any;
  assert.equal(d.interview.messageCount, 6);
  assert.deepEqual(d.interview.messages.map((m: { id: number }) => m.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(d.interview.messages[1].text, "it is called SureBetz. They get daily picks for all major amercian sports league");
  assert.deepEqual(d.interview.messages[2].options, ["Yes", "No"]);
  assert.deepEqual(d.interview.messages[4].items, [{ label: "Name", value: "SureBetz" }]);
  assert.deepEqual(d.interview.messages[5].checks, ["Check the prices"]);
});

await test("the interview is masked like the log, and the owner password is dropped", async () => {
  const d = (await gatherBuildRecord(input({ interview: CHAT }))).details as any;
  const json = JSON.stringify(d.interview);
  assert.ok(!/abc123|s3cret|hunter2-owner/.test(json), json);
  assert.match(d.interview.messages[3].text, /ADMIN_PASSWORD=\*\*\*/);
  assert.ok(!("password" in d.interview.messages[5]), "the password field is gone");
  assert.equal(d.interview.messages[5].adminUrl, "https://surebetz.appnomics.live/admin");
});

await test("a very long message is capped, so one paste cannot swell the record", async () => {
  const d = (await gatherBuildRecord(input({ interview: [{ id: 1, kind: "user", text: "x".repeat(50_000) }] }))).details as any;
  assert.equal(d.interview.messages[0].text.length, 20_000);
});

await test("a missing or broken interview gives null and the record is still saved", async () => {
  for (const interview of [undefined, null, [], "not a list", { msgs: [] }, [null, 3, "x"]]) {
    const d = (await gatherBuildRecord(input({ interview }))).details as any;
    assert.ok("interview" in d, "the key is always there");
    assert.equal(d.interview, null, `for ${JSON.stringify(interview)}`);
  }
  const seen: unknown[][] = [];
  const ok = await saveBuildRecord({ query: async (text, params = []) => { seen.push([text, ...params]); return { rows: [] }; } }, input({ interview: undefined }));
  assert.equal(ok, true);
  assert.equal(JSON.parse(String(seen[0][5])).interview, null);
});

await test("the saved details carry the interview to the database", async () => {
  const seen: unknown[][] = [];
  await saveBuildRecord({ query: async (text, params = []) => { seen.push([text, ...params]); return { rows: [] }; } }, input({ interview: CHAT }));
  const saved = JSON.parse(String(seen[0][5]));
  assert.equal(saved.interview.messageCount, 6);
  assert.ok(!String(seen[0][5]).includes("hunter2-owner"));
});

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
