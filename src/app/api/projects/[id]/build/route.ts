import { NextResponse } from "next/server";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import type { SiteBuild, WorkspaceState } from "@/lib/workspace/types";
import { isBuildFailedText } from "@/lib/builder/site-stages";

export const dynamic = "force-dynamic";

/** "Build my site": queues a site build for the worker. One build at a time per project. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (p.kind !== "site") return NextResponse.json({ error: "This project is not a website." }, { status: 400 });

  const state = p.state as WorkspaceState;
  if (!state.site?.brief) return NextResponse.json({ error: "Finish the interview first: there is no saved brief yet." }, { status: 409 });
  if (state.phase === "build" || state.phase === "verify") return NextResponse.json({ error: "A build is already running." }, { status: 409 });

  const running = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.projectId, p.id), eq(schema.jobs.type, "site_build"), inArray(schema.jobs.status, ["queued", "running"])))
    .limit(1);
  if (running.length) return NextResponse.json({ error: "A build is already queued." }, { status: 409 });

  // Optional cap on builds per person (SITE_BUILD_LIMIT; 0 or unset means no cap). Failed builds do not count.
  const limit = Number(process.env.SITE_BUILD_LIMIT ?? 0);
  const exempt = (process.env.SITE_BUILD_LIMIT_EXEMPT ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (limit > 0 && !exempt.includes((user.email ?? "").toLowerCase())) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.jobs)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.jobs.projectId))
      .where(and(eq(schema.projects.ownerId, user.id), eq(schema.jobs.type, "site_build"), ne(schema.jobs.status, "failed")));
    if (n >= limit) {
      return NextResponse.json({ error: `You have used your ${limit} site builds for now.` }, { status: 429 });
    }
  }

  const [job] = await db.insert(schema.jobs).values({ projectId: p.id, type: "site_build" }).returning({ id: schema.jobs.id });
  const build: SiteBuild = {
    stage: 0,
    startedAt: new Date().toISOString(),
    files: 0,
    ownerEmail: user.email ?? undefined,
    // Only promise an email when email sending is actually set up.
    ...(process.env.RESEND_API_KEY && user.email ? { notifyEmail: user.email } : {}),
  };
  // A new build clears the old failure line, so the chat never shows a failure above the result.
  const msgs = state.msgs.filter((m) => !(m.kind === "bot" && isBuildFailedText(m.text)));
  const next: WorkspaceState = { ...state, msgs, phase: "build", jobId: job.id, site: { ...state.site, build } };
  await db.update(schema.projects).set({ state: next, status: "building", updatedAt: new Date() }).where(eq(schema.projects.id, p.id));
  return NextResponse.json({ state: next });
}
