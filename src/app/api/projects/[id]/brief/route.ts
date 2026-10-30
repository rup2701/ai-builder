import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import { siteSlug } from "@/lib/builder/site-brief";
import type { WorkspaceState } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";

/** The saved website brief as a JSON download. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const brief = (p.state as WorkspaceState).site?.brief as { site?: { name?: string } } | undefined;
  if (!brief) return NextResponse.json({ error: "There is no brief yet." }, { status: 404 });
  return new NextResponse(JSON.stringify(brief, null, 2) + "\n", {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${siteSlug(brief.site?.name ?? "site")}.json"`,
    },
  });
}
