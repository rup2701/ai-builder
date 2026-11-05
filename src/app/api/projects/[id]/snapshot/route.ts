import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import type { WorkspaceState } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";

type Snap = { event?: string; which?: string; mime?: string; b64?: string };

/** The before or after picture of one change: /snapshot?msg=<chat message id>&which=before|after. Only the owner can see it. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new NextResponse("Sign in first.", { status: 401 });
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return new NextResponse("Not found.", { status: 404 });

  const url = new URL(req.url);
  const msgId = Number(url.searchParams.get("msg"));
  const which = url.searchParams.get("which");
  if (!Number.isInteger(msgId) || (which !== "before" && which !== "after")) return new NextResponse("Bad request.", { status: 400 });

  const m = (p.state as WorkspaceState).msgs.find((x) => x.id === msgId && x.kind === "site_change");
  const jobId = m && m.kind === "site_change" ? (m.snapJobId ?? m.jobId) : undefined;
  if (!jobId) return new NextResponse("Not found.", { status: 404 });

  const [job] = await db
    .select({ log: schema.jobs.log })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.projectId, p.id)))
    .limit(1);
  const snap = (Array.isArray(job?.log) ? (job.log as Snap[]) : []).find((e) => e.event === "snapshot" && e.which === which && e.b64);
  if (!snap?.b64) return new NextResponse("Not found.", { status: 404 });

  return new NextResponse(Buffer.from(snap.b64, "base64"), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" },
  });
}
