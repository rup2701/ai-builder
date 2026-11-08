import assert from "node:assert/strict";
import { buildEmail, notifyBuildEnd, notifyBuildStart, projectLink, sendEmail } from "../src/lib/notify";

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message : e}`); }
}
const done = { kind: "done" as const, siteName: "Tide<well>", projectUrl: "https://b.example/projects/p1", siteUrl: "https://tidewell.appnomics.live" };

await test("the done email names the site, links the project, escapes html and carries no password", () => {
  const m = buildEmail(done);
  assert.equal(m.subject, "Tide<well> is live");
  assert.ok(m.text.includes("https://b.example/projects/p1") && m.text.includes("https://tidewell.appnomics.live"));
  assert.ok(m.html.includes("Tide&lt;well&gt;") && !m.html.includes("<well>"));
  assert.ok(!/password/i.test(m.text), "no password in the email");
});
await test("the showcase done email does not mention an owner sign-in", () => {
  const m = buildEmail({ ...done, showcase: true });
  assert.ok(!/owner|sign-in/i.test(m.text), m.text);
  assert.ok(/check before you share/i.test(m.text));
  assert.ok(/owner sign-in/i.test(buildEmail(done).text), "other sites still get the owner line");
});
await test("the started email goes to the admin only, names who started it, and skips the admin's own builds", async () => {
  const sent: { to: string[]; subject: string }[] = [];
  const f = (async (_u: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  const m = { kind: "started" as const, siteName: "Tidewell", projectUrl: "https://b.example/projects/p1", by: "guest@x.dev" };
  assert.ok(/guest@x.dev started building Tidewell/.test(buildEmail(m).text));
  await notifyBuildStart({ RESEND_API_KEY: "k" }, m, f); // no ADMIN_NOTIFY_EMAIL: nothing is sent
  assert.equal(sent.length, 0);
  await notifyBuildStart({ RESEND_API_KEY: "k", ADMIN_NOTIFY_EMAIL: "me@x.dev" }, m, f);
  assert.deepEqual(sent.map((x) => x.to), [["me@x.dev"]]);
  assert.equal(sent[0].subject, "Build started: Tidewell");
  await notifyBuildStart({ RESEND_API_KEY: "k", ADMIN_NOTIFY_EMAIL: "ME@x.dev" }, { ...m, by: "me@x.dev" }, f); // the admin's own build: skipped
  assert.equal(sent.length, 1);
});
await test("the failed email says where it stopped and which button to press", () => {
  const a = buildEmail({ kind: "failed", siteName: "T", projectUrl: "u", stageLabel: "Putting it online", retryPublish: true });
  assert.ok(a.text.includes("Putting it online") && a.text.includes("Retry publishing"));
  const b = buildEmail({ kind: "failed", siteName: "T", projectUrl: "u", stageLabel: "Testing", retryPublish: false });
  assert.ok(b.text.includes("Try again") && !b.text.includes("Retry publishing"));
});
await test("sendEmail posts to Resend with the key, sender and recipient", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  const r = await sendEmail({ RESEND_API_KEY: "k", EMAIL_FROM: "A <a@x.dev>" }, "me@x.dev", buildEmail(done), f);
  assert.equal(r.ok, true);
  assert.equal(seen!.url, "https://api.resend.com/emails");
  assert.equal((seen!.init.headers as Record<string, string>).authorization, "Bearer k");
  const body = JSON.parse(String(seen!.init.body));
  assert.deepEqual(body.to, ["me@x.dev"]);
  assert.equal(body.from, "A <a@x.dev>");
});
await test("no key, a Resend error and a network error are all reported, never thrown", async () => {
  assert.equal((await sendEmail({}, "a@b.c", buildEmail(done))).ok, false);
  const bad = (async () => new Response("domain not verified", { status: 403 })) as unknown as typeof fetch;
  const r = await sendEmail({ RESEND_API_KEY: "k" }, "a@b.c", buildEmail(done), bad);
  assert.ok(!r.ok && /403/.test(r.error!));
  const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  assert.equal((await sendEmail({ RESEND_API_KEY: "k" }, "a@b.c", buildEmail(done), down)).error, "offline");
});
await test("notifyBuildEnd does nothing without a recipient", async () => {
  let called = false;
  const f = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  await notifyBuildEnd({ RESEND_API_KEY: "k" }, undefined, done, f);
  assert.equal(called, false);
});
await test("the admin gets a copy of the end email, even when the person has no email, and never twice", async () => {
  const sent: { to: string[]; subject: string }[] = [];
  const f = (async (_u: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  const env = { RESEND_API_KEY: "k", ADMIN_NOTIFY_EMAIL: "admin@x.dev" };
  await notifyBuildEnd(env, "person@x.dev", done, f);
  assert.deepEqual(sent.map((x) => x.to), [["person@x.dev"], ["admin@x.dev"]]);
  assert.equal(sent[0].subject, "Tide<well> is live");
  assert.equal(sent[1].subject, "[copy] Tide<well> is live");
  sent.length = 0;
  await notifyBuildEnd(env, undefined, done, f); // no person email: the admin still hears about it
  assert.deepEqual(sent.map((x) => x.to), [["admin@x.dev"]]);
  sent.length = 0;
  await notifyBuildEnd(env, "ADMIN@x.dev", done, f); // the person is the admin: one email only
  assert.equal(sent.length, 1);
  sent.length = 0;
  await notifyBuildEnd({ RESEND_API_KEY: "k" }, "person@x.dev", done, f); // no admin address set
  assert.deepEqual(sent.map((x) => x.to), [["person@x.dev"]]);
});
await test("a stopped change says what happened in plain words, and only the admin copy has the detail", async () => {
  const m = { kind: "changeStopped" as const, siteName: "Tidewell", projectUrl: "https://b.example/projects/p1", cause: "system" as const, adminDetail: "job j1: EADDRINUSE" };
  const owner = buildEmail(m);
  const admin = buildEmail(m, true);
  assert.match(owner.subject, /something went wrong on our side/);
  assert.match(owner.text, /live site is unchanged/);
  assert.doesNotMatch(owner.text + owner.html, /EADDRINUSE/);
  assert.match(admin.text, /EADDRINUSE/);
  const change = buildEmail({ ...m, cause: "change" });
  assert.match(change.subject, /was not applied/);
  assert.doesNotMatch(change.text, /our side/);
  // End to end through the sender: the owner's email has no detail, the admin's copy does.
  const sent: { to: string[]; text: string }[] = [];
  const f = (async (_u: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  await notifyBuildEnd({ RESEND_API_KEY: "k", ADMIN_NOTIFY_EMAIL: "admin@x.dev" }, "person@x.dev", m, f);
  assert.equal(sent.length, 2);
  assert.doesNotMatch(sent[0].text, /EADDRINUSE/);
  assert.match(sent[1].text, /EADDRINUSE/);
});
await test("projectLink defaults to the builder address", () => {
  assert.equal(projectLink({}, "p1"), "https://builder.appnomics.dev/projects/p1");
  assert.equal(projectLink({ APP_URL: "http://x.test/" }, "p1"), "http://x.test/projects/p1");
});
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
