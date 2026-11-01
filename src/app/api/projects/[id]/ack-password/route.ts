import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import type { WorkspaceState } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";

/** "I have saved it": removes the owner password from the finished-build message, so it is not kept after that. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const state = p.state as WorkspaceState;
  const msgs = state.msgs.map((m) => {
    if (m.kind !== "site_ready") return m;
    const { password: _gone, ...rest } = m;
    void _gone;
    return rest;
  });
  const next: WorkspaceState = { ...state, msgs };
  await db.update(schema.projects).set({ state: next, updatedAt: new Date() }).where(eq(schema.projects.id, p.id));
  return NextResponse.json({ state: next });
}
