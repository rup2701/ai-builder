import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";

const Body = z.object({ email: z.string().email().max(200), role: z.string().min(1).max(40) });

/** Publishing is not open yet. This records who asked, so the plan can be sent when it opens. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Enter a valid email and role." }, { status: 400 });
  await db.insert(schema.publishRequests).values({ projectId: p.id, ...body.data });
  return NextResponse.json({ ok: true });
}
