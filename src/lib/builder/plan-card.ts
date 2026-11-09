/**
 * The page plan Scout shows after the first answer ("I've added these sections: ... More sections to add: ...").
 * The chat turns it into a card with a checkmark per section. These helpers read the plan out of Scout's text and write
 * the person's choices back as one plain sentence, so Scout reads them the way it reads any answer.
 */

export type Plan = { before: string; added: string[]; extra: string[]; after: string };

/** Sections that stay on whatever the person picks (the interview guide: hero, how it works, FAQ, closing call to action, footer). */
const LOCKED = [/^hero/i, /^how it works/i, /^faq/i, /^closing/i, /^footer/i];
export const isLocked = (name: string) => LOCKED.some((r) => r.test(name.trim()));

const bullet = /^\s*(?:[-*•])\s+(.+?)\s*$/;
const clean = (s: string) => s.replace(/\*\*/g, "").trim();

/** The plan in a Scout message, or null when the message is not a plan. */
export function parsePlan(text: string): Plan | null {
  const lines = text.split("\n");
  const a = lines.findIndex((l) => /added these sections/i.test(l));
  const b = lines.findIndex((l) => /more sections to add/i.test(l));
  if (a < 0 || b <= a) return null;
  const items = (from: number, to: number) => lines.slice(from + 1, to).map((l) => bullet.exec(l)?.[1]).filter((x): x is string => Boolean(x)).map(clean);
  const added = items(a, b);
  let end = lines.length;
  for (let i = b + 1; i < lines.length; i++) if (lines[i].trim() && !bullet.test(lines[i])) { end = i; break; }
  const extra = items(b, end);
  if (added.length < 3 || extra.length < 1) return null;
  return { before: lines.slice(0, a).join("\n").trim(), added, extra, after: lines.slice(end).join("\n").trim() };
}

/** What the person picked, as the message Scout receives. `on` is the set of checked section names. */
export function planReply(plan: Plan, on: Set<string>): string {
  const add = plan.extra.filter((n) => on.has(n));
  const drop = plan.added.filter((n) => !isLocked(n) && !on.has(n));
  const parts = ["Looks good."];
  if (add.length) parts.push(`Add: ${add.join(", ")}.`);
  if (drop.length) parts.push(`Drop: ${drop.join(", ")}.`);
  if (!add.length && !drop.length) parts.push("No changes to the plan.");
  return parts.join(" ");
}
