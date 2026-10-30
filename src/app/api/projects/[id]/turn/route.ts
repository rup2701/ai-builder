import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned, statusFor, titleFor } from "@/lib/projects";
import { getInterviewer, getSiteInterviewer } from "@/lib/agents/interviewer";
import { saveBriefForRunner } from "@/lib/builder/site-files";
import { logUsage } from "@/lib/usage";
import type { WorkspaceState } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";
// The model writes a whole brief in one reply, which can take a while.
export const maxDuration = 120;

const Body = z.object({ text: z.string().min(1).max(2000) });

/** One user message during intake, summary or "start over". Returns the new workspace state. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Send some text." }, { status: 400 });

  const prev = p.state as WorkspaceState;
  if (prev.phase === "build" || prev.phase === "verify") {
    return NextResponse.json({ error: "A build is running. Come back when it finishes." }, { status: 409 });
  }

  const site = p.kind === "site";
  const interviewer = site ? getSiteInterviewer() : getInterviewer();
  if (!interviewer) return NextResponse.json({ error: "The website interview needs the model key (ANTHROPIC_API_KEY)." }, { status: 503 });
  const result = await interviewer.turn(prev, body.data.text);
  let state = result.state;
  if (site && state.site?.brief && JSON.stringify(state.site.brief) !== JSON.stringify(prev.site?.brief)) {
    await saveBriefForRunner(p.id, state).catch((e) => console.error("could not save the brief for the runner:", e instanceof Error ? e.message : e));
  }
  let jobId: string | null = null;

  if (result.action === "build") {
    const [job] = await db.insert(schema.jobs).values({ projectId: p.id, type: "build" }).returning({ id: schema.jobs.id });
    jobId = job.id;
    state = { ...state, jobId };
  }
  const idea = prev.firstIdea || state.firstIdea || p.idea || body.data.text;
  await db
    .update(schema.projects)
    .set({ state, idea, title: titleFor(state, idea), status: statusFor(state), updatedAt: new Date() })
    .where(eq(schema.projects.id, p.id));
  await logUsage({
    projectId: p.id,
    jobId,
    step: "intake",
    model: result.usage?.model ?? interviewer.model,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    costUsd: result.usage?.costUsd,
  });

  return NextResponse.json({ state });
}
