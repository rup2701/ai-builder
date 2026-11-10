import assert from "node:assert/strict";
import { ChangeBody } from "../src/lib/builder/change-body";

let failed = 0;
const test = (name: string, fn: () => void) => { try { fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e); } };
const id = "7b0d6c52-5a3e-4f0e-9d0a-0c9a1f6e2b11";

test("a revision keeps its revise key", () => {
  const r = ChangeBody.safeParse({ revise: 4, text: "No credit card required" });
  assert.ok(r.success && "revise" in r.data && r.data.revise === 4);
});
test("a revision keeps its pictures", () => {
  const r = ChangeBody.safeParse({ revise: 4, text: "Use this picture", assetIds: [id] });
  assert.ok(r.success && "revise" in r.data && r.data.assetIds?.[0] === id);
});
test("a plain request stays a plain request", () => {
  const r = ChangeBody.safeParse({ text: "Add a Contact page" });
  assert.ok(r.success && !("revise" in r.data));
});
test("approve, cancel, remove and undo keep their keys", () => {
  for (const k of ["confirm", "cancel", "approve", "remove", "undo"]) {
    const r = ChangeBody.safeParse({ [k]: 3 });
    assert.ok(r.success && k in r.data, k);
  }
});
test("more than three pictures are refused", () => {
  assert.equal(ChangeBody.safeParse({ text: "x", assetIds: [id, id, id, id] }).success, false);
});
if (failed) process.exit(1);
