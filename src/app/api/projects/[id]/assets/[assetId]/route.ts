import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A picture the owner attached, for the preview in the chat. Only the owner can see it. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; assetId: string }> }) {
  const user = await getUser();
  if (!user) return new NextResponse("Sign in first.", { status: 401 });
  const { id, assetId } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p || !/^[0-9a-f-]{36}$/i.test(assetId)) return new NextResponse("Not found.", { status: 404 });
  const [a] = await db.select({ bytes: schema.siteAssets.bytes, mime: schema.siteAssets.mime }).from(schema.siteAssets).where(and(eq(schema.siteAssets.id, assetId), eq(schema.siteAssets.projectId, p.id))).limit(1);
  if (!a) return new NextResponse("Not found.", { status: 404 });
  return new NextResponse(new Uint8Array(a.bytes), { headers: { "content-type": a.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
}
