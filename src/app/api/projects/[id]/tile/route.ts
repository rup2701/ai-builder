import { NextResponse } from "next/server";
import { pool } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import { isAdmin } from "@/lib/admin";
import { readDesignBrief, renderTileFor, tileState } from "@/lib/design-brief-store";
import type { WorkspaceState } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";

/**
 * The style tile for a project (APP-42 step 3, APP-43), admin only: anyone else gets 404, as if it did not exist.
 *   GET   the tile's page, its seven checks and whether it is stale.
 *   POST  draws the tile again from the saved design brief and the current brief (code only, no model call).
 */
async function load(ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user || !isAdmin(user)) return null;
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return null;
  const brief = ((p.state as WorkspaceState).site?.brief ?? null) as Record<string, unknown> | null;
  return { p, brief };
}

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if (!got) return notFound();
  const state = tileState(await readDesignBrief(pool, got.p.id), got.brief);
  if (state.kind === "none") return NextResponse.json({ tile: null, why: state.why });
  const { html, checks, renderedAt, error } = state.tile;
  return NextResponse.json({ tile: { html, checks, renderedAt, error }, stale: state.stale, why: state.why });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if (!got) return notFound();
  if (!got.brief) return NextResponse.json({ error: "This project has no approved brief yet." }, { status: 409 });
  const r = await renderTileFor(pool, got.p.id, got.brief);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.why }, { status: 409 });
}
