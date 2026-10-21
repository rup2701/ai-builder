import "server-only";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/db";

export type User = typeof schema.users.$inferSelect;

/** The signed-in user's row, or null. */
export async function getUser(): Promise<User | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  const [row] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  return row ?? null;
}
