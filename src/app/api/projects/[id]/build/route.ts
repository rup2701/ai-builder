import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import type { SiteBuild, WorkspaceState } from "@/lib/workspace/types";

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

  const [job] = await db.insert(schema.jobs).values({ projectId: p.id, type: "site_build" }).returning({ id: schema.jobs.id });
  const build: SiteBuild = {
    stage: 0,
    startedAt: new Date().toISOString(),
    files: 0,
    ownerEmail: user.email ?? undefined,
    // Only promise an email when email sending is actually set up.
    ...(process.env.RESEND_API_KEY && user.email ? { notifyEmail: user.email } : {}),
  };
  const next: WorkspaceState = { ...state, phase: "build", jobId: job.id, site: { ...state.site, build } };
  await db.update(schema.projects).set({ state: next, status: "building", updatedAt: new Date() }).where(eq(schema.projects.id, p.id));
  return NextResponse.json({ state: next });
}
