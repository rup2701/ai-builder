import { z } from "zod";
import type { Complete, Tool } from "./model-interviewer";
import { SECTION_LABEL, SWITCHABLE, isScaffoldBrief, sectionHasContent, sectionsOff, type Switchable } from "../builder/local-edit";

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
  /** A short plain answer when the owner asked a question and did not ask for a change. Nothing is changed. */
  answer: z.string().trim().min(5).max(800).optional(),
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
      instruction: { type: "string", description: "One paragraph for the developer who makes the change: what to change, where, and the key values. At most 120 words. A long request is attached to it word for word, so do not copy it out in full." },
      answer: { type: "string", description: "Only when the owner asked a question and did not ask for a change. One to four plain sentences that answer it. Nothing is changed." },
      decline: { type: "string", description: "Only when the request cannot be done as a change to the public page. One plain sentence." },
    },
  },
};

const SYSTEM = (siteName: string, sections: string[], applied: string[], content: string, packNote: string) => `You help the owner of a website called "${siteName}" ask for changes to its public page. You rewrite their request so they can check it at a glance, and so the developer who makes the change gets a clear instruction. Always call the plan_change tool.

The page has these sections, top to bottom: ${sections.join("; ")}.
${packNote ? `\n${packNote}\n` : ""}
${content ? `What the page said when it was built, from the brief (it may be a little behind later changes):\n${content}\n\n` : ""}${applied.length ? `Changes already made and live on this site, newest last:\n${applied.map((a) => `- ${a}`).join("\n")}\n` : "No changes have been made through this chat yet.\n"}
Rules:
- The owner may ask a question instead of asking for a change ("why is this card bigger?", "what does this section do?", "how many plans are there?"). Then set "answer" to one to four plain sentences that answer it, using the page content, the section list and the list of live changes above, and leave everything else out. Say plainly when you cannot tell. Do not guess. When a change is the natural next step, end with one short sentence that offers it, for example "Tell me if you want it the same size as the others." Never make a change for a question and never ask the owner a question.
- If everything the owner asks for is already in the list of live changes, set "decline" to one plain sentence that says so and names the change, for example "That is already live: <title>. Nothing to change." and leave the rest out.
- The list comes from this chat and can be wrong. If the owner says it is not on the page, or asks to do it again or to redo it, plan the change as new and do not decline.
- If only part of it is already live, plan only the new part, and add one line to "changes" that starts with "Already live:" naming what you are leaving as it is.
- Say what the owner asked, in their words and with their numbers, no more. Do not add changes they did not ask for.
- Plain slips in the owner's text are fixed, not copied: a stray capital letter in the middle of a phrase ("No Credit card required" becomes "No credit card required"), a doubled space, a missing space after a comma, an obvious misspelling. Do not change their words, order or meaning. Numbers, prices, names, product names and anything inside quotation marks stay exactly as typed. When you fix a slip, write the fixed text in "changes" and the instruction, so the owner sees it before approving.
- Where their wording leaves a choice open ("light gray or a bit lighter or darker"), choose one sensible option yourself, give the value (for words, numbers and prices; for look in everyday words see the rule below), and say it in the matching line of "changes" (for example "light gray, a little darker than the card background"). Never ask the owner a question.
- When the owner asks for a look in everyday words ("more premium", "more modern", "less flat", "add depth", "bolder", "calmer", "cleaner"), keep their words. Do not turn them into color codes, pixel sizes or letter-spacing values, in "changes" or in the title. In "changes" say the visible result in plain words, for example "The page background gets a soft dotted texture and a gentle glow" or "Cards get a glass look with a clear edge". In the instruction say that the developer must apply the depth and polish rules in specs/look.md for this site's tone, quote the owner's words, and make the result clearly visible on a normal screen. If the owner does give a number or a color, use it. Such a change is substantial.
- Name the section each change is in, using the section names above.
- Keep the page's look: one accent color, colors that stay readable (text contrast of at least 4.5 to 1), the same spacing and card style. Say so in the instruction when a change touches color or size.
- Prices: a price the owner types is used exactly as typed. A figure worked out from another (a yearly price after a discount, a per-month equivalent) is a whole dollar, rounded down. When a price changes, say in the instruction that every place that shows or quotes it must be updated, including FAQ text.
- When a line of "changes" is about content shown above (a price, a headline, a plan name), use the real values from it, for example "Starter yearly price: $470.40 becomes $470". Work out amounts from the page content and the owner's rule. Never invent values, numbers or names that are in neither the request nor the page content above. If you cannot tell the real value, describe the change in words.
- Never invent proof or content: no new numbers, prices, names, logos, quotes or claims. If the owner gives such content, use it exactly.
- The owner can attach pictures. When the request says pictures are attached, they are already saved as files on the site and the developer can use them, so never decline, never ask for the file again and never say you cannot see or use it. Plan where the picture goes (for a hero picture: the right side of the top section, in a frame) and say in "changes" that the attached picture is used as given.
- Only the public page can change here. If the request is about the owner's sign-in or sign-ups, the database, payments or anything outside the page, set "decline" to one plain sentence and leave the rest out.
- Set "size" to small when only text and figures shown on the page change (words, numbers, prices, labels), however many places they appear in. A price rule such as "round the yearly prices down" or "update the FAQ text" is small. Design, layout, color, spacing, behavior, or a new or removed section is substantial. Use substantial only when you cannot tell which.
- "title" is at most eight plain words. Each line of "changes" is one result in plain words, at most 25 words. No code terms the owner did not use.`;

const SECTION_NAMES: Record<string, string> = {
  hero: "the hero at the top (headline, button and product image)",
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
  benefits_bento: "the benefits grid",
  how_it_works: "How it works (the numbered steps)",
  faq: "the FAQ",
  closing_cta: "the closing call to action (headline and button)",
  examples_gallery: "the examples gallery",
  comparison_table: "the comparison table",
  use_case_cards: "the use-case cards",
};

const isLocalBrief = (b: Record<string, unknown> | null | undefined): boolean => (b?.site as { kind?: string } | undefined)?.kind === "local-business";

/** The site's name: a restaurant brief keeps it under site.name, a showcase brief at the top. */
export function siteNameOf(brief: Record<string, unknown> | null | undefined): string {
  const top = brief?.name;
  const nested = (brief?.site as { name?: unknown } | undefined)?.name;
  return typeof top === "string" && top ? top : typeof nested === "string" && nested ? nested : "this site";
}

/** What a restaurant page really draws, by the page rules, and what it does not. A section with nothing to show is a placeholder block in template mode. */
export function localPage(brief: Record<string, unknown>): { shown: string[]; missing: string[]; scaffold: boolean } {
  const b = brief as never;
  const off = new Set(sectionsOff(b));
  const scaffold = isScaffoldBrief(b);
  const shown = ["the hero at the top (name, tagline and the table request form)"];
  const missing: string[] = [];
  for (const sec of SWITCHABLE) {
    const label = SECTION_LABEL[sec as Switchable];
    if (off.has(sec)) { missing.push(`${label} (switched off)`); continue; }
    if (sectionHasContent(b, sec as Switchable)) shown.push(label);
    else if (scaffold && sec !== "ways") shown.push(`${label} (placeholder block: coming soon)`);
    else missing.push(`${label} (not on the page: nothing to show yet)`);
  }
  shown.push("the footer");
  return { shown, missing, scaffold };
}

function localContent(brief: Record<string, unknown>): string {
  const site = (brief.site ?? {}) as Record<string, unknown>;
  const contact = (brief.contact ?? {}) as Record<string, unknown>;
  const cats = ((brief.menu as { categories?: { name: string; items: { name: string; price?: string }[] }[] } | undefined)?.categories ?? []);
  const menu = cats.map((c) => `${c.name}: ${c.items.map((i) => (i.price ? `${i.name} ${i.price}` : i.name)).join(", ")}`).join("\n");
  return [
    `Name: ${site.name ?? ""}`, site.kind_label ? `Kind: ${site.kind_label}` : "", site.tagline ? `Tagline: ${site.tagline}` : "",
    contact.address ? `Address: ${contact.address}` : "", contact.phone ? `Phone: ${contact.phone}` : "",
    Array.isArray(contact.hours) && contact.hours.length ? `Hours: ${(contact.hours as string[]).join("; ")}` : "",
    menu ? `Menu:\n${menu}` : "Menu: none given yet", brief.story ? "Story: given" : "Story: none given yet",
  ].filter(Boolean).join("\n");
}

/** Rules for a restaurant page, so a request for one of its sections is handled as the template's section and never as new code. */
export function packNoteOf(brief: Record<string, unknown> | null | undefined): string {
  if (!isLocalBrief(brief)) return "";
  const { missing, scaffold } = localPage(brief!);
  return [
    "This is a restaurant site made from a fixed template. Its sections are: hero, Menu highlights (the \"From the menu\" cards), Menu, About or Our story, Our Food (the photo gallery), Customer reviews, Catering, Ways to order, footer. It has no other sections: no How it works, Pricing or Testimonials.",
    scaffold ? "Sections with nothing to show are drawn as placeholder blocks (\"Dish 1\", \"Photo 1\", \"Coming soon\") for the owner to fill in." : "This site was built before placeholder blocks existed, so a section with nothing to show is not drawn at all.",
    missing.length ? `Template sections not on the page now: ${missing.join("; ")}.` : "",
    "Rules for this site: when the owner asks to add a section that is already on the page (even as a placeholder block), set decline to say it is already there and what to send to fill it (dish names and prices, or attached pictures). When they ask for a template section that is not on the page, plan to switch that section on with the content they give, and say in the instruction to use the template's own section and not to write a new one. When they ask for a section the template does not have, set decline to say so and name the nearest template section. Never invent dishes, prices, hours or pictures.",
  ].filter(Boolean).join("\n");
}

/** The page's sections, in the brief's order, in plain words. */
export function sectionsOf(brief: Record<string, unknown> | null | undefined): string[] {
  if (isLocalBrief(brief)) return localPage(brief!).shown;
  const blocks = Array.isArray(brief?.blocks) ? (brief!.blocks as { type?: unknown }[]) : [];
  const names = blocks.map((b) => (typeof b?.type === "string" ? SECTION_NAMES[b.type] : undefined)).filter((x): x is string => Boolean(x));
  return names.length ? names : ["the hero", "the product preview", "How it works", "Pricing", "the closing call to action", "the footer"];
}

/** The page's words, from the brief, as short text for the planner: enough to quote real values, never the whole brief. */
export function pageContentOf(brief: Record<string, unknown> | null | undefined, max = 3500): string {
  if (isLocalBrief(brief)) return localContent(brief!).slice(0, max);
  const blocks = Array.isArray(brief?.blocks) ? (brief!.blocks as Record<string, unknown>[]) : [];
  const text = blocks.map((b) => JSON.stringify(b)).join("\n");
  return text.length > max ? text.slice(0, max) + " …" : text;
}

/** Returns a usable plan, or null when the model failed or returned nothing usable (the caller then uses the owner's own words). */
export async function planChange(
  complete: Complete,
  text: string,
  ctx: { siteName: string; sections: string[]; applied?: string[]; content?: string; packNote?: string },
): Promise<{ plan: ChangePlanT | null; usage: { inputTokens: number; outputTokens: number; costUsd: number } | null }> {
  try {
    const ask = () => complete({ system: SYSTEM(ctx.siteName, ctx.sections, ctx.applied ?? [], ctx.content ?? "", ctx.packNote ?? ""), user: `The owner wrote:\n"""\n${text}\n"""\n\nCall plan_change.`, tool: TOOL });
    // One retry: the model sometimes answers without calling the tool, or the call times out.
    const r = await ask().catch((e) => {
      console.error("change planner: first try failed:", e instanceof Error ? e.message : e);
      // A timeout is not retried: a second wait of the same length would run past the route's 60 second limit.
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw e;
      return ask();
    });
    const parsed = ChangePlan.safeParse(r.input);
    if (!parsed.success) {
      console.error("change planner: unusable reply:", JSON.stringify(parsed.error.issues).slice(0, 400));
      return { plan: null, usage: r.usage };
    }
    const p = parsed.data;
    // A plan is usable only if it answers, declines, or has a title, results and an instruction together.
    if (p.answer) return { plan: { answer: p.answer }, usage: r.usage };
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
