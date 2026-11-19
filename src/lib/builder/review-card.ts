/**
 * Scout's review in the website interview, read from the message text so the chat can draw it as a card. The text stays
 * as Scout wrote it (the model reads it back, and older screens show it); this only finds the parts. Nothing is invented.
 *
 * A review is paragraphs that start with a bold label: "**Headline:** Game day?" or "**Headline**" on its own line with the
 * text below. Lines starting with "- " are that section's list. Text before the first label (what Scout changed, "Here's
 * the review") and after the last section ("Do you want to change anything?") stays outside the card.
 */
export type ReviewSection = { label: string; text: string; items: string[] };
export type Review = { before: string; sections: ReviewSection[]; after: string };

const LABEL = /^\*\*([^*\n]{1,40}?):?\*\*:?\s*(.*)$/;
const BULLET = /^\s*[-•]\s+/;

/** The review in a message, or null when the message is not one: at least three labelled sections, or a headline and one more. */
export function parseReview(text: string): Review | null {
  const before: string[] = [];
  const after: string[] = [];
  const sections: ReviewSection[] = [];
  for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    const lines = para.split("\n").map((l) => l.trimEnd());
    const head = LABEL.exec(lines[0].trim());
    if (head) {
      const s: ReviewSection = { label: head[1].trim(), text: head[2].trim(), items: [] };
      for (const l of lines.slice(1)) {
        if (BULLET.test(l)) s.items.push(l.replace(BULLET, "").trim());
        else if (l.trim()) s.text = s.text ? `${s.text} ${l.trim()}` : l.trim();
      }
      sections.push(s);
      after.length = 0;
      continue;
    }
    // A list on its own, right after a labelled paragraph, belongs to that section.
    const last = sections.at(-1);
    if (last && !after.length && lines.every((l) => BULLET.test(l))) {
      last.items.push(...lines.map((l) => l.replace(BULLET, "").trim()));
      continue;
    }
    (sections.length ? after : before).push(para);
  }
  const isReview = sections.length >= 3 || (sections.length >= 2 && sections.some((s) => /^headline$/i.test(s.label)));
  return isReview ? { before: before.join("\n\n"), sections, after: after.join("\n\n") } : null;
}

/** A full review (the one the owner approves), as opposed to a short update of a few lines. */
export const isFullReview = (r: Review) => r.sections.length >= 5;

/** "Every pick, every sport (large card): one pass covers…" as a title and the rest, for a list item that has one. */
export function splitItem(item: string): { title: string | null; rest: string } {
  const i = item.indexOf(": ");
  return i > 0 && i <= 60 ? { title: item.slice(0, i), rest: item.slice(i + 2) } : { title: null, rest: item };
}

/** Hex colors named in a line, for a swatch next to it. */
export const hexesIn = (t: string) => t.match(/#[0-9a-f]{6}\b/gi) ?? [];
