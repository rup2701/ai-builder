import "server-only";
import { eq } from "drizzle-orm";
import { allowedEmails, auth } from "@/auth";
import { findMember } from "@/lib/access-code";
import { db, schema } from "@/db";

export type User = typeof schema.users.$inferSelect;

/** The signed-in user's row, or null. */
export async function getUser(): Promise<User | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  const [row] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!row) return null;
  // Revoking a code ends the access of the people who joined with it, even with a session still open.
  if (!allowedEmails().includes(email) && !(await findMember(email))) return null;
  return row;
}
