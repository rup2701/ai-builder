import { z } from "zod";
import type { Complete, Tool } from "./model-interviewer";

/**
 * "Change my site": Scout turns what the owner typed into a short plan they can check at a glance, and a clear
 * instruction for the agent that makes the change. The model only rewrites the request. It does not run anything.
 * If it fails or says something unusable, the caller falls back to the owner's own words.
 */

export const ChangePlan = z.object({
  /** Up to eight plain words: what this change is. */
  title: z.string().trim().min(3).max(120).optional(),
  /** One to four concrete results, in the owner's words, with every choice made visible. */
  changes: z.array(z.string().trim().min(5).max(500)).min(1).max(6).optional(),
  /** "small" only for a change to wording (a headline, label, price text) with no change to layout, look or sections. */
  size: z.enum(["small", "substantial"]).optional(),
  /** The full instruction for the agent. Missing when the request cannot be done as a change to the public page. */
  instruction: z.string().trim().min(10).max(3000).optional(),
  /** A plain sentence for the owner when the request is not something this can do. */
  decline: z.string().trim().min(5).max(500).optional(),
});
export type ChangePlanT = z.infer<typeof ChangePlan>;

const TOOL: Tool = {
  name: "plan_change",
  description: "Write the plan for one change to the website's public page, or say plainly that it cannot be done this way.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "At most eight plain words. No jargon." },
      changes: { type: "array", items: { type: "string" }, description: "One to four concrete results the owner will see, in plain words. State every choice you made for them, with the value." },
      size: { type: "string", enum: ["small", "substantial"], description: "small = only wording changes (a headline, button label, sentence, price text) in one or two places. substantial = anything that changes design, layout, spacing, color, adds or removes a section, or touches many places. When unsure, substantial." },
      instruction: { type: "string", description: "One paragraph for the developer who makes the change: what to change, where, and every value." },
      decline: { type: "string", description: "Only when the request cannot be done as a change to the public page. One plain sentence." },
    },
  },
};

const SYSTEM = (siteName: string, sections: string[], applied: string[]) => `You help the owner of a website called "${siteName}" ask for changes to its public page. You rewrite their request so they can check it at a glance, and so the developer who makes the change gets a clear instruction. Always call the plan_change tool.

The page has these sections, top to bottom: ${sections.join("; ")}.

${applied.length ? `Changes already made and live on this site, newest last:\n${applied.map((a) => `- ${a}`).join("\n")}\n` : "No changes have been made through this chat yet.\n"}
Rules:
- If everything the owner asks for is already in the list of live changes, set "decline" to one plain sentence that says so and names the change, for example "That is already live: <title>. Nothing to change." and leave the rest out.
- If only part of it is already live, plan only the new part, and add one line to "changes" that starts with "Already live:" naming what you are leaving as it is.
- Say what the owner asked, in their words and with their numbers, no more. Do not add changes they did not ask for.
- Where their wording leaves a choice open ("light gray or a bit lighter or darker"), choose one sensible option yourself, give the value, and say it in the matching line of "changes" (for example "light gray, a little darker than the card background"). Never ask the owner a question.
- Name the section each change is in, using the section names above.
- Keep the page's look: one accent color, colors that stay readable (text contrast of at least 4.5 to 1), the same spacing and card style. Say so in the instruction when a change touches color or size.
- Prices: a price the owner types is used exactly as typed. A figure worked out from another (a yearly price after a discount, a per-month equivalent) is a whole dollar, rounded down. When a price changes, say in the instruction that every place that shows or quotes it must be updated, including FAQ text.
- Never invent proof or content: no new numbers, prices, names, logos, quotes or claims. If the owner gives such content, use it exactly.
- Only the public page can change here. If the request is about the owner's sign-in or sign-ups, the database, payments or anything outside the page, set "decline" to one plain sentence and leave the rest out.
- Set "size" to small only for wording changes in one or two places. Design, layout, color, spacing, a new or removed section, or many places is substantial. When unsure, substantial.
- "title" is at most eight plain words. Each line of "changes" is one result in plain words, at most 25 words. No code terms the owner did not use.`;

const SECTION_NAMES: Record<string, string> = {
  hero: "the hero at the top (headline, email box and button)",
  visual: "the product preview below the hero",
  pills: "the feature pills",
  steps: "How it works (the numbered steps)",
  trust: "the trust block",
  pricing: "Pricing",
  testimonials: "Testimonials",
  cta: "the closing call to action (headline, email box and button)",
  footer: "the footer",
  preview: "the product preview",
  benefits: "the benefits",
  integrations: "the tools strip",
  waitlist: "the sign-up box",
};

/** The page's sections, in the brief's order, in plain words. */
export function sectionsOf(brief: Record<string, unknown> | null | undefined): string[] {
  const blocks = Array.isArray(brief?.blocks) ? (brief!.blocks as { type?: unknown }[]) : [];
  const names = blocks.map((b) => (typeof b?.type === "string" ? SECTION_NAMES[b.type] : undefined)).filter((x): x is string => Boolean(x));
  return names.length ? names : ["the hero", "the product preview", "How it works", "Pricing", "the closing call to action", "the footer"];
}

/** Returns a usable plan, or null when the model failed or returned nothing usable (the caller then uses the owner's own words). */
export async function planChange(
  complete: Complete,
  text: string,
  ctx: { siteName: string; sections: string[]; applied?: string[] },
): Promise<{ plan: ChangePlanT | null; usage: { inputTokens: number; outputTokens: number; costUsd: number } | null }> {
  try {
    const ask = () => complete({ system: SYSTEM(ctx.siteName, ctx.sections, ctx.applied ?? []), user: `The owner wrote:\n"""\n${text}\n"""\n\nCall plan_change.`, tool: TOOL });
    // One retry: the model sometimes answers without calling the tool, or the call times out.
    const r = await ask().catch((e) => {
      console.error("change planner: first try failed, retrying:", e instanceof Error ? e.message : e);
      return ask();
    });
    const parsed = ChangePlan.safeParse(r.input);
    if (!parsed.success) {
      console.error("change planner: unusable reply:", JSON.stringify(parsed.error.issues).slice(0, 400));
      return { plan: null, usage: r.usage };
    }
    const p = parsed.data;
    // A plan is usable only if it declines, or has a title, results and an instruction together.
    if (p.decline) return { plan: { decline: p.decline }, usage: r.usage };
    if (!p.title || !p.changes?.length || !p.instruction) {
      console.error("change planner: reply is missing a title, results or instruction");
      return { plan: null, usage: r.usage };
    }
    return { plan: p, usage: r.usage };
  } catch (e) {
    console.error("change planner: model call failed:", e instanceof Error ? e.message : e);
    return { plan: null, usage: null };
  }
}
