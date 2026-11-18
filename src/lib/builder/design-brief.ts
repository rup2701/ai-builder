/**
 * The design brief (APP-42 step 1): written from the interview and the approved brief before a showcase build, so the build
 * agent gets what the owner said in their own words and a recommended direction, not only the brief's fields.
 *
 * Code chooses and checks; the model only words things:
 *   - the model gives quotes, meanings, messages, reasons, care rules, gaps and the sample card's field names, and picks the
 *     direction by name from the pack's closed lists (runner vertical-packs/product-showcase/direction.json, synced);
 *   - code fills the name, mode, accent and tone from the brief, looks up fonts and weights from the pairing name, numbers the
 *     proposals and gaps, formats the placeholders, and checks every quote word for word against the owner's own messages.
 * Nothing here calls a model or a database. The call and the retry are in src/lib/agents/design-brief-writer.ts.
 */
import { createHash } from "node:crypto";
import { SHOWCASE_DIRECTION_JSON } from "./site-pack.generated";

// ---- the pack's closed lists ----

export type Pairing = { name: string; heading: string; headingWeight: number | "tone"; body: string; accentFont: string | null; capsLabels: boolean; fits: string };
export type DirectionLists = {
  pairings: Pairing[];
  motifs: { name: string; looks: string; goodFor: string }[];
  heroKinds: { name: string; what: string }[];
  signatures: { name: string; what: string }[];
};
export const DIRECTION: DirectionLists = JSON.parse(SHOWCASE_DIRECTION_JSON);

// ---- the interview ----

/** One chat message as the build record keeps it (details.interview.messages). Only owner and Scout text is used. */
export type InterviewMessage = { id?: number; kind?: string; text?: string; options?: string[]; items?: { label?: string; value?: string }[] } & Record<string, unknown>;

/** The interview as the model reads it: one line per message, with its number. Owner lines are the only ones that can be quoted. */
export function interviewText(messages: InterviewMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const n = typeof m.id === "number" ? m.id : null;
    if (n === null) continue;
    if (m.kind === "user" && typeof m.text === "string") lines.push(`[${n}] Owner: ${m.text}`);
    else if (m.kind === "bot" && typeof m.text === "string") lines.push(`[${n}] Scout: ${m.text}${m.options?.length ? ` (buttons: ${m.options.join(" | ")})` : ""}`);
    else if (m.kind === "recap" && Array.isArray(m.items)) lines.push(`[${n}] Scout recap: ${m.items.map((i) => `${i.label}: ${i.value}`).join("; ")}`);
  }
  return lines.join("\n");
}

/** JSON with object keys in a fixed order, so the same brief always gives the same text wherever it was read from. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** The number of the owner's last message, or null when they wrote none. */
export function lastOwnerMsg(messages: InterviewMessage[]): number | null {
  let last: number | null = null;
  for (const m of messages) if (m.kind === "user" && typeof m.id === "number") last = Math.max(last ?? m.id, m.id);
  return last;
}

/**
 * What a design brief was made from (APP-49): the owner's own messages, in order, and the approved brief. Scout's lines are
 * left out, because quotes come only from the owner. upTo limits it to the owner's messages up to that number: a saved brief
 * keeps the number of the last owner message it read, so a later "thanks" does not make it stale. A real change after review
 * makes Scout save the brief again, and the brief is part of the fingerprint.
 */
export function designBriefFingerprint(messages: InterviewMessage[], brief: Record<string, unknown>, upTo: number | null = null): string {
  const owner = messages
    .filter((m) => m.kind === "user" && typeof m.text === "string" && (upTo === null || (typeof m.id === "number" && m.id <= upTo)))
    .map((m) => [m.id ?? null, m.text]);
  return createHash("sha256").update(canonical({ owner, brief })).digest("hex").slice(0, 32);
}

/** Case, spacing and curly quotes do not count when a quote is compared with the interview. */
export const normalizeQuote = (s: string) =>
  s.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, "");

// ---- what the model returns (the tool input) ----

export type Quoted = { quote: string; msg: number };

/** What a reference may teach, from creative.md section 5. Never its layout measurements, wording, logos, art or exact palette. */
export const REFERENCE_LESSONS = ["pace", "density", "contrast", "hero", "proof", "motion"] as const;
export type ReferenceLesson = (typeof REFERENCE_LESSONS)[number];
const LESSON_WORDS: Record<ReferenceLesson, string> = {
  pace: "pace (how much per screen)",
  density: "density",
  contrast: "contrast between headline and body",
  hero: "how the hero presents the product",
  proof: "how proof is shown",
  motion: "how motion is used",
};

/** A placeholder is one short label for one thing only the owner can supply: at most 8 words, not a sentence. */
export const PLACEHOLDER_MAX_WORDS = 8;
type Choice = { value: string; why: string };

export type ModelDesignBrief = {
  name: Quoted | null;
  audience: ({ value: string; meaning?: string } & Quoted)[];
  voice: { summary: string; quotes: Quoted[] };
  owner_facts: ({ topic: string; meaning: string } & Quoted)[];
  messages: ({ text: string } & Quoted)[];
  plans: ({ name: string; price: string | null; length: string | null; highlight: boolean; highlight_quote: Quoted | null } & Quoted)[];
  look_quotes: { mode: Quoted | null; accent: Quoted | null; tone: Quoted | null };
  /** Sites, apps or brands the owner named as inspiration, with what to learn from each (creative.md section 5). */
  references: ({ name: string; learn: ReferenceLesson[] } & Quoted)[];
  direction: { pairing: Choice; motif: Choice; hero_kind: Choice; signatures: Choice[] };
  sample_card: { item: string; fields: { label: string; filler: string }[] };
  care: { flag: string; rule: string }[];
  placeholders: { slot: string; what: string }[];
  other_proposals: { field: string; value: string; why: string }[];
  gaps: { question: string; affects: string[] }[];
};

const quoted = { type: "object", properties: { quote: { type: "string", description: "Words copied exactly from one Owner line." }, msg: { type: "integer", description: "The number of that Owner line." } }, required: ["quote", "msg"] };
const quotedOrNull = { anyOf: [quoted, { type: "null" }] };
const choice = (names: string[]) => ({ type: "object", properties: { value: { type: "string", enum: names }, why: { type: "string" } }, required: ["value", "why"] });

export const DESIGN_BRIEF_TOOL = {
  name: "write_design_brief",
  description: "Write the whole design brief once.",
  input_schema: {
    type: "object",
    properties: {
      name: { ...quotedOrNull, description: "Where the owner named the product, or null." },
      audience: { type: "array", items: { type: "object", properties: { value: { type: "string" }, meaning: { type: "string" }, ...quoted.properties }, required: ["value", ...quoted.required] } },
      voice: { type: "object", properties: { summary: { type: "string", description: "How the page should sound, in one or two plain sentences." }, quotes: { type: "array", items: quoted } }, required: ["summary", "quotes"] },
      owner_facts: { type: "array", description: "Facts the owner gave, including plain expansions of their words.", items: { type: "object", properties: { topic: { type: "string" }, meaning: { type: "string" }, ...quoted.properties }, required: ["topic", "meaning", ...quoted.required] } },
      messages: { type: "array", description: "Two to four messages to lead with, close to the owner's words.", items: { type: "object", properties: { text: { type: "string" }, ...quoted.properties }, required: ["text", ...quoted.required] } },
      plans: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, price: { type: ["string", "null"] }, length: { type: ["string", "null"] }, highlight: { type: "boolean" }, highlight_quote: quotedOrNull, ...quoted.properties },
          required: ["name", "price", "length", "highlight", "highlight_quote", ...quoted.required],
        },
      },
      look_quotes: { type: "object", properties: { mode: quotedOrNull, accent: quotedOrNull, tone: quotedOrNull }, required: ["mode", "accent", "tone"] },
      references: {
        type: "array",
        description: "Sites, apps or brands the owner named as inspiration or as a look they like. Empty if they named none.",
        items: {
          type: "object",
          properties: { name: { type: "string" }, learn: { type: "array", minItems: 1, items: { type: "string", enum: [...REFERENCE_LESSONS] } }, ...quoted.properties },
          required: ["name", "learn", ...quoted.required],
        },
      },
      direction: {
        type: "object",
        properties: {
          pairing: choice(DIRECTION.pairings.map((p) => p.name)),
          motif: choice(DIRECTION.motifs.map((m) => m.name)),
          hero_kind: choice(DIRECTION.heroKinds.map((h) => h.name)),
          signatures: { type: "array", minItems: 1, maxItems: 2, items: choice(DIRECTION.signatures.map((s) => s.name)) },
        },
        required: ["pairing", "motif", "hero_kind", "signatures"],
      },
      sample_card: {
        type: "object",
        properties: { item: { type: "string" }, fields: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", properties: { label: { type: "string" }, filler: { type: "string" } }, required: ["label", "filler"] } } },
        required: ["item", "fields"],
      },
      care: { type: "array", items: { type: "object", properties: { flag: { type: "string" }, rule: { type: "string" } }, required: ["flag", "rule"] } },
      placeholders: {
        type: "array",
        description: "Only things the owner alone can supply, such as a legal notice. One short label each, not a sentence.",
        items: { type: "object", properties: { slot: { type: "string" }, what: { type: "string", description: `A label of at most ${PLACEHOLDER_MAX_WORDS} words, no full stop.` } }, required: ["slot", "what"] },
      },
      other_proposals: { type: "array", items: { type: "object", properties: { field: { type: "string" }, value: { type: "string" }, why: { type: "string" } }, required: ["field", "value", "why"] } },
      gaps: { type: "array", items: { type: "object", properties: { question: { type: "string" }, affects: { type: "array", items: { type: "string" } } }, required: ["question", "affects"] } },
    },
    required: ["name", "audience", "voice", "owner_facts", "messages", "plans", "look_quotes", "references", "direction", "sample_card", "care", "placeholders", "other_proposals", "gaps"],
  },
} as const;

export function designBriefSystem(): string {
  const lists = {
    pairings: DIRECTION.pairings.map((p) => `${p.name}: headings ${p.heading}, text ${p.body}. Fits ${p.fits}.`),
    motifs: DIRECTION.motifs.map((m) => `${m.name}: ${m.looks}. Good for ${m.goodFor}.`),
    hero_kinds: DIRECTION.heroKinds.map((h) => `${h.name}: ${h.what}.`),
    signatures: DIRECTION.signatures.map((s) => `${s.name}: ${s.what}.`),
  };
  return `You write the design brief for one website, before it is built. You get the interview between the owner and Scout (the builder's interviewer) and the brief Scout wrote, which the owner approved. The build agent never sees the interview, so this brief carries the owner's own words to it. Call the write_design_brief tool once with the whole brief.

Rules:
1. Every owner fact carries a quote: words copied exactly, character for character, from one line marked Owner, and that line's number. Keep the owner's spelling and typos inside a quote. Never quote a Scout line. Keep quotes short: the few words that carry the fact, and at least 3 words or 12 characters. Only a name, a colour mode, a colour or a tone may be shorter. A bare "yes" or "ok" is never a quote: quote more of the owner's line, or leave the item out.
2. No new facts about the business. No numbers, results, records, names, prices, dates, customers or promises the owner did not give. Write a number only if the owner typed it. Names the owner gave are kept, including sites, apps or brands they named as inspiration (see references).
3. When the owner's words plainly expand (for example "all 4 major leagues in America" means NFL, NBA, MLB and NHL), put it in owner_facts with the quote and the plain meaning. That is the owner's fact, not a proposal.
4. When the owner agreed to something Scout suggested (for example "yes, that's about right"), quote the owner's agreement and say in the meaning what they agreed to.
5. Anything you suggest that the owner did not say is a proposal with a one-line reason: the direction choices, and anything in other_proposals.
6. What is missing is a gap: one plain question for the owner. Never fill a gap with a guess.
7. Sensitive topics (money, betting, health, legal, children, personal data) get care rules: the claims the site must not make. A notice only the owner can write (eligibility, a disclaimer) is a placeholder, never drafted by you. A placeholder is one short label for one thing only the owner can supply, at most ${PLACEHOLDER_MAX_WORDS} words and not a sentence, for example "Age and responsible-gambling notice". It is shown on the page as it is. Notes for the builder (links not set yet, a concept preview, pages that do not exist) are never placeholders: the brief and the pack already handle them.
8. Direction: choose exactly one pairing, one motif, one hero kind and one or two signatures, by name, from the lists below only. Choose what fits the product, the audience and the tone. owner-art only if the brief has an image the owner supplied.
9. Plans: copy name, price and length as the owner gave them. highlight is true only if the owner asked for a plan to stand out, with highlight_quote where they asked. Otherwise highlight is false and highlight_quote is null. Equal plans get equal treatment.
10. look_quotes: where the owner chose the colour mode, the colour and the tone, or null.
11. references: every site, app or brand the owner named as inspiration or as a look they like, with the owner's quote (it must contain the name as the owner wrote it) and what to learn from it, from this list only: ${REFERENCE_LESSONS.join(", ")}. Choose the lessons that match what the owner said about it; if they said only that they like it, choose pace, density and hero. Never more than that: a reference sets a direction, it is never copied.
12. sample_card: what one item in the hero preview is (for a picks product, one pick) and two to four field labels with plainly generic filler, such as AWAY @ HOME, League, 0.0, Name or Date. No real names and no digits other than 0. Every sample card is marked Sample on the page.
13. Plain, short words. The readers are a build agent and the owner, who is not technical.

The lists (use these names exactly):
${JSON.stringify(lists, null, 2)}`;
}

export function designBriefUser(messages: InterviewMessage[], brief: Record<string, unknown>): string {
  return `The interview. Each line starts with its number and who wrote it.\n\n${interviewText(messages)}\n\nThe brief Scout wrote and the owner approved:\n\n${JSON.stringify(brief, null, 2)}`;
}

// ---- the saved design brief ----

export type DesignBrief = {
  version: 1;
  name: { value: string; quote: string | null; msg: number | null };
  audience: ModelDesignBrief["audience"];
  voice: ModelDesignBrief["voice"];
  owner_facts: ModelDesignBrief["owner_facts"];
  messages: ModelDesignBrief["messages"];
  plans: ModelDesignBrief["plans"];
  look: {
    mode: { value: string | null; quote: string | null; msg: number | null };
    accent: { value: string | null; quote: string | null; msg: number | null };
    tone: { value: string | null; quote: string | null; msg: number | null };
  };
  references: ModelDesignBrief["references"];
  direction: {
    pairing: { value: string; proposal: string };
    motif: { value: string; proposal: string };
    hero_kind: { value: string; proposal: string };
    signatures: { value: string; proposal: string }[];
    /** Looked up by code from the pairing name, never written by the model. */
    fonts: { heading: string; body: string; accent: string | null; headingWeight: number | "tone"; capsLabels: boolean } | null;
  };
  sample_card: ModelDesignBrief["sample_card"] & { marked: "Sample" };
  care: ModelDesignBrief["care"];
  /** label is the model's words; text is what the page shows, formatted by code. */
  placeholders: { slot: string; label: string; text: string }[];
  proposals: { id: string; field: string; value: string; why: string }[];
  gaps: { id: string; question: string; affects: string[] }[];
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const q = (v: unknown): Quoted | null => {
  const o = v as Partial<Quoted> | null;
  return o && typeof o === "object" && typeof o.quote === "string" && o.quote.trim() ? { quote: o.quote, msg: Number(o.msg) } : null;
};

/** The look values come from the approved brief, not the model. */
function lookFromBrief(brief: Record<string, unknown>) {
  const look = (brief.look ?? {}) as { mode?: string; accent?: string; tone?: string };
  const brand = (brief.brand ?? {}) as { color?: string; tone?: string };
  return { mode: look.mode ?? brand.color ?? null, accent: look.accent ?? null, tone: look.tone ?? brand.tone ?? null };
}

/** Turns the model's answer into the saved shape. Code numbers the proposals and gaps, formats the placeholders and looks up the fonts. */
export function assembleDesignBrief(raw: unknown, brief: Record<string, unknown>): DesignBrief {
  const m = (raw ?? {}) as Partial<ModelDesignBrief>;
  const site = (brief.site ?? {}) as { name?: string };
  const lv = lookFromBrief(brief);
  const lq = (m.look_quotes ?? {}) as ModelDesignBrief["look_quotes"];
  const d = (m.direction ?? {}) as Partial<ModelDesignBrief["direction"]>;
  const proposals: DesignBrief["proposals"] = [];
  const propose = (field: string, c: Partial<Choice> | undefined) => {
    const id = `p${proposals.length + 1}`;
    proposals.push({ id, field, value: str(c?.value), why: str(c?.why) });
    return { value: str(c?.value), proposal: id };
  };
  const pairing = propose("direction.pairing", d.pairing);
  const motif = propose("direction.motif", d.motif);
  const hero_kind = propose("direction.hero_kind", d.hero_kind);
  const signatures = arr<Choice>(d.signatures).map((s) => propose("direction.signature", s));
  for (const p of arr<{ field?: string; value?: string; why?: string }>(m.other_proposals)) proposals.push({ id: `p${proposals.length + 1}`, field: str(p.field), value: str(p.value), why: str(p.why) });
  const pair = DIRECTION.pairings.find((p) => p.name === pairing.value);
  const nameQ = q(m.name);
  const lookQ = (x: unknown, value: string | null) => {
    const y = q(x);
    return { value, quote: y?.quote ?? null, msg: y ? y.msg : null };
  };
  const sc = (m.sample_card ?? {}) as Partial<ModelDesignBrief["sample_card"]>;
  return {
    version: 1,
    name: { value: str(site.name), quote: nameQ?.quote ?? null, msg: nameQ ? nameQ.msg : null },
    audience: arr(m.audience),
    voice: { summary: str(m.voice?.summary), quotes: arr<Quoted>(m.voice?.quotes) },
    owner_facts: arr(m.owner_facts),
    messages: arr(m.messages),
    plans: arr<ModelDesignBrief["plans"][number]>(m.plans).map((p) => ({ ...p, highlight: p.highlight === true && !!q(p.highlight_quote), highlight_quote: p.highlight === true ? q(p.highlight_quote) : null })),
    look: { mode: lookQ(lq.mode, lv.mode), accent: lookQ(lq.accent, lv.accent), tone: lookQ(lq.tone, lv.tone) },
    references: arr<ModelDesignBrief["references"][number]>(m.references).map((r) => ({
      name: str(r.name),
      learn: [...new Set(arr<string>(r.learn).map(String))] as ReferenceLesson[],
      quote: typeof r.quote === "string" ? r.quote : "",
      msg: Number(r.msg),
    })),
    direction: {
      pairing,
      motif,
      hero_kind,
      signatures,
      fonts: pair ? { heading: pair.heading, body: pair.body, accent: pair.accentFont, headingWeight: pair.headingWeight, capsLabels: pair.capsLabels } : null,
    },
    sample_card: { item: str(sc.item), fields: arr<{ label: string; filler: string }>(sc.fields).map((f) => ({ label: str(f.label), filler: str(f.filler) })), marked: "Sample" },
    care: arr<{ flag: string; rule: string }>(m.care).map((c) => ({ flag: str(c.flag), rule: str(c.rule) })),
    placeholders: arr<{ slot: string; what: string }>(m.placeholders).map((p) => {
      const label = str(p.what).replace(/[[\]]/g, "").replace(/[.\s]+$/, "");
      return { slot: str(p.slot), label, text: `[${label}: owner to supply]` };
    }),
    proposals,
    gaps: arr<{ question: string; affects: string[] }>(m.gaps).map((g, i) => ({ id: `g${i + 1}`, question: str(g.question), affects: arr<string>(g.affects).map(String) })),
  };
}

// ---- the checks ----

export type QuoteFailure = { path: string; quote: string; msg: number | null; why: "empty" | "too short" | "not in an owner message" };

/** Replies that carry no fact of their own. Never enough as a quote, even where a short quote is allowed. */
const TRIVIAL = new Set(["yes", "ok", "okay", "sure", "correct", "right", "yep", "yeah", "no", "fine", "good", "done", "great"]);

/**
 * A quote must carry the fact: at least 3 words or 12 characters. Short owner values are allowed where the quote is the
 * value itself: the product name (when the quote holds the name) and the colour mode, colour and tone (for example "Dark",
 * "orange", "#F97316"). A bare "yes" or "ok" never passes.
 */
export function quoteTooShort(path: string, quote: string, db: DesignBrief): boolean {
  const t = quote.replace(/\s+/g, " ").trim();
  const bare = t.toLowerCase().replace(/[^a-z0-9#' ]/g, "").trim();
  if (TRIVIAL.has(bare)) return true;
  if (t.split(" ").length >= 3 || t.length >= 12) return false;
  if (path === "name") return !(db.name.value && normalizeQuote(t).includes(normalizeQuote(db.name.value)));
  if (path.startsWith("look.")) return false;
  // A site or brand the owner named may be quoted on its own, as long as the quote holds that name.
  const ref = /^references\[(\d+)\]$/.exec(path);
  if (ref) {
    const name = db.references[Number(ref[1])]?.name ?? "";
    return !(name && normalizeQuote(t).includes(normalizeQuote(name)));
  }
  return true;
}
export type QuoteCheck = {
  checked: number;
  passed: number;
  failed: QuoteFailure[];
  /** Quotes found word for word, but in another owner message than the one cited: code sets the right number. */
  msgCorrected: number;
};
export type CheckResult = { quoteCheck: QuoteCheck; problems: string[]; ok: boolean };

/** Every quote in the design brief, with where it sits, so the check and its report can name it. */
function quotesIn(db: DesignBrief): { path: string; ref: { quote: string | null; msg: number | null } }[] {
  const out: { path: string; ref: { quote: string | null; msg: number | null } }[] = [];
  if (db.name.quote !== null) out.push({ path: "name", ref: db.name });
  db.audience.forEach((x, i) => out.push({ path: `audience[${i}]`, ref: x }));
  db.voice.quotes.forEach((x, i) => out.push({ path: `voice.quotes[${i}]`, ref: x }));
  db.owner_facts.forEach((x, i) => out.push({ path: `owner_facts[${i}]`, ref: x }));
  db.messages.forEach((x, i) => out.push({ path: `messages[${i}]`, ref: x }));
  db.plans.forEach((x, i) => {
    out.push({ path: `plans[${i}]`, ref: x });
    if (x.highlight_quote) out.push({ path: `plans[${i}].highlight_quote`, ref: x.highlight_quote });
  });
  for (const k of ["mode", "accent", "tone"] as const) if (db.look[k].quote !== null) out.push({ path: `look.${k}`, ref: db.look[k] });
  db.references.forEach((x, i) => out.push({ path: `references[${i}]`, ref: x }));
  return out;
}

/** Text the model wrote (not quotes, not values code filled in). Numbers in it must come from the owner. */
function writtenText(db: DesignBrief): string[] {
  return [
    ...db.audience.flatMap((a) => [a.value, a.meaning ?? ""]),
    db.voice.summary,
    ...db.owner_facts.flatMap((f) => [f.topic, f.meaning]),
    ...db.messages.map((m) => m.text),
    ...db.plans.flatMap((p) => [p.name, p.price ?? "", p.length ?? ""]),
    ...db.proposals.flatMap((p) => [p.value, p.why]),
    db.sample_card.item,
    ...db.sample_card.fields.map((f) => f.label),
    ...db.care.flatMap((c) => [c.flag, c.rule]),
    ...db.placeholders.map((p) => p.text),
    ...db.gaps.map((g) => g.question),
    ...db.references.map((r) => r.name),
  ];
}

const numbers = (s: string) => (s.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));

/**
 * Checks the design brief against the interview. Quotes: each must be long enough to carry the fact (quoteTooShort) and
 * appear word for word (ignoring case and spacing) in an owner message; one found in another owner message than the one cited gets the right number. Direction: names from the
 * closed lists only. Numbers: any number the model wrote must be one the owner typed or one in the approved brief. Sample filler: no digits but 0.
 * Changes msg numbers in place; everything else is only reported.
 */
export function checkDesignBrief(db: DesignBrief, messages: InterviewMessage[], brief: Record<string, unknown>): CheckResult {
  const owner = messages.filter((m) => m.kind === "user" && typeof m.text === "string" && typeof m.id === "number").map((m) => ({ id: m.id as number, text: normalizeQuote(m.text as string) }));
  const quoteCheck: QuoteCheck = { checked: 0, passed: 0, failed: [], msgCorrected: 0 };
  for (const { path, ref } of quotesIn(db)) {
    quoteCheck.checked++;
    const n = normalizeQuote(ref.quote ?? "");
    if (!n) {
      quoteCheck.failed.push({ path, quote: ref.quote ?? "", msg: ref.msg, why: "empty" });
      continue;
    }
    if (quoteTooShort(path, ref.quote ?? "", db)) {
      quoteCheck.failed.push({ path, quote: ref.quote ?? "", msg: ref.msg, why: "too short" });
      continue;
    }
    const cited = owner.find((o) => o.id === ref.msg);
    if (cited?.text.includes(n)) {
      quoteCheck.passed++;
      continue;
    }
    const other = owner.find((o) => o.text.includes(n));
    if (other) {
      ref.msg = other.id;
      quoteCheck.msgCorrected++;
      quoteCheck.passed++;
      continue;
    }
    quoteCheck.failed.push({ path, quote: ref.quote ?? "", msg: ref.msg, why: "not in an owner message" });
  }

  const problems: string[] = [];
  const d = db.direction;
  if (!DIRECTION.pairings.some((p) => p.name === d.pairing.value)) problems.push(`direction.pairing "${d.pairing.value}" is not a pairing in the list`);
  if (!DIRECTION.motifs.some((p) => p.name === d.motif.value)) problems.push(`direction.motif "${d.motif.value}" is not a motif in the list`);
  if (!DIRECTION.heroKinds.some((p) => p.name === d.hero_kind.value)) problems.push(`direction.hero_kind "${d.hero_kind.value}" is not a hero kind in the list`);
  if (d.signatures.length < 1 || d.signatures.length > 2) problems.push("direction.signatures needs one or two names");
  for (const s of d.signatures) if (!DIRECTION.signatures.some((x) => x.name === s.value)) problems.push(`direction.signatures "${s.value}" is not a signature in the list`);
  if (new Set(d.signatures.map((s) => s.value)).size !== d.signatures.length) problems.push("direction.signatures repeats a name");
  if (d.hero_kind.value === "owner-art" && !ownerImage(brief)) problems.push("direction.hero_kind is owner-art, but the owner supplied no image");
  for (const p of db.proposals) if (!p.why) problems.push(`proposal ${p.id} (${p.field}) has no reason`);
  if (db.audience.length === 0) problems.push("audience is empty");
  if (db.messages.length === 0) problems.push("messages is empty");
  if (db.sample_card.fields.length < 2) problems.push("sample_card needs two to four fields");

  // A number is the owner's when they typed it, or when it is in the brief they approved (for example a plan length Scout asked about and the owner confirmed).
  const ownerNumbers = new Set([...owner.flatMap((o) => numbers(messages.find((m) => m.id === o.id)!.text as string)), ...numbers(JSON.stringify(brief))]);
  ownerNumbers.add("0");
  const invented = new Set<string>();
  for (const t of writtenText(db)) for (const n of numbers(t)) if (!ownerNumbers.has(n)) invented.add(n);
  if (invented.size) problems.push(`numbers the owner never typed: ${[...invented].join(", ")}`);
  for (const f of db.sample_card.fields) if (/[1-9]/.test(f.filler)) problems.push(`sample_card filler "${f.filler}" has a digit other than 0`);
  for (const p of db.plans) if (p.highlight && !p.highlight_quote) problems.push(`plan "${p.name}" is highlighted without the owner asking`);

  // References: the owner's quote holds the name, and the lessons come from creative.md's list only.
  db.references.forEach((r, i) => {
    if (!r.name) problems.push(`references[${i}] has no name`);
    else if (!normalizeQuote(r.quote).includes(normalizeQuote(r.name))) problems.push(`references[${i}] "${r.name}": the quote does not hold the name as the owner wrote it`);
    if (!r.learn.length) problems.push(`references[${i}] "${r.name}" says nothing to learn from it`);
    for (const l of r.learn) if (!(REFERENCE_LESSONS as readonly string[]).includes(l)) problems.push(`references[${i}] "${r.name}": "${l}" is not one of ${REFERENCE_LESSONS.join(", ")}`);
  });

  // Placeholders are shown on the page as they are: one short label each, never a sentence or a note for the builder.
  db.placeholders.forEach((p, i) => {
    const words = p.label.split(/\s+/).filter(Boolean).length;
    if (!words) problems.push(`placeholders[${i}] is empty`);
    else if (words > PLACEHOLDER_MAX_WORDS) problems.push(`placeholders[${i}] "${p.label}" has ${words} words; a placeholder is a label of at most ${PLACEHOLDER_MAX_WORDS} words`);
    if (/[.!?;:]/.test(p.label)) problems.push(`placeholders[${i}] "${p.label}" is a sentence or a note; a placeholder is one short label, with no full stop`);
  });

  return { quoteCheck, problems, ok: quoteCheck.failed.length === 0 && problems.length === 0 };
}

function ownerImage(brief: Record<string, unknown>): boolean {
  const hero = (arr<{ type?: string; visual?: { image?: unknown } }>(brief.blocks)).find((b) => b.type === "hero");
  return !!hero?.visual?.image;
}

/** What the model is told when its first answer did not pass, so the one retry can fix exactly that. */
export function retryNote(r: CheckResult): string {
  const lines = [
    ...r.quoteCheck.failed.map((f) =>
      f.why === "too short"
        ? `- ${f.path}: the quote "${f.quote}" is too short to carry the fact. Quote at least 3 words or 12 characters of the owner's own line (a bare yes or ok is never enough), or leave the item out.`
        : `- ${f.path}: the quote "${f.quote}" is ${f.why === "empty" ? "empty" : "not word for word in any Owner line"}. Copy the owner's exact words, or leave the item out.`),
    ...r.problems.map((p) => `- ${p}`),
  ];
  return `The design brief did not pass the checks:\n${lines.join("\n")}\nCall write_design_brief again with the whole corrected brief.`;
}

// ---- specs/design-brief.md ----

/** A sentence ends with exactly one full stop, whether or not the model wrote one. */
const end = (t: string) => `${t.trim().replace(/[.\s]+$/, "")}.`;
const bare = (t: string) => t.trim().replace(/[.\s]+$/, "");

const said = (x: { quote: string | null; msg: number | null }) => (x.quote ? ` Owner said: "${x.quote.replace(/\s+/g, " ").trim()}" (message ${x.msg}).` : "");

/** The design brief in plain words, for specs/design-brief.md. The build agent reads it after creative.md. */
export function renderDesignBrief(db: DesignBrief): string {
  const out: string[] = [];
  const p = (s = "") => out.push(s);
  const why = (id: string) => db.proposals.find((x) => x.id === id)?.why ?? "";
  p(`# Design brief: ${db.name.value || "this site"}`);
  p();
  p("Written from the interview before the build. Quotes are the owner's exact words from the chat. \"Our proposal\" is our suggestion, not something the owner said. Gaps are open questions: do not answer them on the page. specs/brief.json stays the source of the site's facts and text.");
  p();
  p("## Audience and voice");
  p();
  for (const a of db.audience) p(`- ${end(a.meaning ? `${bare(a.value)}: ${a.meaning}` : a.value)}${said(a)}`);
  if (db.voice.summary) p(`- Voice: ${end(db.voice.summary)}${db.voice.quotes.map((x) => said(x)).join("")}`);
  p();
  if (db.owner_facts.length) {
    p("## What the owner told us");
    p();
    for (const f of db.owner_facts) p(`- ${bare(f.topic)}: ${end(f.meaning)}${said(f)}`);
    p();
  }
  p("## Messages to lead with");
  p();
  db.messages.forEach((m, i) => p(`${i + 1}. ${end(m.text)}${said(m)}`));
  p();
  if (db.plans.length) {
    p("## Plans");
    p();
    for (const x of db.plans) p(`- ${x.name}${x.price ? `, ${x.price}` : ""}${x.length ? `, ${x.length}` : ""}.${said(x)}${x.highlight && x.highlight_quote ? ` Highlighted because the owner asked.${said(x.highlight_quote)}` : ""}`);
    if (!db.plans.some((x) => x.highlight)) p("- No plan is highlighted and no plan gets a badge. The owner did not ask for one. Equal plans get equal treatment.");
    p();
  }
  p("## Look");
  p();
  if (db.look.mode.value) p(`- Colour mode: ${db.look.mode.value}.${said(db.look.mode)}`);
  if (db.look.accent.value) p(`- Accent colour: ${db.look.accent.value}, the one accent on the page.${said(db.look.accent)}`);
  if (db.look.tone.value) p(`- Tone: ${db.look.tone.value}.${said(db.look.tone)}`);
  for (const r of db.references) p(`- A site the owner likes: ${r.name}. Learn only ${r.learn.map((l) => LESSON_WORDS[l] ?? l).join(", ")} from it. Never copy its layout, wording, logos, art or exact palette.${said(r)}`);
  p();
  p("## Recommended direction (our proposal)");
  p();
  const f = db.direction.fonts;
  p(`- Font pairing: ${db.direction.pairing.value}${f ? ` (headings ${f.heading}${typeof f.headingWeight === "number" ? ` at ${f.headingWeight}` : ""}, text ${f.body}${f.accent ? `, labels ${f.accent}` : ""}${f.capsLabels ? ", uppercase nav and labels" : ""})` : ""}. Why: ${why(db.direction.pairing.proposal)}`);
  p(`- Motif: ${db.direction.motif.value}. Why: ${why(db.direction.motif.proposal)}`);
  p(`- Hero: ${db.direction.hero_kind.value}. Why: ${why(db.direction.hero_kind.proposal)}`);
  for (const s of db.direction.signatures) p(`- Signature: ${s.value}. Why: ${why(s.proposal)}`);
  if (db.sample_card.fields.length) p(`- Sample cards in the hero: each shows ${db.sample_card.item || "one item"}, with ${db.sample_card.fields.map((x) => `${x.label} (filler: ${x.filler})`).join(", ")}. Filler stays generic, and every sample card carries a visible Sample label.`);
  p();
  const others = db.proposals.filter((x) => !x.field.startsWith("direction."));
  if (others.length) {
    p("## Other proposals");
    p();
    for (const x of others) p(`- ${bare(x.value)} (${x.field}). Why: ${end(x.why)}`);
    p();
  }
  if (db.care.length || db.placeholders.length) {
    p("## Handle with care");
    p();
    for (const c of db.care) p(`- ${bare(c.flag)}: ${end(c.rule)}`);
    for (const x of db.placeholders) p(`- Show this placeholder, never drafted text: ${x.text} (${x.slot}).`);
    p();
  }
  if (db.gaps.length) {
    p("## Gaps: questions for the owner");
    p();
    p("Do not answer these on the page. Leave the item out, or show a marked placeholder.");
    p();
    for (const g of db.gaps) p(`- ${g.question}`);
    p();
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
