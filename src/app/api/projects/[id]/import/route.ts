import { NextResponse } from "next/server";
import { and, count, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { allowedEmails } from "@/auth";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import { anthropicComplete } from "@/lib/agents/anthropic";
import { logUsage } from "@/lib/usage";
import { ImportError } from "@/lib/builder/safe-fetch";
import { crawlSite } from "@/lib/builder/site-extract";
import { mapSnapshot } from "@/lib/builder/site-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Tries per project per hour. Set SITE_IMPORT_LIMIT_PER_HOUR to change it; the people who run the builder are not limited. */
const PER_HOUR = Number(process.env.SITE_IMPORT_LIMIT_PER_HOUR) > 0 ? Number(process.env.SITE_IMPORT_LIMIT_PER_HOUR) : 5;
const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * "Read my current website": POST { url } returns a draft of the facts that site states about itself (name, address, phone, hours,
 * menu, links and picture links). Nothing is saved or built here; the interview uses the draft and the owner checks it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return fail("Sign in first.", 401);
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return fail("Not found.", 404);
  if (p.kind !== "site") return fail("This project is not a website.", 400);
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  if (typeof body?.url !== "string") return fail("Please paste the address of your website.", 400);

  // Every attempt counts, so a stranger cannot use this to read the web for free.
  const since = new Date(Date.now() - 3_600_000);
  const [{ n }] = await db.select({ n: count() }).from(schema.usage).where(and(eq(schema.usage.projectId, p.id), eq(schema.usage.step, "site_import"), gte(schema.usage.createdAt, since)));
  const admin = allowedEmails().includes((user.email ?? "").toLowerCase());
  if (!admin && n >= PER_HOUR) return fail("That is a lot of tries in a short time. Please wait a little and try again.", 429);
  await logUsage({ projectId: p.id, step: "site_import", model: "none" }).catch(() => {});

  try {
    const snap = await crawlSite(body.url);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return fail("Reading websites is not switched on yet.", 503);
    // Copying facts out of text does not need the big model: a fast one is cheaper and finishes a long menu in time.
    const model = process.env.ANTHROPIC_IMPORT_MODEL || "claude-haiku-5-5";
    const { result, usage } = await mapSnapshot(anthropicComplete({ apiKey, model, timeoutMs: 40_000, maxTokens: 2000 }), snap, anthropicComplete({ apiKey, model, timeoutMs: 50_000, maxTokens: 8000 }));
    if (usage) await logUsage({ projectId: p.id, step: "site_import_map", model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd }).catch(() => {});
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ImportError || (e as Error)?.name === "ImportError") return fail((e as Error).message, 422);
    console.error("site import failed:", e instanceof Error ? e.message : e);
    return fail("I could not read that website. You can type the details instead.", 500);
  }
}
