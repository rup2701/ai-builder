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
  /** "small" when only text and figures shown on the page change, with no change to layout, look, behavior or sections. */
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
      size: { type: "string", enum: ["small", "substantial"], description: "small = only the text and figures shown on the page change (words, numbers, prices, labels, sentences), in as many places as they appear, including rounding or recalculating figures and updating every place that quotes them. substantial = anything that changes design, layout, spacing, color or behavior, or adds or removes a section. Only when you cannot tell which, substantial." },
      instruction: { type: "string", description: "One paragraph for the developer who makes the change: what to change, where, and every value." },
      decline: { type: "string", description: "Only when the request cannot be done as a change to the public page. One plain sentence." },
    },
  },
};

const SYSTEM = (siteName: string, sections: string[], applied: string[], content: string) => `You help the owner of a website called "${siteName}" ask for changes to its public page. You rewrite their request so they can check it at a glance, and so the developer who makes the change gets a clear instruction. Always call the plan_change tool.

The page has these sections, top to bottom: ${sections.join("; ")}.

${content ? `What the page said when it was built, from the brief (it may be a little behind later changes):\n${content}\n\n` : ""}${applied.length ? `Changes already made and live on this site, newest last:\n${applied.map((a) => `- ${a}`).join("\n")}\n` : "No changes have been made through this chat yet.\n"}
Rules:
- If everything the owner asks for is already in the list of live changes, set "decline" to one plain sentence that says so and names the change, for example "That is already live: <title>. Nothing to change." and leave the rest out.
- The list comes from this chat and can be wrong. If the owner says it is not on the page, or asks to do it again or to redo it, plan the change as new and do not decline.
- If only part of it is already live, plan only the new part, and add one line to "changes" that starts with "Already live:" naming what you are leaving as it is.
- Say what the owner asked, in their words and with their numbers, no more. Do not add changes they did not ask for.
- Where their wording leaves a choice open ("light gray or a bit lighter or darker"), choose one sensible option yourself, give the value, and say it in the matching line of "changes" (for example "light gray, a little darker than the card background"). Never ask the owner a question.
- Name the section each change is in, using the section names above.
- Keep the page's look: one accent color, colors that stay readable (text contrast of at least 4.5 to 1), the same spacing and card style. Say so in the instruction when a change touches color or size.
- Prices: a price the owner types is used exactly as typed. A figure worked out from another (a yearly price after a discount, a per-month equivalent) is a whole dollar, rounded down. When a price changes, say in the instruction that every place that shows or quotes it must be updated, including FAQ text.
- When a line of "changes" is about content shown above (a price, a headline, a plan name), use the real values from it, for example "Starter yearly price: $470.40 becomes $470". Work out amounts from the page content and the owner's rule. Never invent values, numbers or names that are in neither the request nor the page content above. If you cannot tell the real value, describe the change in words.
- Never invent proof or content: no new numbers, prices, names, logos, quotes or claims. If the owner gives such content, use it exactly.
- Only the public page can change here. If the request is about the owner's sign-in or sign-ups, the database, payments or anything outside the page, set "decline" to one plain sentence and leave the rest out.
- Set "size" to small when only text and figures shown on the page change (words, numbers, prices, labels), however many places they appear in. A price rule such as "round the yearly prices down" or "update the FAQ text" is small. Design, layout, color, spacing, behavior, or a new or removed section is substantial. Use substantial only when you cannot tell which.
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

/** The page's words, from the brief, as short text for the planner: enough to quote real values, never the whole brief. */
export function pageContentOf(brief: Record<string, unknown> | null | undefined, max = 3500): string {
  const blocks = Array.isArray(brief?.blocks) ? (brief!.blocks as Record<string, unknown>[]) : [];
  const text = blocks.map((b) => JSON.stringify(b)).join("\n");
  return text.length > max ? text.slice(0, max) + " …" : text;
}

/** Returns a usable plan, or null when the model failed or returned nothing usable (the caller then uses the owner's own words). */
export async function planChange(
  complete: Complete,
  text: string,
  ctx: { siteName: string; sections: string[]; applied?: string[]; content?: string },
): Promise<{ plan: ChangePlanT | null; usage: { inputTokens: number; outputTokens: number; costUsd: number } | null }> {
  try {
    const ask = () => complete({ system: SYSTEM(ctx.siteName, ctx.sections, ctx.applied ?? [], ctx.content ?? ""), user: `The owner wrote:\n"""\n${text}\n"""\n\nCall plan_change.`, tool: TOOL });
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
