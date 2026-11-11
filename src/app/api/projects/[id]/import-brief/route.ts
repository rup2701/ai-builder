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
import { importToBrief } from "@/lib/builder/import-to-brief";
import baseBrief from "@/lib/builder/artist-base-brief.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const PER_HOUR = Number(process.env.SITE_IMPORT_LIMIT_PER_HOUR) > 0 ? Number(process.env.SITE_IMPORT_LIMIT_PER_HOUR) : 5;
const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * "Make a draft store brief from this artist's website": POST { url, ownerConfirmed: true }.
 * Only for the people who run the builder for now. Nothing is saved or built: it returns the brief for the runner to build privately,
 * and the list of what the site did not give. It refuses unless the caller says the owner agreed to this site and its pictures being used.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return fail("Sign in first.", 401);
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return fail("Not found.", 404);
  if (!allowedEmails().includes((user.email ?? "").toLowerCase())) return fail("This is not switched on for your account.", 403);
  const body = (await req.json().catch(() => null)) as { url?: unknown; ownerConfirmed?: unknown; privateTest?: unknown } | null;
  if (typeof body?.url !== "string") return fail("Please give the address of the website.", 400);
  if (body.ownerConfirmed !== true && body.privateTest !== true) return fail("Say either that the owner agreed (ownerConfirmed: true) or that this is a private test (privateTest: true).", 400);

  const since = new Date(Date.now() - 3_600_000);
  const [{ n }] = await db.select({ n: count() }).from(schema.usage).where(and(eq(schema.usage.projectId, p.id), eq(schema.usage.step, "site_import"), gte(schema.usage.createdAt, since)));
  if (n >= PER_HOUR * 4) return fail("That is a lot of tries in a short time. Please wait a little and try again.", 429);
  await logUsage({ projectId: p.id, step: "site_import", model: "none" }).catch(() => {});

  try {
    const snap = await crawlSite(body.url);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return fail("Reading websites is not switched on yet.", 503);
    const model = process.env.ANTHROPIC_IMPORT_MODEL || "claude-haiku-5-5";
    const { result, usage } = await mapSnapshot(anthropicComplete({ apiKey, model, timeoutMs: 40_000, maxTokens: 2000 }), snap, anthropicComplete({ apiKey, model, timeoutMs: 50_000, maxTokens: 8000 }));
    if (usage) await logUsage({ projectId: p.id, step: "site_import_map", model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd }).catch(() => {});
    const { brief, notFound } = importToBrief(baseBrief as Record<string, unknown>, result, body.ownerConfirmed === true ? { ownerConfirmed: true, confirmedBy: user.email ?? "builder admin" } : { privateTest: true, by: user.email ?? "builder admin" });
    return NextResponse.json({ brief, notFound, warnings: result.warnings, dropped: result.dropped, works: result.catalog.length, pagesRead: result.pagesRead });
  } catch (e) {
    if (e instanceof ImportError || (e as Error)?.name === "ImportError") return fail((e as Error).message, 422);
    if (e instanceof Error && /confirm|gave no name/i.test(e.message)) return fail(e.message, 422);
    console.error("brief import failed:", e instanceof Error ? e.message : e);
    return fail("I could not read that website.", 500);
  }
}
