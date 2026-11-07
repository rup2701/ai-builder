import assert from "node:assert/strict";
import { changeLimit, changesUsed, cleanInstruction, isOpen, needsAnswer, siteIsLive, changeMsgs, MAX_REVISIONS } from "../src/lib/builder/site-change";
import { instructionFor, isPlainSummary, lastFinal, ownerSummary, parseFinal, patchChangeMsg } from "../worker/site-change";
import { initialState } from "../src/lib/workspace/state";
import type { WorkspaceState } from "../src/lib/workspace/types";

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message : e}`); }
}

const live = (): WorkspaceState => ({
  ...initialState(),
  phase: "summary",
  site: { brief: {}, build: { stage: 6, startedAt: "t", files: 3, finishedAt: "t2", url: "https://x.appnomics.live", runDir: "/data/runs/x" } },
} as WorkspaceState);

test("parseFinal splits the sentence from the VIEW line", () => {
  const r = parseFinal("Step 3 is now a wide panel with the full JSON.\nVIEW: #how-it-works");
  assert.equal(r.summary, "Step 3 is now a wide panel with the full JSON.");
  assert.equal(r.anchor, "how-it-works");
});
test("parseFinal never ends mid-sentence when the reply is long", () => {
  const long = `${"A full sentence here. ".repeat(40)}This last one runs past the limit and would be cut in the middle of a`;
  const s = parseFinal(`${long}\nVIEW: top`).summary;
  assert.ok(s.length <= 500);
  assert.ok(s.endsWith("."));
});

test("ownerSummary keeps plain words and replaces technical ones with the plan lines", () => {
  const plain = "The benefits are now four rows with an image each.";
  assert.equal(ownerSummary(plain, ["Something else"]), plain);
  const technical = "The page background now has a 16px dot grid (#e5e7eb). specs/look.md is read-only, so I ran `npm run build`.";
  assert.equal(isPlainSummary(technical), false);
  assert.equal(ownerSummary(technical, ["The page gets a soft dotted background", "Cards look like frosted glass", "A third line"]), "The page gets a soft dotted background. Cards look like frosted glass.");
  assert.equal(ownerSummary("", undefined), "The change is ready.");
});

test("parseFinal accepts VIEW: top and a missing line", () => {
  assert.equal(parseFinal("Changed the headline.\nVIEW: top").anchor, "top");
  assert.equal(parseFinal("Changed the headline.").anchor, "top");
});
test("parseFinal drops an anchor that is not a plain id", () => {
  assert.equal(parseFinal("Done.\nVIEW: #a b; rm -rf").anchor, "top");
});
test("lastFinal takes the last final line and skips broken lines", () => {
  const t = [JSON.stringify({ turn: 1, final: "first" }), JSON.stringify({ turn: 2, tool: "x" }), JSON.stringify({ turn: 3, final: "last one" }), '{"turn":4,"final":"cut'].join("\n");
  assert.equal(lastFinal(t), "last one");
  assert.equal(lastFinal(""), "");
});
test("cleanInstruction trims, keeps line breaks and removes leading dashes", () => {
  assert.equal(cleanInstruction("  --site   make the\n\n headline   shorter "), "site make the\n\nheadline shorter");
  assert.equal(cleanInstruction("1. one\n2. two\n\n\n\n3. three"), "1. one\n2. two\n\n3. three");
  assert.equal(cleanInstruction("x".repeat(2500)).length, 2000);
  assert.equal(cleanInstruction("x".repeat(1700)).length, 1700);
});
test("changeLimit reads SITE_CHANGE_LIMIT and defaults to 5", () => {
  assert.equal(changeLimit({}), 5);
  assert.equal(changeLimit({ SITE_CHANGE_LIMIT: "0" }), 0);
  assert.equal(changeLimit({ SITE_CHANGE_LIMIT: "abc" }), 5);
});
test("siteIsLive needs a finished, published build with a folder", () => {
  assert.equal(siteIsLive(live()), true);
  const s = live();
  s.site!.build!.runDir = "";
  assert.equal(siteIsLive(s), false);
  assert.equal(siteIsLive({ ...live(), phase: "build" }), false);
  const f = live();
  f.site!.build!.failedStage = 4;
  assert.equal(siteIsLive(f), false);
});
test("patchChangeMsg updates only the message for that job", () => {
  const s = live();
  s.msgs = [
    { id: 1, kind: "site_change", instruction: "a", status: "queued", jobId: "j1" },
    { id: 2, kind: "site_change", instruction: "b", status: "proposed" },
  ];
  const n = patchChangeMsg(s, "j1", { status: "done", summary: "ok" });
  const [a, b] = changeMsgs(n);
  assert.equal(a.status, "done");
  assert.equal(a.summary, "ok");
  assert.equal(b.status, "proposed");
});
test("changesUsed counts running, previewed and published changes, not failed, cancelled or removed ones", () => {
  const s = live();
  s.msgs = ["queued", "working", "review", "publishing", "done", "failed", "cancelled", "removed", "proposed"].map((status, i) => ({ id: i + 1, kind: "site_change", instruction: "x", status } as never));
  assert.equal(changesUsed(s), 5);
  assert.deepEqual(changeMsgs(s).filter(isOpen).map((m) => m.status), ["queued", "working", "publishing"]);
  assert.deepEqual(changeMsgs(s).filter(needsAnswer).map((m) => m.status), ["review"]);
});
test("instructionFor adds the owner's feedback to a revision", () => {
  assert.equal(instructionFor({ instruction: "make step 3 bigger" }), "make step 3 bigger");
  const t = instructionFor({ instruction: "make step 3 bigger", feedback: "also keep the chips" });
  assert.ok(t.startsWith("make step 3 bigger. You already made this change"));
  assert.ok(t.endsWith("also keep the chips"));
});
test("revisions are capped at three rounds", () => assert.equal(MAX_REVISIONS, 3));

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
