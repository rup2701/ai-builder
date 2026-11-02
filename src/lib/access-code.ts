import { createHash, randomInt } from "node:crypto";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Access codes for the beta. A code is handed to one person (or a few). They type it on the sign-in page
 * the first time; after that their Google account is enough. Revoking a code locks out the people who
 * joined with it. ALLOWED_EMAILS still works and is for you.
 */

export const ACCESS_COOKIE = "access_code";

// No I, L, O, 0 or 1: a code is read aloud and typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Case, spaces and stray punctuation do not matter when typing a code. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 64);
}

export const hashCode = (code: string) => createHash("sha256").update(normalizeCode(code)).digest("hex");

/** LABEL-XXXX-XXXX-XXXX: the label is for people, the 12 random characters (about 60 bits) are the secret. */
export function generateCode(label: string): string {
  const slug = label.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "BETA";
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${slug}-${group()}-${group()}-${group()}`;
}

type Reason = "unknown" | "used" | "expired" | "revoked";

/** Whether a code can be used right now. Reads only; nothing is consumed. */
export async function checkCode(raw: string): Promise<{ ok: true } | { ok: false; reason: Reason }> {
  const [row] = await db.select().from(schema.accessCodes).where(eq(schema.accessCodes.codeHash, hashCode(raw))).limit(1);
  if (!row) return { ok: false, reason: "unknown" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt && row.expiresAt <= new Date()) return { ok: false, reason: "expired" };
  if (row.uses >= row.maxUses) return { ok: false, reason: "used" };
  return { ok: true };
}

/**
 * The user for this email if they may sign in without a code: they joined with a code that has not been revoked.
 * People on ALLOWED_EMAILS are handled by the caller.
 */
export async function findMember(email: string) {
  const [row] = await db
    .select({ user: schema.users, revokedAt: schema.accessCodes.revokedAt })
    .from(schema.users)
    .innerJoin(schema.accessCodes, eq(schema.accessCodes.id, schema.users.accessCodeId))
    .where(eq(schema.users.email, email))
    .limit(1);
  return row && !row.revokedAt ? row.user : null;
}

/**
 * A new person joins with a code. One transaction: the use is counted and the user is created, or neither happens.
 * Returns false when the code cannot be used (unknown, used up, expired, revoked).
 */
export async function redeemForNewUser(email: string, name: string | null, raw: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(schema.accessCodes)
      .set({ uses: sql`${schema.accessCodes.uses} + 1` })
      .where(
        and(
          eq(schema.accessCodes.codeHash, hashCode(raw)),
          isNull(schema.accessCodes.revokedAt),
          or(isNull(schema.accessCodes.expiresAt), gt(schema.accessCodes.expiresAt, new Date())),
          lt(schema.accessCodes.uses, schema.accessCodes.maxUses),
        ),
      )
      .returning({ id: schema.accessCodes.id });
    if (!claimed) return false;
    await tx
      .insert(schema.users)
      .values({ email, name, accessCodeId: claimed.id })
      .onConflictDoUpdate({ target: schema.users.email, set: { accessCodeId: claimed.id } });
    return true;
  });
}

/** The build limit for this person's code, or null when none is set (then SITE_BUILD_LIMIT applies). */
export async function buildLimitFor(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ limit: schema.accessCodes.buildLimit })
    .from(schema.users)
    .innerJoin(schema.accessCodes, eq(schema.accessCodes.id, schema.users.accessCodeId))
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.limit ?? null;
}
