import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import type { SiteBuild, WorkspaceState } from "@/lib/workspace/types";
import { isBuildFailedText } from "@/lib/builder/site-stages";
import { buildAllowance } from "@/lib/builds";

export const dynamic = "force-dynamic";

/** "Build my site": queues a site build for the worker. One build at a time per project. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (p.kind !== "site") return NextResponse.json({ error: "This project is not a website." }, { status: 400 });

  const state = p.state as WorkspaceState;
  // "Retry publishing": the site is already built and only the publish step failed, so only that runs again.
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const publishOnly = body.mode === "publish";
  if (publishOnly && !(state.site?.build?.failedStage === 4 && state.site.build.runDir)) {
    return NextResponse.json({ error: "There is no finished site to publish again. Build it from the start." }, { status: 409 });
  }
  if (!state.site?.brief) return NextResponse.json({ error: "Finish the interview first: there is no saved brief yet." }, { status: 409 });
  if (state.phase === "build" || state.phase === "verify") return NextResponse.json({ error: "A build is already running." }, { status: 409 });

  const running = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.projectId, p.id), inArray(schema.jobs.type, ["site_build", "site_publish"]), inArray(schema.jobs.status, ["queued", "running"])))
    .limit(1);
  if (running.length) return NextResponse.json({ error: "A build is already queued." }, { status: 409 });

  // Optional cap on builds per person (SITE_BUILD_LIMIT; 0 or unset means no cap). Failed builds and publish retries do not count.
  // A person's access code can carry its own limit, which replaces the global one.
  if (!publishOnly) {
    const { limit, used } = await buildAllowance(user.id, user.email ?? null);
    if (limit > 0 && used >= limit) {
      return NextResponse.json({ error: `You have used your ${limit} site builds for now.` }, { status: 429 });
    }
  }

  const [job] = await db.insert(schema.jobs).values({ projectId: p.id, type: publishOnly ? "site_publish" : "site_build" }).returning({ id: schema.jobs.id });
  const old = state.site.build;
  const build: SiteBuild = {
    ...(publishOnly ? { stage: 4, startedAt: old!.startedAt, files: old!.files, runDir: old!.runDir } : { stage: 0, startedAt: new Date().toISOString(), files: 0 }),
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
