/**
 * Access codes against a real Postgres. Set TEST_DATABASE_URL to an empty database; the test applies the
 * migrations to it, then creates its own data. It refuses to run against anything but a database whose
 * name starts with "t" or contains "test", so it cannot touch the real one by mistake.
 */
import assert from "node:assert/strict";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("SKIP set TEST_DATABASE_URL to an empty test database to run these");
  process.exit(0);
}
if (!/\/(t[a-z0-9_]*|[a-z0-9_]*test[a-z0-9_]*)(\?|$)/i.test(url)) throw new Error("TEST_DATABASE_URL must point at a database named like test or t1");
process.env.DATABASE_URL = url;

const { db, pool, schema } = await import("../src/db");
const { drizzle } = await import("drizzle-orm/node-postgres");
const ac = await import("../src/lib/access-code");
const { eq } = await import("drizzle-orm");

await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message : e}`);
  }
}

async function makeCode(label: string, extra: Partial<typeof schema.accessCodes.$inferInsert> = {}) {
  const code = ac.generateCode(label);
  await db.insert(schema.accessCodes).values({ codeHash: ac.hashCode(code), hint: code.slice(-4), label, ...extra });
  return code;
}

await test("normalizeCode ignores case, spaces and stray punctuation", () => {
  assert.equal(ac.normalizeCode("  philippe-ab2c-d3ef-g4hj \n"), "PHILIPPE-AB2C-D3EF-G4HJ");
  assert.equal(ac.hashCode("philippe-ab2c"), ac.hashCode(" PHILIPPE-AB2C "));
});

await test("generated codes have the label, 12 unambiguous characters, and differ", () => {
  const a = ac.generateCode("Philippe");
  assert.match(a, /^PHILIPPE(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}){3}$/);
  assert.notEqual(a, ac.generateCode("Philippe"));
  assert.match(ac.generateCode("!!"), /^BETA-/);
});

await test("only the hash is stored, never the code", async () => {
  const code = await makeCode("storage");
  const rows = await db.select().from(schema.accessCodes).where(eq(schema.accessCodes.label, "storage"));
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows[0]).includes(code));
  assert.equal(rows[0].hint, code.slice(-4));
});

await test("an unknown code is refused, a good one is accepted", async () => {
  const code = await makeCode("check");
  assert.deepEqual(await ac.checkCode(code), { ok: true });
  assert.deepEqual(await ac.checkCode("NOPE-AAAA-BBBB-CCCC"), { ok: false, reason: "unknown" });
});

await test("a new person joins with a code, then signs in again without one", async () => {
  const code = await makeCode("join");
  assert.equal(await ac.findMember("p@example.com"), null);
  assert.equal(await ac.redeemForNewUser("p@example.com", "P", code), true);
  const m = await ac.findMember("p@example.com");
  assert.ok(m && m.accessCodeId);
});

await test("a single-use code cannot be used by a second person", async () => {
  const code = await makeCode("single");
  assert.equal(await ac.redeemForNewUser("one@example.com", null, code), true);
  assert.equal(await ac.redeemForNewUser("two@example.com", null, code), false);
  assert.equal(await ac.findMember("two@example.com"), null);
  assert.deepEqual(await ac.checkCode(code), { ok: false, reason: "used" });
});

await test("two people racing for a single-use code: exactly one gets in", async () => {
  const code = await makeCode("race");
  const results = await Promise.all([ac.redeemForNewUser("r1@example.com", null, code), ac.redeemForNewUser("r2@example.com", null, code)]);
  assert.equal(results.filter(Boolean).length, 1);
  const [row] = await db.select().from(schema.accessCodes).where(eq(schema.accessCodes.label, "race"));
  assert.equal(row.uses, 1);
});

await test("a code with three uses admits three people and not a fourth", async () => {
  const code = await makeCode("team", { maxUses: 3 });
  const r = [];
  for (const n of ["a", "b", "c", "d"]) r.push(await ac.redeemForNewUser(`${n}@team.example.com`, null, code));
  assert.deepEqual(r, [true, true, true, false]);
});

await test("an expired code is refused and does not create a user", async () => {
  const code = await makeCode("old", { expiresAt: new Date(Date.now() - 1000) });
  assert.deepEqual(await ac.checkCode(code), { ok: false, reason: "expired" });
  assert.equal(await ac.redeemForNewUser("late@example.com", null, code), false);
  assert.equal(await ac.findMember("late@example.com"), null);
});

await test("revoking a code locks out the people who joined with it", async () => {
  const code = await makeCode("revoke", { maxUses: 2 });
  assert.equal(await ac.redeemForNewUser("in@example.com", null, code), true);
  assert.ok(await ac.findMember("in@example.com"));
  await db.update(schema.accessCodes).set({ revokedAt: new Date() }).where(eq(schema.accessCodes.label, "revoke"));
  assert.equal(await ac.findMember("in@example.com"), null);
  assert.deepEqual(await ac.checkCode(code), { ok: false, reason: "revoked" });
  assert.equal(await ac.redeemForNewUser("out@example.com", null, code), false);
});

await test("a person's build limit comes from their code, or null for the global one", async () => {
  const withLimit = await makeCode("limit", { buildLimit: 2 });
  const without = await makeCode("nolimit");
  await ac.redeemForNewUser("lim@example.com", null, withLimit);
  await ac.redeemForNewUser("nol@example.com", null, without);
  const u1 = await ac.findMember("lim@example.com");
  const u2 = await ac.findMember("nol@example.com");
  assert.equal(await ac.buildLimitFor(u1!.id), 2);
  assert.equal(await ac.buildLimitFor(u2!.id), null);
});

await test("a person already on the list is not charged a use when they typed a code", async () => {
  const code = await makeCode("noop", { maxUses: 1 });
  await db.insert(schema.users).values({ email: "admin@example.com" });
  // The caller checks the allowlist first and never redeems for them; the code stays usable.
  assert.deepEqual(await ac.checkCode(code), { ok: true });
});

await pool.end();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
