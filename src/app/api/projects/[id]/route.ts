import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** Current state. The workspace polls this while a build runs. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ state: p.state, status: p.status });
}
