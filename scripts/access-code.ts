/**
 * Manage beta access codes. Run from the builder folder (it reads DATABASE_URL from .env):
 *   npm run code -- create --label philippe [--uses 1] [--builds 2] [--days 14]
 *   npm run code -- list
 *   npm run code -- revoke --label philippe      (or --hint AB12, the last four characters)
 * `create` prints the code once. Only its hash is stored, so a lost code cannot be read back: revoke it and make another.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, pool, schema } from "../src/db";
import { generateCode, hashCode } from "../src/lib/access-code";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const num = (name: string) => {
  const v = opt(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
};

async function main() {
  if (cmd === "create") {
    const label = opt("label");
    if (!label) throw new Error("create needs --label (who the code is for)");
    const maxUses = num("uses") ?? 1;
    const buildLimit = num("builds");
    const days = num("days");
    const code = generateCode(label);
    await db.insert(schema.accessCodes).values({
      codeHash: hashCode(code),
      hint: code.slice(-4),
      label,
      maxUses,
      buildLimit: buildLimit ?? null,
      expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null,
    });
    console.log(`\nAccess code for ${label}:\n\n  ${code}\n`);
    console.log(`Uses: ${maxUses}${buildLimit !== undefined ? `, site builds each: ${buildLimit}` : ", site builds: the global limit"}${days ? `, expires in ${days} days` : ""}.`);
    console.log("It is shown only now. They type it on the sign-in page the first time.");
  } else if (cmd === "list") {
    const rows = await db.select().from(schema.accessCodes).orderBy(desc(schema.accessCodes.createdAt));
    if (!rows.length) console.log("No access codes yet.");
    for (const r of rows) {
      const state = r.revokedAt ? "REVOKED" : r.expiresAt && r.expiresAt <= new Date() ? "expired" : r.uses >= r.maxUses ? "used up" : "open";
      console.log(`${r.label.padEnd(16)} ...${r.hint}  ${state.padEnd(8)} uses ${r.uses}/${r.maxUses}  builds ${r.buildLimit ?? "global"}  ${r.createdAt.toISOString().slice(0, 10)}`);
    }
  } else if (cmd === "revoke") {
    const label = opt("label");
    const hint = opt("hint");
    if (!label && !hint) throw new Error("revoke needs --label or --hint");
    const where = and(label ? eq(schema.accessCodes.label, label) : undefined, hint ? eq(schema.accessCodes.hint, hint.toUpperCase()) : undefined, isNull(schema.accessCodes.revokedAt));
    const done = await db.update(schema.accessCodes).set({ revokedAt: new Date() }).where(where).returning({ label: schema.accessCodes.label, hint: schema.accessCodes.hint });
    console.log(done.length ? `Revoked: ${done.map((d) => `${d.label} ...${d.hint}`).join(", ")}. People who joined with it can no longer use the builder.` : "No open code matched.");
  } else {
    console.log("Usage: npm run code -- create --label NAME [--uses 1] [--builds 2] [--days 14] | list | revoke --label NAME");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
