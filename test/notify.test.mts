import assert from "node:assert/strict";
import { buildEmail, notifyBuildEnd, projectLink, sendEmail } from "../src/lib/notify";

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
await test("projectLink defaults to the builder address", () => {
  assert.equal(projectLink({}, "p1"), "https://builder.appnomics.dev/projects/p1");
  assert.equal(projectLink({ APP_URL: "http://x.test/" }, "p1"), "http://x.test/projects/p1");
});
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
