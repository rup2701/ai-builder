import { anthropicComplete } from "@/lib/agents/anthropic";
import { crawlSite } from "./site-extract";
import { mapSnapshot, type ImportResult } from "./site-import";

/** What reading a website gives back, and what the reading cost. */
export type ReadOutcome = { result: ImportResult; costUsd: number; inputTokens: number; outputTokens: number };
export type ReadWebsite = (url: string) => Promise<ReadOutcome>;

/**
 * The reader for a restaurant: fetches the owner's own pages and copies out what they say (menu, hours, pictures with their own captions).
 * Same reading the admin import route does, kept here so the interview can call it. Errors from fetching (ImportError) pass through with their plain message.
 */
export const readRestaurantSite: ReadWebsite = async (url) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Reading websites is not switched on yet.");
  const snap = await crawlSite(url);
  const model = process.env.ANTHROPIC_IMPORT_MODEL || "claude-haiku-5-5";
  const { result, usage } = await mapSnapshot(
    anthropicComplete({ apiKey, model, timeoutMs: 40_000, maxTokens: 2000 }),
    snap,
    anthropicComplete({ apiKey, model, timeoutMs: 50_000, maxTokens: 8000 }),
    "menu",
  );
  return { result, costUsd: usage?.costUsd ?? 0, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 };
};
