/**
 * The intake brief: what the chat collects before it builds anything.
 *
 *  - Questions are asked one per message. Each says how the answer will be read.
 *  - Anything the first sentence already answered is skipped.
 *  - The summary is generated from the brief and the CAPABILITIES list, so the
 *    builder cannot promise something the runtime cannot build yet.
 *  - EDGE_RULES carry lessons from specs/edges.json into onboarding. Each rule is
 *    general (no store details), so every future store gets the warning.
 *
 * Rule-based reading for now. A model can replace `readAnswer` and keep the same
 * StoreBrief shape; the validator below (`readAnswer` returning a patch or a retry)
 * is what keeps its output inside the schema.
 */

import { PRESETS, presetById, type PresetId, type StyleId, type ToneId } from "./storeConfig";
import { STYLE_RULES, TONE_RULES, buildFromIdea } from "./interpret";

export type Fulfilment = "ship" | "pickup" | "both";
export type CatalogSource = "shopify" | "photos" | "later";
export type QId = "what" | "name" | "location" | "fulfilment" | "sites" | "look" | "catalog";

export type StoreBrief = {
  idea: string;
  what?: string;
  presetId?: PresetId;
  /** undefined with "name" settled means: suggest one. */
  name?: string;
  location?: string;
  fulfilment?: Fulfilment;
  pickupSites?: number;
  style?: StyleId;
  tone?: ToneId;
  catalog?: CatalogSource;
  /** Question ids that are answered or skipped. */
  settled: QId[];
};

/* ---------- What the runtime can build ---------- */

export type CapStatus = "available" | "partial" | "planned";
export type Capability = { id: string; label: string; status: CapStatus; note: string };

export const CAPABILITIES: Record<string, Capability> = {
  look: { id: "look", label: "Your look", status: "available", note: "Colours, type and tone chosen to suit your store." },
  storefront: { id: "storefront", label: "Storefront", status: "available", note: "Home page, collections and product pages with photo galleries." },
  policies: { id: "policies", label: "Returns, Help and Contact pages", status: "available", note: "Sample wording until you confirm your own." },
  checkout: { id: "checkout", label: "Cart and checkout", status: "partial", note: "Works end to end, but as a simulated checkout." },
  shipping: { id: "shipping", label: "Shipping", status: "partial", note: "A flat estimate, clearly labelled. Real shipping rates are not available yet." },
  pickup: { id: "pickup", label: "In-store pickup checkout", status: "planned", note: "Pickup choice at checkout and a ready-for-pickup confirmation." },
  multistock: { id: "multistock", label: "Locations sharing one stock count", status: "planned", note: "One product list and one stock count across your shops." },
  shopify: { id: "shopify", label: "Import from Shopify", status: "planned", note: "Bring over products, photos and descriptions, with a fix-up report." },
  photos: { id: "photos", label: "Catalog from your photos", status: "planned", note: "Drop in product photos and review the drafted products." },
  dashboard: { id: "dashboard", label: "Owner area", status: "planned", note: "See orders, edit products and edit policies." },
  payments: { id: "payments", label: "Real payments", status: "planned", note: "Until then the store runs in demo mode and says so." },
};

/** Which capabilities a brief needs. */
export function needsFor(b: StoreBrief): Capability[] {
  const ids = ["look", "storefront", "policies", "checkout", "dashboard", "payments"];
  if (b.fulfilment === "ship" || b.fulfilment === "both") ids.push("shipping");
  if (b.fulfilment === "pickup" || b.fulfilment === "both") ids.push("pickup");
  if ((b.pickupSites ?? 0) > 1) ids.push("multistock");
  if (b.catalog === "shopify") ids.push("shopify");
  if (b.catalog === "photos") ids.push("photos");
  return ids.map((id) => CAPABILITIES[id]);
}

/** Lessons from specs/edges.json, kept general. Each one shows up as a flag in the summary. */
export const EDGE_RULES: { id: string; when: (b: StoreBrief) => boolean; text: string }[] = [
  {
    id: "stock-sync",
    when: (b) => b.fulfilment === "pickup" || b.fulfilment === "both",
    text: "If you sell the same pieces in a shop and online, the website and your till can disagree about stock, and a customer could buy something that is already gone. We should decide how to handle that before you go live.",
  },
  {
    id: "demo-mode",
    when: () => true,
    text: "Until payments are connected the store stays in demo mode and says so, so nobody pays for an order that will not be fulfilled.",
  },
  {
    id: "photo-quality",
    when: (b) => b.catalog === "shopify" || b.catalog === "photos",
    text: "Small or dark photos make a store look unfinished. We'll report any that are too small to use well.",
  },
];

/* ---------- Questions ---------- */

type Reading = { patch: Partial<StoreBrief>; echo: string } | { retry: string };

type Question = {
  id: QId;
  ask: string;
  how: string;
  options?: string[];
  applies?: (b: StoreBrief) => boolean;
  read: (text: string, b: StoreBrief) => Reading;
};

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
const stripQuotes = (s: string) => s.trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();

export const QUESTIONS: Question[] = [
  {
    id: "what",
    ask: "What will you sell?",
    how: "A few words is fine, like “women's clothing” or “handmade ceramics”.",
    read: (text) => {
      const t = text.trim();
      if (!t) return { retry: "Tell me a few words about what you sell." };
      const preset = PRESETS.find((p) => p.match.test(t));
      return {
        patch: { what: t, presetId: preset?.id ?? "general" },
        echo: preset ? `Got it: a ${preset.kind}.` : "Got it. I'll start from a general store and you can shape it.",
      };
    },
  },
  {
    id: "name",
    ask: "What's your store called?",
    how: "Or say “suggest one” and I'll pick a placeholder you can change any time.",
    read: (text) => {
      if (/\b(suggest|you pick|you choose|not sure|don'?t know|no name|surprise)\b/i.test(text)) {
        return { patch: { name: undefined }, echo: "I'll suggest a placeholder name for now." };
      }
      const name = stripQuotes(text).replace(/\.$/, "").slice(0, 40);
      if (!name) return { retry: "What should the store be called? Or say “suggest one”." };
      return { patch: { name }, echo: `Name: ${name}.` };
    },
  },
  {
    id: "location",
    ask: "Which town is it based in?",
    how: "Say “online only” if there's no local base.",
    read: (text) => {
      if (/\b(online only|just online|only online|no shop|no store|nowhere|none)\b/i.test(text)) {
        return { patch: { location: "" }, echo: "Online only, so no town on the page." };
      }
      const loc = titleCase(text.trim().replace(/^(?:we'?re |i'?m )?(?:based )?(?:in|near|around)\s+/i, "").replace(/[.!]+$/, "")).slice(0, 30);
      if (!loc) return { retry: "Which town? Or say “online only”." };
      return { patch: { location: loc }, echo: `Based in ${loc}.` };
    },
  },
  {
    id: "fulfilment",
    ask: "How will customers get their orders?",
    how: "Choose one: shipped to them, pickup in your store, or both.",
    options: ["Shipped", "Pickup in store", "Both"],
    read: (text) => {
      const ship = /\b(ship\w*|deliver\w*|mail\w*|post)\b/i.test(text);
      const pick = /\b(pick\s?-?up|collect\w*|in[- ]store|in[- ]shop|local)\b/i.test(text);
      if (/\bboth\b/i.test(text) || (ship && pick)) return { patch: { fulfilment: "both" }, echo: "Both: shipping and in-store pickup." };
      if (pick) return { patch: { fulfilment: "pickup" }, echo: "In-store pickup." };
      if (ship) return { patch: { fulfilment: "ship" }, echo: "Shipping." };
      return { retry: "I didn't catch that. Is it shipped, pickup in store, or both?" };
    },
  },
  {
    id: "sites",
    ask: "How many pickup locations?",
    how: "A number, like 1 or 2.",
    applies: (b) => b.fulfilment === "pickup" || b.fulfilment === "both",
    read: (text) => {
      const m = text.match(/\b(\d{1,2})\b/);
      const w = Object.keys(WORD_NUM).find((k) => new RegExp(`\\b${k}\\b`, "i").test(text));
      const n = m ? Number(m[1]) : w ? WORD_NUM[w] : /\b(just|only)\s+(a|the)\s+one\b|\bsingle\b/i.test(text) ? 1 : 0;
      if (n < 1 || n > 20) return { retry: "How many pickup locations is that? A number from 1 to 20." };
      return { patch: { pickupSites: n }, echo: `Reading that as ${n} pickup ${n === 1 ? "location" : "locations"}.` };
    },
  },
  {
    id: "look",
    ask: "What look do you want?",
    how: "Modern is clean, contemporary is balanced, antique is classic with serif type. Add a tone if you like: warm, refined or playful.",
    options: ["Modern", "Contemporary", "Antique", "You choose"],
    read: (text) => {
      const style = STYLE_RULES.find(([re]) => re.test(text))?.[1];
      const tone = TONE_RULES.find(([re]) => re.test(text))?.[1];
      if (!style && !tone && !/\b(you choose|you pick|surprise|either|any|not sure|no preference)\b/i.test(text)) {
        return { retry: "Pick a look: modern, contemporary or antique. Or say “you choose”." };
      }
      const bits = [style, tone && `${tone} tone`].filter(Boolean).join(", ");
      return { patch: { style, tone }, echo: bits ? `Look: ${bits}.` : "I'll choose a look that suits your products." };
    },
  },
  {
    id: "catalog",
    ask: "Do you already have your products somewhere?",
    how: "Choose one: on Shopify, photos on your computer, or not yet.",
    options: ["On Shopify", "Photos on my computer", "Not yet"],
    read: (text) => {
      if (/\bshopify\b/i.test(text)) return { patch: { catalog: "shopify" }, echo: "Products are on Shopify." };
      if (/\b(photos?|images?|pictures?|upload|computer|camera)\b/i.test(text)) return { patch: { catalog: "photos" }, echo: "You'll bring photos." };
      if (/\b(not yet|no|none|later|nothing|start|from scratch)\b/i.test(text)) return { patch: { catalog: "later" }, echo: "No products yet, so sample ones for now." };
      return { retry: "Are your products on Shopify, photos on your computer, or not yet?" };
    },
  },
];

const Q = Object.fromEntries(QUESTIONS.map((q) => [q.id, q])) as Record<QId, Question>;

/* ---------- Brief lifecycle ---------- */

/** Start a brief from the first sentence. Whatever it already answers is settled. */
export function seedBrief(idea: string): StoreBrief {
  const text = idea.trim();
  const b: StoreBrief = { idea: text, settled: [] };
  const preset = PRESETS.find((p) => p.match.test(text));
  if (preset) {
    b.what = text;
    b.presetId = preset.id;
    b.settled.push("what");
  }
  const built = buildFromIdea(text).config;
  if (/\b(?:called|named)\b/i.test(text)) {
    b.name = built.name;
    b.settled.push("name");
  }
  if (built.location) {
    b.location = built.location;
    b.settled.push("location");
  }
  const style = STYLE_RULES.find(([re]) => re.test(text))?.[1];
  if (style) {
    b.style = style;
    b.tone = TONE_RULES.find(([re]) => re.test(text))?.[1];
    b.settled.push("look");
  }
  return b;
}

export function nextQuestion(b: StoreBrief): Question | null {
  return QUESTIONS.find((q) => !b.settled.includes(q.id) && (q.applies ? q.applies(b) : true)) ?? null;
}

export function readAnswer(b: StoreBrief, id: QId, text: string): { brief: StoreBrief; echo: string } | { retry: string } {
  const r = Q[id].read(text, b);
  if ("retry" in r) return r;
  return { brief: { ...b, ...r.patch, settled: b.settled.includes(id) ? b.settled : [...b.settled, id] }, echo: r.echo };
}

/** "Just build it": settle everything left and let defaults and assumptions fill in. */
export function settleAll(b: StoreBrief): StoreBrief {
  return { ...b, settled: QUESTIONS.map((q) => q.id) };
}

/** Re-open a question (and any that depend on it). */
export function reopen(b: StoreBrief, id: QId): StoreBrief {
  const drop: QId[] = id === "fulfilment" ? ["fulfilment", "sites"] : [id];
  return { ...b, settled: b.settled.filter((s) => !drop.includes(s)) };
}

export const REOPEN_WORDS: [RegExp, QId][] = [
  [/\b(name|called)\b/i, "name"],
  [/\b(town|location|where|city)\b/i, "location"],
  [/\b(look|style|tone|colou?rs?)\b/i, "look"],
  [/\b(pickup|pick-up|delivery|shipping|ship|fulfil\w*)\b/i, "fulfilment"],
  [/\b(sell|selling|products?|what)\b/i, "what"],
  [/\b(catalog|catalogue|shopify|photos?)\b/i, "catalog"],
];

/** The sentence the existing builder reads, assembled from the brief. */
export function briefToIdea(b: StoreBrief): string {
  const parts = [b.what ?? b.idea];
  if (b.name) parts.push(`called ${b.name}`);
  if (b.location) parts.push(`in ${b.location}`);
  if (b.style) parts.push(b.style);
  if (b.tone) parts.push(b.tone);
  if (b.fulfilment === "pickup" || b.fulfilment === "both") parts.push("local pickup");
  return parts.join(" ");
}

/* ---------- Summary ---------- */

export type BriefSummary = {
  title: string;
  build: string[];
  notYet: { label: string; note: string }[];
  assume: string[];
  need: string[];
  flags: string[];
};

export function summarizeBrief(b: StoreBrief): BriefSummary {
  const cfg = buildFromIdea(briefToIdea(b)).config;
  const preset = presetById(b.presetId ?? cfg.presetId);
  const caps = needsFor(b);
  const build: string[] = [
    `A ${cfg.style} look with a ${cfg.tone} tone for your ${preset.kind}${cfg.location ? ` in ${cfg.location}` : ""}.`,
    `A home page, collections for ${cfg.categories.slice(0, 3).join(", ")}, and product pages.`,
    "A cart and a simulated checkout.",
    "Returns, Help and Contact pages.",
  ];
  if (b.fulfilment === "ship" || b.fulfilment === "both") build.push("Shipping with a flat, clearly labelled estimate.");

  const notYet = caps
    .filter((c) => c.status === "planned")
    .map((c) => ({ label: c.label, note: `${c.note} We'll tell you when it ships.` }));

  const assume: string[] = ["Prices are in US dollars.", "Products are samples until you add yours.", "The returns policy is sample wording until you confirm it."];
  if (!b.name) assume.push(`The name “${cfg.name}” is a placeholder you can change.`);
  if (!b.fulfilment) assume.push("Orders are shipped.");
  if ((b.pickupSites ?? 0) > 1) assume.push("Your locations share one product list and one stock count.");
  if (!b.style) assume.push(`The ${cfg.style} look is my suggestion.`);

  const need: string[] = ["Your returns and exchange policy."];
  if (b.catalog === "shopify") need.unshift("Your Shopify export file.");
  if (b.catalog === "photos") need.unshift("Your product photos.");
  if (b.fulfilment === "pickup" || b.fulfilment === "both") need.push("Each pickup location's address and hours.");
  need.push("Your payment account, once payments open.");

  return {
    title: cfg.name,
    build,
    notYet,
    assume,
    need,
    flags: EDGE_RULES.filter((r) => r.when(b)).map((r) => r.text),
  };
}
