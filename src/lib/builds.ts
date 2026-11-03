import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildLimitFor } from "@/lib/access-code";

/** How many site builds a person has used and how many they may use. limit 0 means no cap. Failed builds and publish retries do not count. */
export async function buildAllowance(userId: string, email: string | null) {
  // A person's access code can carry its own limit, which replaces the global one (SITE_BUILD_LIMIT; 0 or unset means no cap).
  const limit = (await buildLimitFor(userId)) ?? Number(process.env.SITE_BUILD_LIMIT ?? 0);
  const exempt = (process.env.SITE_BUILD_LIMIT_EXEMPT ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes((email ?? "").toLowerCase());
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.jobs)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.jobs.projectId))
    .where(and(eq(schema.projects.ownerId, userId), eq(schema.jobs.type, "site_build"), ne(schema.jobs.status, "failed")));
  return { limit: exempt ? 0 : limit, used: n, exempt };
}
