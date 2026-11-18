import { after, NextResponse } from "next/server";
import { pool } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import { designBriefAtReview } from "@/lib/design-brief-store";

export const dynamic = "force-dynamic";
// The brief is written after the response, within this limit: a short settle time plus the step's own 100 seconds.
// The turn route already runs with 120 seconds on our plan.
export const maxDuration = 120;

/**
 * Write the design brief for a project at review (APP-49). The browser calls this after the owner approved the brief, and
 * again whenever the saved brief changes. It answers at once; the work runs after the response, so closing the tab does
 * not stop it. The owner sees nothing either way: the result goes only to projects.design_brief, and a build start uses it
 * when it passed and still matches, or writes a new one.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (p.kind !== "site" || p.archivedAt) return NextResponse.json({ queued: false }, { status: 202 });

  after(async () => {
    const r = await designBriefAtReview({ db: pool, projectId: p.id, env: process.env }).catch((e) => ({ ran: false as const, why: `error: ${e instanceof Error ? e.message : e}` }));
    console.log(`[design-brief] ${p.id.slice(0, 8)} ${r.ran ? `${r.status}, $${r.costUsd.toFixed(4)}` : `not written: ${r.why}`}`);
  });
  return NextResponse.json({ queued: true }, { status: 202 });
}
