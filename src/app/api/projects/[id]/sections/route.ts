import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import { setSection } from "@/lib/builder/local-edit";
import type { WorkspaceState } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";

const Body = z.object({ section: z.string().max(30), on: z.boolean() });
const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Switch one section of a restaurant page on or off, before the site is built. Code only: the same rule the chat uses (setSection),
 * so the top of the page and the footer cannot be switched off and nothing is invented. The brief is saved; nothing is built.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return fail("Sign in first.", 401);
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return fail("Not found.", 404);
  if (p.kind !== "site") return fail("This project is not a website.", 400);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return fail("Say which section, and whether it should be on or off.", 400);

  const state = p.state as WorkspaceState;
  const brief = state.site?.brief as Record<string, unknown> | undefined;
  if (!brief || (brief.site as { kind?: string } | undefined)?.kind !== "local-business") return fail("There is no restaurant brief to change.", 409);
  if (state.site?.build || state.phase === "build" || state.phase === "verify") return fail("The site is already being built. After it is built, ask for changes in the change box.", 409);

  const out = setSection(brief, body.data.section, body.data.on);
  if (!out.ok) return fail(out.error, 400);
  const next: WorkspaceState = { ...state, site: { ...(state.site ?? {}), brief: out.brief } };
  await db.update(schema.projects).set({ state: next, updatedAt: new Date() }).where(eq(schema.projects.id, p.id));
  return NextResponse.json({ state: next, said: out.said });
}
