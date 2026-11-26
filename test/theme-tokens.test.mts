/**
 * PR B: the shape check for the tokens a build starts from, and the worker step that picks them up. No model, no database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { designTokens } from "../src/lib/builder/design-tokens";
import { themeTokensProblem } from "../src/lib/builder/theme-tokens";
import { tileFingerprint } from "../src/lib/design-brief-store";
import { themeForBuild } from "../worker/theme-tokens";

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e instanceof Error ? e.message : e); }
}
const G = JSON.parse(readFileSync(new URL("./fixtures/gwins-design-brief.json", import.meta.url), "utf8"));
const T = designTokens(G.savedDesignBrief, G.brief);
const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v));

await test("the tokens the tile is drawn with pass the shape check, in both modes and every tone", () => {
  assert.equal(themeTokensProblem(T), null);
  for (const mode of ["light", "dark"]) for (const tone of ["calm", "bold", "playful", "serious"]) {
    const db = clone(G.savedDesignBrief);
    db.look.mode.value = mode;
    db.look.tone.value = tone;
    assert.equal(themeTokensProblem(designTokens(db, G.brief)), null, `${mode} ${tone}`);
  }
  assert.equal(themeTokensProblem({ ...clone(T), later: { sectionWidths: [1] } }), null, "a newer token set with extra fields still passes");
});

await test("a wrong shape is named", () => {
  const bad = (f: (t: any) => void) => { const t = clone(T) as any; f(t); return themeTokensProblem(t); };
  assert.equal(themeTokensProblem(null), "not an object");
  assert.equal(bad((t) => { t.version = 2; }), "version is not 1");
  assert.equal(bad((t) => { delete t.color.tint300; }), "color.tint300");
  assert.equal(bad((t) => { t.font.heading = 'Inter"; alert(1); //'; }), "font.heading", "a name that could break the theme file is refused");
  assert.equal(bad((t) => { t.font.weight.headline = 1000; }), "font.weight.headline");
  assert.equal(bad((t) => { t.type.hero = [64]; }), "type.hero");
  assert.equal(bad((t) => { t.direction.heroLayout = "left"; }), "direction.heroLayout");
  assert.equal(bad((t) => { delete t.radius; }), "radius is missing");
});

const brief = { site: { name: "PickPal", kind: "product-showcase" } };
const designBrief = { skipped: null, passedToRunner: true, json: { a: 1 } } as never;
const savedWith = (tile: unknown) => ({ v: 1, token: "t", status: "done", tile });
const goodTile = () => ({ v: 1, fingerprint: tileFingerprint({ a: 1 } as never, brief), renderedAt: "2026-11-26T00:00:00Z", html: "<p>", tokens: T, checks: null, error: null });
const dbWith = (saved: unknown) => ({ query: async () => ({ rows: [{ design_brief: saved }] }) });
const run = async (opts: Partial<Parameters<typeof themeForBuild>[0]> = {}) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "theme-"));
  const file = path.join(dir, "x.theme.json");
  const r = await themeForBuild({ db: dbWith(savedWith(goodTile())), projectId: "p1", designBrief, brief, file, env: {} as NodeJS.ProcessEnv, log: () => {}, ...opts });
  return { r, file };
};

await test("tokens present: written for the runner, with the tile's fingerprint", async () => {
  const { r, file } = await run();
  assert.equal(r.used, true);
  assert.equal(r.file, file);
  assert.equal(r.fingerprint, goodTile().fingerprint);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), T);
});

await test("each reason to go without tokens is named, and nothing is written", async () => {
  const cases: [Partial<Parameters<typeof themeForBuild>[0]>, RegExp][] = [
    [{ env: { WORKER_THEME_TOKENS: "off" } as NodeJS.ProcessEnv }, /WORKER_THEME_TOKENS=off/],
    [{ designBrief: undefined }, /no design brief went to the runner/],
    [{ designBrief: { skipped: "switched off", passedToRunner: false } as never }, /no design brief went to the runner/],
    [{ designBrief: { skipped: null, passedToRunner: false, json: { a: 1 } } as never }, /no design brief went to the runner/],
    [{ db: dbWith(null) }, /no saved design brief/],
    [{ db: dbWith(savedWith(undefined)) }, /no Visual design tile/],
    [{ db: dbWith(savedWith({ ...goodTile(), fingerprint: "other" })) }, /fingerprint mismatch/],
    [{ brief: { ...brief, look: { accent: "#000000" } } }, /fingerprint mismatch/],
    [{ db: dbWith(savedWith({ ...goodTile(), tokens: { version: 1 } })) }, /wrong shape \(mode/],
  ];
  for (const [opts, why] of cases) {
    const { r, file } = await run(opts);
    assert.equal(r.used, false, String(why));
    assert.match(r.why ?? "", why);
    await assert.rejects(() => readFile(file), "nothing is written");
  }
});

await test("an error is logged and the build goes on without tokens", async () => {
  const lines: string[] = [];
  const { r } = await run({ db: { query: async () => { throw new Error("connection lost"); } }, log: (l) => lines.push(l) });
  assert.equal(r.used, false);
  assert.match(r.why ?? "", /error: connection lost/);
  assert.match(lines.join("\n"), /theme tokens not used.*connection lost/);
  const w = await run({ file: "/nonexistent-folder/x.theme.json", log: () => {} });
  assert.equal(w.r.used, false, "a file that cannot be written means no tokens");
});

await test("the runner's shape check is the same as this one (when the runner sits next to the Builder)", async () => {
  const runnerFile = new URL("../../appnomics-runner/src/theme-tokens.ts", import.meta.url);
  let runner: string;
  try { runner = readFileSync(runnerFile, "utf8"); } catch { console.log("  (runner not found next to the Builder: skipped)"); return; }
  const mine = readFileSync(new URL("../src/lib/builder/theme-tokens.ts", import.meta.url), "utf8");
  const part = (src: string, from: string, to: string) => { const i = src.indexOf(from); const j = src.indexOf(to, i); assert.ok(i > -1 && j > i, from); return src.slice(i, j + to.length); };
  for (const [from, to] of [["const HEX", "const numOrPair = (v: unknown) => isNum(v) || isPair(v);"], ["export function themeTokensProblem", "\n  return null;\n}"]]) {
    if (!runner.includes(from)) { console.log("  (runner has no theme tokens yet: skipped)"); return; }
    assert.equal(part(runner, from, to), part(mine, from, to), `${from} differs between the Builder and the runner`);
  }
});

if (failed) process.exit(1);
