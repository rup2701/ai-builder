/**
 * The style tile saved with the design brief (APP-42 step 3): drawn when a brief passes, a fingerprint that marks it stale
 * when the brief or the design brief changes, a failed draw that never fails the brief, and the Render tile action.
 * The project row lives in memory. Uses the saved GWins project (test/fixtures/gwins-design-brief.json).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DesignBrief } from "../src/lib/builder/design-brief";
import { drawTile, renderTileFor, tileFingerprint, tileState, withTile, type Db, type SavedDesignBrief } from "../src/lib/design-brief-store";
import { isAdmin } from "../src/lib/admin";

const G = JSON.parse(readFileSync(new URL("./fixtures/gwins-design-brief.json", import.meta.url), "utf8")) as { brief: Record<string, any>; savedDesignBrief: DesignBrief };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const AT = new Date("2026-11-19T12:00:00Z");
let n = 0;
const ok = (name: string) => console.log("PASS", ++n, name);

const saved = (over: Partial<SavedDesignBrief> = {}): SavedDesignBrief => ({
  v: 1, fingerprint: "f", upToMsg: 16, status: "done", token: "t1", by: "review", startedAt: AT.toISOString(), finishedAt: AT.toISOString(), reason: null,
  result: { skipped: null, fingerprint: "f", passed: true, markdown: "# x\n", json: clone(G.savedDesignBrief) } as any,
  ...over,
});

// 1. A brief that passed gets a tile; one that failed or is still writing does not.
{
  const s = withTile(saved(), G.brief, AT);
  assert.ok(s.tile?.html?.startsWith("<!doctype html>"));
  assert.equal(s.tile?.checks?.ok, true);
  assert.equal(s.tile?.fingerprint, tileFingerprint(G.savedDesignBrief, G.brief));
  assert.equal(withTile(saved({ status: "failed" }), G.brief, AT).tile, undefined);
  assert.equal(withTile(saved({ status: "writing", result: null }), G.brief, AT).tile, undefined);
  assert.equal(withTile(saved({ result: { skipped: null, passed: false, json: G.savedDesignBrief } as any }), G.brief, AT).tile, undefined);
  ok("a brief that passed gets its tile; a failed or unfinished one does not");
}

// 2. Fresh until the brief or the design brief changes; stale while a newer brief is written or after it failed.
{
  const s = withTile(saved(), G.brief, AT);
  assert.deepEqual(tileState(s, G.brief), { kind: "tile", tile: s.tile, stale: false, why: null });
  const edited = clone(G.brief);
  edited.look.accent = "#F97316";
  assert.equal((tileState(s, edited) as any).stale, true, "a changed brief");
  const newer = clone(s);
  (newer.result as any).json.direction.motif.value = "Board";
  assert.equal((tileState(newer, G.brief) as any).stale, true, "a changed design brief");
  assert.match((tileState({ ...s, status: "writing", result: null }, G.brief) as any).why, /being written/);
  assert.equal((tileState({ ...s, status: "failed" }, G.brief) as any).stale, true);
  assert.equal(tileState(null, G.brief).kind, "none");
  assert.match((tileState(saved(), G.brief) as any).why, /Render it/, "a brief saved before tiles existed");
  ok("the fingerprint marks a tile stale when what it was drawn from changes");
}

// 3. A failed draw is kept on the tile and never throws.
{
  const broken = clone(G.savedDesignBrief) as any;
  broken.direction = null;
  const t = drawTile(broken, G.brief, AT);
  assert.equal(t.html, null);
  assert.ok(t.error);
  ok("a failed draw is kept as the tile's error, never thrown");
}

// 4. Render tile: draws from the saved brief and saves with a compare-and-set; nothing to draw is said plainly.
{
  const row = { design_brief: saved() as SavedDesignBrief | null };
  const db: Db = {
    async query(text, params = []) {
      if (text.startsWith("SELECT design_brief FROM projects")) return { rows: [{ design_brief: clone(row.design_brief) }] };
      if (text.startsWith("UPDATE projects SET design_brief")) {
        if ((row.design_brief?.token ?? "") !== String(params[2] ?? "")) return { rows: [] };
        row.design_brief = JSON.parse(String(params[1]));
        return { rows: [{ id: params[0] }] };
      }
      throw new Error(`unexpected query: ${text.slice(0, 60)}`);
    },
  };
  assert.deepEqual(await renderTileFor(db, "p1", G.brief, AT), { ok: true, why: null });
  assert.equal(row.design_brief?.tile?.checks?.ok, true);
  assert.notEqual(row.design_brief?.token, "t1", "a new token, so a writer that read the old row does not overwrite it unseen");
  assert.equal(row.design_brief?.result && (row.design_brief.result as any).markdown, "# x\n", "the design brief itself is unchanged");
  row.design_brief = saved({ status: "failed" });
  assert.equal((await renderTileFor(db, "p1", G.brief, AT)).ok, false);
  ok("Render tile draws from the saved brief and saves it; with nothing to draw it says so");
}

// 5. Admins: only the emails in ADMIN_EMAILS; empty means nobody.
{
  const env = { ADMIN_EMAILS: " Owner@Example.com , second@example.com" } as NodeJS.ProcessEnv;
  assert.equal(isAdmin({ email: "owner@example.com" }, env), true);
  assert.equal(isAdmin({ email: "someone@example.com" }, env), false);
  assert.equal(isAdmin({ email: "owner@example.com" }, {} as NodeJS.ProcessEnv), false);
  assert.equal(isAdmin(null, env), false);
  ok("admins are the ADMIN_EMAILS list, and an empty list means nobody");
}

console.log(`\n${n} passed`);
