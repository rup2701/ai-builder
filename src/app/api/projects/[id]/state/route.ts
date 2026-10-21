import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned, statusFor, titleFor } from "@/lib/projects";
import type { WorkspaceState } from "@/lib/workspace/types";

const Body = z
  .object({
    v: z.literal(1),
    phase: z.enum(["idle", "intake", "summary", "build", "verify", "iterate"]),
    nextId: z.number().int(),
    msgs: z.array(z.object({ id: z.number().int(), kind: z.string() }).passthrough()),
    history: z.array(z.record(z.string(), z.unknown())),
    firstIdea: z.string(),
    published: z.boolean(),
  })
  .passthrough();

/**
 * The browser saves the iterate phase here (changes, undo). Intake and build are owned by the
 * server and the worker, so a save is only accepted while the project is in the iterate phase.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That state is not valid." }, { status: 400 });
  const current = p.state as WorkspaceState;
  if (current.phase !== "iterate" || parsed.data.phase !== "iterate") {
    return NextResponse.json({ error: "Only the iterate phase can be saved from the browser." }, { status: 409 });
  }
  // The server's job and brief fields win; the browser owns messages, versions and the published flag.
  const next = { ...current, ...(parsed.data as unknown as WorkspaceState), brief: current.brief, jobId: current.jobId };
  await db
    .update(schema.projects)
    .set({ state: next, title: titleFor(next, p.idea), status: statusFor(next), updatedAt: new Date() })
    .where(eq(schema.projects.id, p.id));
  return NextResponse.json({ ok: true });
}
