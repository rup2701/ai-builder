/**
 * Turns words into store changes.
 *
 * This is rule-based on purpose for the first version: it is instant, free and
 * predictable, and it returns the same shape a language model will return later.
 * To swap in a model, replace the two exported functions and keep their signatures.
 */

import {
  PRESETS,
  buildConfig,
  contrast,
  headlineFor,
  mix,
  presetById,
  subheadFor,
  trustFor,
  type StoreConfig,
  type StyleId,
  type ToneId,
} from "./storeConfig";

const COLORS: Record<string, string> = {
  sage: "#7a9a7e", green: "#3f7a52", forest: "#2f5d46", olive: "#6b7a3a", mint: "#6fb39a",
  teal: "#2f7a7a", ocean: "#2c6e91", navy: "#24385e", blue: "#2f5fa0", sky: "#5b9bd5",
  lavender: "#8a79b8", purple: "#6b4a8a", plum: "#7b3f61", pink: "#d27a96", blush: "#d9a79a",
  rose: "#b85a73", red: "#b3382c", terracotta: "#b4644a", clay: "#b4644a", rust: "#a8502e",
  orange: "#d0702f", mustard: "#c9a227", gold: "#b8923a", yellow: "#d4b320", brown: "#6b4a35",
  chocolate: "#5a3a2a", charcoal: "#333a40", black: "#1a1a1a", grey: "#6b7075", gray: "#6b7075",
};
const COLOR_WORDS = Object.keys(COLORS).sort((a, b) => b.length - a.length);
const COLOR_RE = new RegExp(`(?:\\b(dark|deep|light|soft|pale)\\s+)?\\b(${COLOR_WORDS.join("|")})\\b`, "i");

function pickColor(text: string): { hex: string; label: string } | null {
  const hexMatch = text.match(/#([0-9a-f]{6})\b/i);
  if (hexMatch) return { hex: `#${hexMatch[1].toLowerCase()}`, label: `#${hexMatch[1].toLowerCase()}` };
  const m = text.match(COLOR_RE);
  if (!m) return null;
  const base = COLORS[m[2].toLowerCase()];
  const adj = m[1]?.toLowerCase();
  if (adj === "dark" || adj === "deep") return { hex: mix(base, "#000000", 0.28), label: `${adj} ${m[2].toLowerCase()}` };
  if (adj === "light" || adj === "soft" || adj === "pale") return { hex: mix(base, "#ffffff", 0.3), label: `${adj} ${m[2].toLowerCase()}` };
  return { hex: base, label: m[2].toLowerCase() };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function cleanQuote(s: string): string {
  return s.trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();
}

const noPeriod = (s: string): string => s.replace(/\.$/, "").trim();

export const STYLE_RULES: [RegExp, StyleId][] = [
  [/\b(modern|minimal(?:ist)?|clean|sleek)\b/i, "modern"],
  [/\b(antique|vintage|classic|old[- ]world|heritage|traditional|ornate)\b/i, "antique"],
  [/\bcontemporary\b/i, "contemporary"],
];
export const TONE_RULES: [RegExp, ToneId][] = [
  [/\b(playful|fun|colou?rful|bold|quirky|bright|cheerful)\b/i, "playful"],
  [/\b(luxur\w+|elegant|refined|upscale|chic|sophisticated|high[- ]end|premium)\b/i, "refined"],
  [/\b(cozy|cosy|warm(?:er)?|friendly|rustic|homey|handmade|hand-made)\b/i, "warm"],
];

/* ---------- Idea to first store ---------- */

export function buildFromIdea(idea: string): { config: StoreConfig; lines: string[] } {
  const text = idea.trim();
  const preset = PRESETS.find((p) => p.match.test(text)) ?? presetById("general");

  const nameMatch = text.match(
    /\b(?:called|named)\s+["“'‘]?([A-Za-z0-9][A-Za-z0-9&' .-]{1,30}?)["”'’]?(?=[.,;!?]|\s+(?:that|which|where|for|and|selling|with|in)\b|$)/i,
  );
  const locMatch = text.match(/\b(?:[Ii]n|[Nn]ear|[Aa]round)\s+((?:[A-Z][a-zA-Z.'-]+)(?:\s+[A-Z][a-zA-Z.'-]+){0,2})/);
  const style = STYLE_RULES.find(([re]) => re.test(text))?.[1];
  const tone = TONE_RULES.find(([re]) => re.test(text))?.[1];
  const color = pickColor(text);
  const dark = /\b(dark mode|dark theme|moody|dark background)\b/i.test(text);
  const pickup = /\b(pickup|pick-up|pick up|local delivery|local pickup)\b/i.test(text);

  const config = buildConfig({
    presetId: preset.id,
    seed: hash(text),
    name: nameMatch ? cleanQuote(nameMatch[1]) : undefined,
    location: locMatch?.[1],
    style,
    tone,
    dark,
    accent: color?.hex,
    pickup,
  });

  const lines = [
    `Looks like a ${preset.kind}${config.location ? ` in ${config.location}` : ""}.`,
    nameMatch ? `Name: ${config.name}.` : `Name: ${config.name}, as a suggestion. Rename it any time.`,
    `Look: ${config.style}, ${config.tone} tone${color ? `, ${color.label} accent` : ""}${dark ? ", dark" : ""}.`,
  ];
  return { config, lines };
}

/* ---------- Chat instruction to change ---------- */

export function applyInstruction(prev: StoreConfig, input: string): { config: StoreConfig; lines: string[] } {
  let text = input.trim();
  const cfg: StoreConfig = {
    ...prev,
    categories: [...prev.categories],
    trust: prev.trust.map((t) => ({ ...t })),
    products: prev.products.map((p) => ({ ...p })),
    locked: { ...prev.locked },
  };
  const lines: string[] = [];
  const preset = presetById(cfg.presetId);

  // Copy the owner types: these run to the end of the sentence, so take them out first.
  const take = (re: RegExp): string | null => {
    const m = text.match(re);
    if (!m) return null;
    text = text.replace(m[0], " ");
    return cleanQuote(m[1]);
  };

  const name = take(/(?:rename(?: it| the store| this)?|call (?:it|the store)|name (?:it|the store)|change (?:the )?name to|the name (?:should|will) be)\s*(?:to|as|:)?\s*(.+?)\s*$/i);
  if (name) {
    cfg.name = noPeriod(name).slice(0, 40);
    cfg.locked.name = true;
    lines.push(`Name is now ${cfg.name}.`);
  }
  const headline = take(/(?:headline|hero (?:title|text)|main title)\s*(?:to|as|should be|is|:)\s*(.+?)\s*$/i);
  if (headline) {
    cfg.headline = noPeriod(headline);
    cfg.locked.headline = true;
    lines.push("Headline updated.");
  }
  const subhead = take(/(?:subhead(?:line)?|tagline|sub-?title|intro line)\s*(?:to|as|should be|is|:)\s*(.+?)\s*$/i);
  if (subhead) {
    cfg.subhead = subhead;
    cfg.locked.subhead = true;
    lines.push("Subheading updated.");
  }
  const cta = take(/(?:button|cta)\s*(?:to|says?|as|:)\s*(.+?)\s*$/i);
  if (cta) {
    cfg.cta = noPeriod(cta).slice(0, 28);
    lines.push(`Button now reads “${cfg.cta}”.`);
  }
  const added = take(/\badd (?:a |an )?(?:new )?categor(?:y|ies)\s*(?:called|named|:)?\s*(.+?)\s*$/i);
  if (added) {
    for (const c of noPeriod(added).split(/,|\band\b/i).map((s) => s.trim()).filter(Boolean)) {
      if (cfg.categories.length < 6 && !cfg.categories.some((x) => x.toLowerCase() === c.toLowerCase())) {
        cfg.categories.push(c.slice(0, 22));
        lines.push(`Added category ${c.slice(0, 22)}.`);
      }
    }
  }
  const removed = take(/\b(?:remove|delete|drop) (?:the )?categor(?:y|ies)\s*(.+?)\s*$/i);
  if (removed) {
    for (const c of noPeriod(removed).split(/,|\band\b/i).map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      const before = cfg.categories.length;
      cfg.categories = cfg.categories.filter((x) => x.toLowerCase() !== c);
      if (cfg.categories.length < before) lines.push(`Removed category ${c}.`);
    }
  }

  const rest = text.toLowerCase();

  // Accent adjustments and colours
  if (/\b(darker|deeper)\s+(accent|colou?r)\b/.test(rest)) {
    cfg.accent = mix(cfg.accent, "#000000", 0.25);
    lines.push("Accent is darker.");
  } else if (/\b(softer|lighter|paler)\s+(accent|colou?r)\b/.test(rest)) {
    cfg.accent = mix(cfg.accent, "#ffffff", 0.25);
    lines.push("Accent is softer.");
  } else {
    const color = pickColor(rest);
    if (color) {
      cfg.accent = color.hex;
      lines.push(`Accent is now ${color.label}.`);
    }
  }

  // Light and dark
  const colourAdj = new RegExp(`\\b(dark|deep)\\s+(?:${COLOR_WORDS.join("|")})\\b`);
  const darkWords = /\b(dark mode|dark theme|dark background|moody|night mode|go dark|make it darker|darker)\b/.test(rest);
  const lightWords = /\b(light mode|light theme|lighter background|brighter|make it lighter|go light)\b/.test(rest);
  if (darkWords && !colourAdj.test(rest) && !/\b(darker|deeper)\s+(accent|colou?r)\b/.test(rest) && !cfg.dark) {
    cfg.dark = true;
    lines.push("Dark mode is on.");
  } else if (lightWords && cfg.dark) {
    cfg.dark = false;
    lines.push("Light mode is on.");
  }

  // Style and tone
  const style = STYLE_RULES.find(([re]) => re.test(rest))?.[1];
  if (style && style !== cfg.style) {
    cfg.style = style;
    lines.push(`Style is now ${style}.`);
  }
  const tone = TONE_RULES.find(([re]) => re.test(rest))?.[1];
  if (tone && tone !== cfg.tone) {
    cfg.tone = tone;
    if (!cfg.locked.headline) cfg.headline = headlineFor(preset, tone);
    if (!cfg.locked.subhead) cfg.subhead = subheadFor(preset, tone, cfg.location);
    lines.push(`Tone is now ${tone}.`);
  }

  // Pickup
  if (/\b(local pickup|pickup|pick-up)\b/.test(rest) && !cfg.pickup) {
    cfg.pickup = true;
    cfg.trust = trustFor(true);
    lines.push("Added local pickup.");
  }

  return { config: cfg, lines };
}

export const HELP_TEXT =
  "I can change the name, headline, colours, style (modern, contemporary or antique), tone, categories and dark mode. Try “rename it to Willow & Thread”, “use sage green” or “make it more modern”.";

export { contrast };
