/**
 * The design brief written at review and saved on the project (APP-49): the fingerprint, what a build does with what is
 * saved, the review step (settle, skip, claim, failure) and the worker's reuse or fallback. No model and no database: the
 * model is a stand-in that returns a prepared answer, and the project row lives in memory. The interview is made up.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { designBriefFingerprint, type InterviewMessage } from "../src/lib/builder/design-brief";
import type { ToolCall } from "../src/lib/agents/design-brief-writer";
import { designBriefInput } from "../src/lib/agents/design-brief-step";
import { decide, designBriefAtReview, savedBriefForBuild, shouldStartAtReview, WRITING_STALE_MS, type Db, type SavedDesignBrief } from "../src/lib/design-brief-store";
import { designBriefForBuild } from "../worker/design-brief";

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

const MSGS: InterviewMessage[] = [
  { id: 1, kind: "bot", text: "What is the product called, and what does it do?" },
  { id: 2, kind: "user", text: "it is called PickPal. members get daily picks for all 4 major leagues in America" },
  { id: 3, kind: "bot", text: "Who is it for?" },
  { id: 4, kind: "user", text: "yes thats right, for casual and  serious fans" },
  { id: 5, kind: "bot", text: "What are the plans?" },
  { id: 6, kind: "user", text: "Weekly $49 for 7 days, Monthly $149 for 30 days. no auto renew" },
  { id: 7, kind: "bot", text: "Which look?" },
  { id: 8, kind: "user", text: "Dark, and orange. Bold is fine" },
  { id: 9, kind: "bot", text: "Your brief is saved. When it looks right, press Build my site." },
];
const BRIEF = { site: { name: "PickPal", kind: "product-showcase" }, look: { mode: "dark", tone: "bold", accent: "#F97316" }, blocks: [] };

function goodAnswer(): any {
  return {
    name: { quote: "it is called PickPal", msg: 2 },
    audience: [{ value: "casual and serious fans", quote: "for casual and  serious fans", msg: 4 }],
    voice: { summary: "Plain and confident.", quotes: [{ quote: "Bold is fine", msg: 8 }] },
    owner_facts: [{ topic: "Leagues", meaning: "NFL, NBA, MLB and NHL", quote: "all 4 major leagues in America", msg: 2 }],
    messages: [{ text: "Daily picks for every major league", paraphrase: true, quote: "daily picks for all 4 major leagues", msg: 2 }],
    plans: [{ name: "Weekly", price: "$49", length: "7 days", highlight: false, highlight_quote: null, quote: "Weekly $49 for 7 days", msg: 6 }],
    look_quotes: { mode: { quote: "Dark", msg: 8 }, accent: { quote: "orange", msg: 8 }, tone: { quote: "Bold is fine", msg: 8 } },
    references: [],
    direction: { pairing: { value: "Heavy geometric", why: "Bold." }, motif: { value: "Stack", why: "A feed of picks." }, hero_kind: { value: "fragment", why: "Pick cards." }, signatures: [{ value: "status-chips", why: "Chips." }] },
    sample_card: { item: "one pick", fields: [{ label: "League", filler: "League" }, { label: "Line", filler: "0.0" }] },
    care: [{ flag: "Betting", rule: "No win claims" }],
    placeholders: [{ slot: "notice", what: "Age and responsible-gambling notice" }],
    other_proposals: [],
    gaps: [],
  };
}
const badAnswer = () => ({ ...goodAnswer(), audience: [{ value: "everyone", quote: "every sports fan in America", msg: 4 }] });

/** A stand-in model that counts its calls. */
function model(answer: () => unknown, opts: { throws?: boolean; hang?: boolean } = {}): { call: ToolCall; calls: () => number } {
  let n = 0;
  const call: ToolCall = async () => {
    n++;
    if (opts.hang) return new Promise(() => {});
    if (opts.throws) throw new Error("Anthropic 529: overloaded");
    return { toolUse: { id: `tu${n}`, input: answer() }, usage: { input: 1000, output: 2000, cacheRead: 0, cacheWrite: 3000 } };
  };
  return { call, calls: () => n };
}

/** One project row in memory, with the queries the store and the review step make. */
function fakeDb(state: Record<string, unknown> = { phase: "summary", msgs: MSGS, site: { brief: BRIEF } }) {
  const row = { state: JSON.parse(JSON.stringify(state)), archived_at: null as string | null, design_brief: null as SavedDesignBrief | null };
  const usage: unknown[][] = [];
  const db: Db = {
    async query(text, params = []) {
      if (text.startsWith("SELECT state, archived_at FROM projects")) return { rows: [{ state: row.state, archived_at: row.archived_at }] };
      if (text.startsWith("SELECT design_brief FROM projects")) return { rows: [{ design_brief: row.design_brief ? JSON.parse(JSON.stringify(row.design_brief)) : null }] };
      if (text.startsWith("UPDATE projects SET design_brief")) {
        const expected = String(params[2] ?? "");
        if ((row.design_brief?.token ?? "") !== expected) return { rows: [] };
        row.design_brief = JSON.parse(String(params[1]));
        return { rows: [{ id: params[0] }] };
      }
      if (text.startsWith("INSERT INTO usage")) {
        usage.push(params);
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text.slice(0, 60)}`);
    },
  };
  return { db, row, usage };
}

const env = {} as NodeJS.ProcessEnv;
const noWait = async () => {};
const input = (msgs: unknown = MSGS, brief: Record<string, unknown> = BRIEF) => {
  const i = designBriefInput(msgs, brief);
  return { messages: i.messages, brief, fingerprint: i.fingerprint, upToMsg: i.upToMsg };
};

// ---- the fingerprint ----

await test("the fingerprint covers the owner's messages and the brief, not Scout's lines or key order", () => {
  const a = input();
  assert.equal(a.upToMsg, 8);
  const scoutChanged = MSGS.map((m) => (m.kind === "bot" ? { ...m, text: `${m.text} (reworded)` } : m));
  assert.equal(input(scoutChanged).fingerprint, a.fingerprint, "Scout's wording does not count");
  const reordered = { blocks: [], look: { accent: "#F97316", tone: "bold", mode: "dark" }, site: { kind: "product-showcase", name: "PickPal" } };
  assert.equal(input(MSGS, reordered).fingerprint, a.fingerprint, "key order does not count");
  assert.notEqual(input(MSGS, { ...BRIEF, look: { ...BRIEF.look, accent: "#22C55E" } }).fingerprint, a.fingerprint, "a changed brief counts");
  const edited = MSGS.map((m) => (m.id === 6 ? { ...m, text: "Weekly $59 for 7 days" } : m));
  assert.notEqual(input(edited).fingerprint, a.fingerprint, "a changed owner message counts");
});

await test("an owner message after review does not make the saved brief stale; a changed brief does", () => {
  const a = input();
  const saved: SavedDesignBrief = { v: 1, fingerprint: a.fingerprint, upToMsg: a.upToMsg, status: "done", token: "t", by: "review", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), reason: null, result: { skipped: null, fingerprint: a.fingerprint, passed: true, markdown: "# x\n" } as any };
  const later = [...MSGS, { id: 10, kind: "user", text: "thanks, looks great" }];
  assert.equal(decide(saved, input(later), Date.now()), "use");
  assert.equal(decide(saved, input(later, { ...BRIEF, look: { ...BRIEF.look, tone: "calm" } }), Date.now()), "write");
});

// ---- what a build does with what is saved ----

await test("a build uses a brief that passed, waits for one being written, and writes when it failed, is stale or differs", () => {
  const a = input();
  const now = Date.now();
  const base: SavedDesignBrief = { v: 1, fingerprint: a.fingerprint, upToMsg: a.upToMsg, status: "done", token: "t", by: "review", startedAt: new Date(now).toISOString(), finishedAt: null, reason: null, result: { skipped: null, passed: true, markdown: "# x\n" } as any };
  assert.equal(decide(base, a, now), "use");
  assert.equal(decide({ ...base, result: { skipped: null, passed: false, markdown: "# x\n" } as any }, a, now), "write", "a brief that did not pass is never used");
  assert.equal(decide({ ...base, status: "failed" }, a, now), "write");
  assert.equal(decide({ ...base, status: "writing", result: null }, a, now + 1000), "wait");
  assert.equal(decide({ ...base, status: "writing", result: null }, a, now + WRITING_STALE_MS + 1), "write", "an unfinished one older than three minutes counts as failed");
  assert.equal(decide({ ...base, fingerprint: "other" }, a, now), "write");
  assert.equal(decide(null, a, now), "write");
  assert.equal(shouldStartAtReview({ ...base, status: "failed" }, a, now), false, "review does not pay twice for the same chat and brief");
  assert.equal(shouldStartAtReview({ ...base, status: "writing" }, a, now + WRITING_STALE_MS + 1), true);
});

// ---- at review ----

await test("review writes the brief on the project and logs its cost; the owner's state and chat do not change", async () => {
  const { db, row, usage } = fakeDb();
  const before = JSON.stringify(row.state);
  const m = model(goodAnswer);
  const r = await designBriefAtReview({ db, projectId: "p1", env, call: m.call, sleep: noWait });
  assert.deepEqual(r, { ran: true, status: "done", costUsd: 0.059 });
  assert.equal(row.design_brief?.status, "done");
  assert.equal(row.design_brief?.by, "review");
  assert.equal(row.design_brief?.upToMsg, 8);
  assert.equal(row.design_brief?.fingerprint, input().fingerprint);
  assert.match((row.design_brief?.result as any).markdown, /^# Design brief: PickPal/);
  assert.equal(JSON.stringify(row.state), before, "nothing the owner sees changed");
  assert.equal(usage.length, 1);
  assert.equal(usage[0][1], "claude-opus-5-5");
  const again = await designBriefAtReview({ db, projectId: "p1", env, call: m.call, sleep: noWait });
  assert.deepEqual(again, { ran: false, why: "already done for this chat and brief" });
  assert.equal(m.calls(), 1, "the same chat and brief are never written twice");
});

await test("review draws the style tile from a brief that passed, and keeps the old tile while a new brief is written", async () => {
  const { db, row } = fakeDb();
  const m = model(goodAnswer);
  await designBriefAtReview({ db, projectId: "p1", env, call: m.call, sleep: noWait });
  const tile = row.design_brief?.tile;
  assert.ok(tile?.html?.includes("PickPal"));
  assert.equal(tile?.checks?.checks.length, 5);
  assert.equal(tile?.error, null);
  // The owner changes the brief: while the new brief is written the old tile stays, and the new one replaces it after.
  row.state.site.brief = { ...BRIEF, look: { ...BRIEF.look, tone: "calm" } };
  let during: unknown;
  await designBriefAtReview({ db, projectId: "p1", env, call: async (...a) => { during = row.design_brief?.tile?.fingerprint; return m.call(...a); }, sleep: noWait });
  assert.equal(during, tile?.fingerprint, "the old tile was kept while writing");
  assert.notEqual(row.design_brief?.tile?.fingerprint, tile?.fingerprint, "a new tile for the new brief");
});

await test("edits that come quickly write only the latest brief", async () => {
  const { db, row } = fakeDb();
  const m = model(goodAnswer);
  // The owner changes the brief while the first request waits for edits to settle.
  const first = designBriefAtReview({ db, projectId: "p1", env, call: m.call, sleep: async () => { row.state.site.brief = { ...BRIEF, look: { ...BRIEF.look, tone: "playful" } }; } });
  assert.deepEqual(await first, { ran: false, why: "the brief changed again; the newer request writes it" });
  assert.equal(m.calls(), 0);
  const second = await designBriefAtReview({ db, projectId: "p1", env, call: m.call, sleep: noWait });
  assert.equal(second.ran, true);
  assert.equal(m.calls(), 1);
});

await test("two requests at the same moment write once", async () => {
  const { db } = fakeDb();
  const m = model(goodAnswer);
  const [a, b] = await Promise.all([
    designBriefAtReview({ db, projectId: "p1", env, call: m.call, sleep: noWait }),
    designBriefAtReview({ db, projectId: "p1", env, call: m.call, sleep: noWait }),
  ]);
  assert.equal([a, b].filter((x) => x.ran).length, 1, JSON.stringify([a, b]));
  assert.equal(m.calls(), 1);
});

await test("a failure at review is saved quietly as failed, with the reason, and never throws", async () => {
  // Fails its checks twice.
  const bad = fakeDb();
  const rb = await designBriefAtReview({ db: bad.db, projectId: "p1", env, call: model(badAnswer).call, sleep: noWait });
  assert.deepEqual(rb, { ran: true, status: "failed", costUsd: 0.118 });
  assert.match(bad.row.design_brief?.reason ?? "", /audience\[0\]: not in an owner message/);
  // The model errors.
  const err = fakeDb();
  const re = await designBriefAtReview({ db: err.db, projectId: "p1", env, call: model(goodAnswer, { throws: true }).call, sleep: noWait });
  assert.equal(re.ran && re.status, "failed");
  assert.match(err.row.design_brief?.reason ?? "", /overloaded/);
  // A time-out.
  const slow = fakeDb();
  const rs = await designBriefAtReview({ db: slow.db, projectId: "p1", env, call: model(goodAnswer, { hang: true }).call, sleep: noWait, limitMs: 30 });
  assert.equal(rs.ran && rs.status, "failed");
  assert.match(slow.row.design_brief?.reason ?? "", /timed out: took longer than 30 ms, so it will be written at build start instead/);
  // No key.
  const nokey = fakeDb();
  const rk = await designBriefAtReview({ db: nokey.db, projectId: "p1", env: {} as NodeJS.ProcessEnv, sleep: noWait });
  assert.equal(rk.ran && rk.status, "failed");
  assert.equal(nokey.row.design_brief?.reason, "no ANTHROPIC_API_KEY");
  // The database fails mid-way: no throw.
  const broken: Db = { query: async () => { throw new Error("connection lost"); } };
  const rx = await designBriefAtReview({ db: broken, projectId: "p1", env, call: model(goodAnswer).call, sleep: noWait });
  assert.deepEqual(rx, { ran: false, why: "error: connection lost" });
  for (const x of [bad, err, slow, nokey]) assert.equal(JSON.stringify(x.row.state.msgs), JSON.stringify(MSGS), "no message in the chat");
});

await test("review writes nothing outside review, for other packs, for archived projects or when switched off", async () => {
  const m = model(goodAnswer);
  const intake = fakeDb({ phase: "intake", msgs: MSGS, site: { brief: BRIEF } });
  assert.equal((await designBriefAtReview({ db: intake.db, projectId: "p1", env, call: m.call, sleep: noWait })).ran, false);
  const waitlist = fakeDb({ phase: "summary", msgs: MSGS, site: { brief: { site: { name: "X", kind: "waitlist" } } } });
  assert.equal((await designBriefAtReview({ db: waitlist.db, projectId: "p1", env, call: m.call, sleep: noWait })).ran, false);
  const archived = fakeDb();
  archived.row.archived_at = "2026-11-18T00:00:00Z";
  assert.equal((await designBriefAtReview({ db: archived.db, projectId: "p1", env, call: m.call, sleep: noWait })).ran, false);
  const off = fakeDb();
  assert.match(JSON.stringify(await designBriefAtReview({ db: off.db, projectId: "p1", env: { DESIGN_BRIEF_AT_REVIEW: "off" } as NodeJS.ProcessEnv, call: m.call, sleep: noWait })), /switched off/);
  assert.equal(m.calls(), 0);
});

// ---- at build start ----

await test("a build waits for a brief still being written at review, then uses it", async () => {
  const { db, row } = fakeDb();
  const a = input();
  row.design_brief = { v: 1, fingerprint: a.fingerprint, upToMsg: a.upToMsg, status: "writing", token: "w1", by: "review", startedAt: new Date().toISOString(), finishedAt: null, reason: null, result: null };
  let polls = 0;
  const r = await savedBriefForBuild({
    db, projectId: "p1", input: a, waitMs: 60_000,
    sleep: async () => {
      polls++;
      if (polls === 2) row.design_brief = { ...row.design_brief!, status: "done", token: "w2", result: { skipped: null, passed: true, markdown: "# ok\n" } as any };
    },
  });
  assert.equal(r.use?.status, "done");
  assert.equal(polls, 2);
  const gaveUp = await savedBriefForBuild({ db, projectId: "p1", input: input(MSGS, { ...BRIEF, look: { ...BRIEF.look, tone: "calm" } }), waitMs: 60_000, sleep: noWait });
  assert.equal(gaveUp.use, null, "a brief made from something else is not waited for");
});

await test("the worker uses the brief from review without a model call, and says so", async () => {
  const { db } = fakeDb();
  await designBriefAtReview({ db, projectId: "p1", env, call: model(goodAnswer).call, sleep: noWait });
  const dir = await mkdtemp(path.join(os.tmpdir(), "db-store-"));
  const m = model(goodAnswer);
  const later = [...MSGS, { id: 10, kind: "user", text: "ok build it" }];
  const rec = await designBriefForBuild({ db, projectId: "p1", msgs: later, brief: BRIEF, file: path.join(dir, "x.md"), env, call: m.call, sleep: noWait });
  assert.equal(m.calls(), 0);
  assert.ok(rec.skipped === null && rec.source === "review" && rec.passedToRunner);
  assert.match(await readFile(path.join(dir, "x.md"), "utf8"), /^# Design brief: PickPal/);
});

await test("the worker writes a new brief when the one from review failed or no longer matches, and saves it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "db-store-"));
  const failedAtReview = fakeDb();
  await designBriefAtReview({ db: failedAtReview.db, projectId: "p1", env, call: model(goodAnswer, { throws: true }).call, sleep: noWait });
  const m = model(goodAnswer);
  const rec = await designBriefForBuild({ db: failedAtReview.db, projectId: "p1", msgs: MSGS, brief: BRIEF, file: path.join(dir, "a.md"), env, call: m.call, sleep: noWait });
  assert.equal(m.calls(), 1);
  assert.ok(rec.skipped === null && rec.source === "build_start" && rec.passedToRunner);
  assert.equal(failedAtReview.row.design_brief?.status, "done");
  assert.equal(failedAtReview.row.design_brief?.by, "build_start");

  const changed = fakeDb();
  await designBriefAtReview({ db: changed.db, projectId: "p1", env, call: model(goodAnswer).call, sleep: noWait });
  const m2 = model(goodAnswer);
  const newBrief = { ...BRIEF, look: { ...BRIEF.look, tone: "playful" } };
  const rec2 = await designBriefForBuild({ db: changed.db, projectId: "p1", msgs: MSGS, brief: newBrief, file: path.join(dir, "b.md"), env, call: m2.call, sleep: noWait });
  assert.equal(m2.calls(), 1, "the owner changed the brief after review");
  assert.ok(rec2.skipped === null && rec2.source === "build_start");
  assert.equal(changed.row.design_brief?.fingerprint, input(MSGS, newBrief).fingerprint);
});

await test("a build with a broken store still writes its brief", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "db-store-"));
  const broken: Db = { query: async () => { throw new Error("no column design_brief"); } };
  const m = model(goodAnswer);
  const rec = await designBriefForBuild({ db: broken, projectId: "p1", msgs: MSGS, brief: BRIEF, file: path.join(dir, "c.md"), env, call: m.call, sleep: noWait });
  assert.equal(m.calls(), 1);
  assert.ok(rec.skipped === null && rec.passedToRunner);
});

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
