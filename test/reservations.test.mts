import assert from "node:assert/strict";
import { checkRequest, handleReservation, hashVisitor, requestEmail, PER_VISITOR_PER_HOUR, type ReserveDeps } from "../src/lib/reservations";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e); }
}
const today = "2026-11-12";
const good = { name: "Asha", phone: "510-555-0100", day: "2026-11-20", time: "19:30", party: 4 };
const SITE = "https://bayleaf.appnomics.live";
const PID = "11111111-2222-3333-4444-555555555555";

function fake(over: Partial<ReserveDeps> = {}, counts = { project: 0, visitor: 0 }) {
  const saved: unknown[] = [], mails: { to: string; subject: string }[] = [], marked: string[] = [];
  const d: ReserveDeps = {
    salt: "s", now: () => new Date("2026-11-12T20:00:00Z"), adminCopy: "admin@example.com",
    project: async () => ({ name: "Bayleaf", ownerEmail: "owner@example.com", allowedOrigin: SITE }),
    recent: async () => counts,
    save: async (r) => { saved.push(r); return "row1"; },
    mail: async (to, m) => { mails.push({ to, subject: m.subject }); return true; },
    markEmailed: async (id) => { marked.push(id); },
    ...over,
  };
  return { d, saved, mails, marked };
}
const ctx = { origin: SITE, ip: "1.2.3.4" };

await test("a good request passes and is cleaned", () => {
  const r = checkRequest({ ...good, name: "  Asha \n Rao  ", note: "window\u0000 seat" }, today);
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.value.name, "Asha Rao"); assert.equal(r.value.note, "window seat"); assert.equal(r.value.party, 4); }
});

await test("each problem is said in the guest's words", () => {
  const e = (x: unknown) => { const r = checkRequest(x, today); assert.ok(!r.ok); return r.ok ? "" : r.error; };
  assert.match(e({ ...good, name: "" }), /your name/);
  assert.match(e({ ...good, phone: "", email: "" }), /phone number or an email/);
  assert.match(e({ ...good, phone: "12" }), /phone number or an email/);
  assert.match(e({ ...good, phone: undefined, email: "nope" }), /email/);
  assert.match(e({ ...good, day: "11/20/2026" }), /date/);
  assert.match(e({ ...good, day: "2026-02-31" }), /date/);
  assert.match(e({ ...good, day: "2026-11-01" }), /today or a later/);
  assert.match(e({ ...good, day: "2027-06-01" }), /six months/);
  assert.match(e({ ...good, time: "25:00" }), /time/);
  assert.match(e({ ...good, party: 0 }), /how many/);
  assert.match(e({ ...good, party: 40 }), /call us/);
  assert.match(e(null), /./);
});

await test("an email alone is enough, and so is a phone alone", () => {
  assert.ok(checkRequest({ ...good, phone: undefined, email: "a@b.co" }, today).ok);
  assert.ok(checkRequest({ ...good }, today).ok);
});

await test("today is allowed, and yesterday by the server's clock (a guest in the evening)", () => {
  assert.ok(checkRequest({ ...good, day: today }, today).ok);
  assert.ok(checkRequest({ ...good, day: "2026-11-11" }, today).ok);
});

await test("a good request is saved, emailed to the owner and a copy to the admin, then marked emailed", async () => {
  const f = fake();
  const r = await handleReservation(PID, good, ctx, f.d);
  assert.equal(r.status, 200);
  assert.equal(r.origin, SITE);
  assert.equal(f.saved.length, 1);
  assert.deepEqual(f.mails.map((m) => m.to), ["owner@example.com", "admin@example.com"]);
  assert.match(f.mails[0].subject, /Table request for Bayleaf: 4 on 2026-11-20 at 19:30/);
  assert.match(f.mails[1].subject, /^\[copy\]/);
  assert.deepEqual(f.marked, ["row1"]);
});

await test("a failed email never loses the request, and it is not marked emailed", async () => {
  const f = fake({ mail: async () => { throw new Error("down"); } });
  const r = await handleReservation(PID, good, ctx, f.d);
  assert.equal(r.status, 200);
  assert.equal(f.saved.length, 1);
  assert.deepEqual(f.marked, []);
});

await test("another site, or no origin, is refused and nothing is saved", async () => {
  for (const origin of ["https://evil.example", null]) {
    const f = fake();
    const r = await handleReservation(PID, good, { origin, ip: "1.2.3.4" }, f.d);
    assert.equal(r.status, 403);
    assert.equal(r.origin, undefined);
    assert.equal(f.saved.length, 0);
  }
});

await test("a project that has no published site has no allowed origin", async () => {
  const f = fake({ project: async () => ({ name: "x", ownerEmail: "o@example.com", allowedOrigin: null }) });
  assert.equal((await handleReservation(PID, good, ctx, f.d)).status, 403);
});

await test("an unknown project or a malformed id is not found", async () => {
  assert.equal((await handleReservation(PID, good, ctx, fake({ project: async () => null }).d)).status, 404);
  assert.equal((await handleReservation("not-a-uuid", good, ctx, fake().d)).status, 404);
});

await test("a filled hidden box looks like success but saves and sends nothing", async () => {
  const f = fake();
  const r = await handleReservation(PID, { ...good, website: "http://spam.example" }, ctx, f.d);
  assert.equal(r.status, 200);
  assert.equal(f.saved.length, 0);
  assert.equal(f.mails.length, 0);
});

await test("too many from one visitor, or for one project, is turned away politely", async () => {
  const a = fake({}, { project: 0, visitor: PER_VISITOR_PER_HOUR });
  const r = await handleReservation(PID, good, ctx, a.d);
  assert.equal(r.status, 429);
  assert.match(r.body.error!, /call the restaurant/);
  assert.equal(a.saved.length, 0);
  assert.equal((await handleReservation(PID, good, ctx, fake({}, { project: 30, visitor: 0 }).d)).status, 429);
});

await test("an invalid request is 422 with the reason, not saved", async () => {
  const f = fake();
  const r = await handleReservation(PID, { ...good, party: 0 }, ctx, f.d);
  assert.equal(r.status, 422);
  assert.equal(f.saved.length, 0);
});

await test("the visitor is stored only as a salted hash", () => {
  const h = hashVisitor("1.2.3.4", "s");
  assert.ok(!h.includes("1.2.3.4") && h.length === 32);
  assert.notEqual(h, hashVisitor("1.2.3.4", "t"));
});

await test("the owner's email keeps the guest's words escaped and says it is a request", () => {
  const m = requestEmail("Bay <b>", { name: "<script>x</script>", phone: "510-555-0100", day: "2026-11-20", time: "19:30", party: 2, note: "a & b" } as never);
  assert.ok(!m.html.includes("<script>"));
  assert.ok(m.html.includes("&lt;script&gt;"));
  assert.match(m.text, /not a booking/);
  assert.match(m.text, /Phone: 510-555-0100/);
});

if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log("all passed");
