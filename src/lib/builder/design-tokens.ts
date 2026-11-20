/**
 * The design tokens (APP-42 step 3): every color, font, weight, size, spacing and radius a showcase site starts from,
 * worked out by code from the saved design brief. The style tile is drawn from them, and (later) the build starts its
 * theme from them. The model picks none of these: the owner gave the mode, accent and tone, the design brief names the
 * pairing, motif, hero kind and signatures from the pack's closed lists, and everything else follows the pack's look rules
 * (runner vertical-packs/product-showcase/specs/look.md and creative.md). Where the hand-made tile and the pack differed,
 * the tile won (APP-42 decisions, 18 November) and the pack was changed to match, so the two say the same thing here.
 *
 * Pure: no model, no database, no network.
 */
import { DIRECTION, type DesignBrief } from "./design-brief";

// ---- color maths (OKLCH, sRGB, WCAG contrast) ----

export type Oklch = { l: number; c: number; h: number };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function parseHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

const hex2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0").toUpperCase();
export const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
/** A color at an opacity, as an 8 digit hex, so every color in the tile stays a plain hex the checks can read. */
export const withAlpha = (hex: string, alpha: number) => `${hex.slice(0, 7).toUpperCase()}${hex2(alpha)}`;

export function hexToOklch(hex: string): Oklch {
  const p = parseHex(hex);
  if (!p) throw new Error(`not a hex color: ${hex}`);
  const [r, g, b] = [toLinear(p.r), toLinear(p.g), toLinear(p.b)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** An OKLCH color as hex. Out of sRGB, the chroma is lowered (hue and lightness kept) until it fits. */
export function oklchToHex(o: Oklch): string {
  let c = o.c;
  let rgb = oklchToLinear({ ...o, c });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...o, c: mid }))) lo = mid;
      else hi = mid;
    }
    c = lo;
    rgb = oklchToLinear({ ...o, c });
  }
  const [r, g, b] = rgb.map((v) => toGamma(Math.min(1, Math.max(0, v))));
  return rgbHex(r, g, b);
}

export function luminance(hex: string): number {
  const p = parseHex(hex)!;
  return 0.2126 * toLinear(p.r) + 0.7152 * toLinear(p.g) + 0.0722 * toLinear(p.b);
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** The distance between two hues in degrees, 0 to 180. */
export const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

// ---- the tokens ----

export type Mode = "light" | "dark";
export type Tone = "calm" | "bold" | "playful" | "serious";

export type DesignTokens = {
  version: 1;
  mode: Mode;
  tone: Tone;
  direction: { pairing: string; motif: string; heroKind: string; heroLayout: "centred" | "split"; signatures: string[] };
  color: {
    background: string; surface: string; border: string; text: string; muted: string;
    inverse: string; onInverse: string;
    accent: string; onAccent: string;
    /** The accent where it is used as text (eyebrows, links): the accent when it reaches 4.5:1 on the background, else a step that does. */
    accentText: string;
    tint50: string; tint100: string; tint200: string; tint300: string; tint700: string; tint900: string;
    glow: string; dot: string;
    /** Highlight on a card's top edge (blended cards). */
    edge: string;
    shadow: string;
  };
  /** The neutral hue in dark mode (268, or moved 50 degrees away from a blue accent); null in light mode. */
  neutralHue: number | null;
  /** When the owner's accent was moved so text on it reaches 4.5:1: the accent they gave. */
  accentGiven: string | null;
  font: {
    heading: string; body: string; accent: string | null; capsLabels: boolean;
    weight: { headline: number; strong: number; title: number; medium: number; body: number; numeral: number };
  };
  /** Sizes in px: desktop and phone. Letter spacing in em. */
  type: {
    hero: [number, number]; heroTracking: number; heroLine: number;
    section: [number, number]; sectionTracking: number; sectionLine: number;
    body: [number, number]; bodyLine: number;
    small: number; label: number; eyebrow: number; eyebrowTracking: number; capsTracking: number; caption: number;
    cardTitle: number; price: number; numeral: [number, number];
  };
  space: { section: [number, number]; gutter: [number, number]; cardPad: [number, number]; gap: number; contentMax: number; headingGap: number; heroGap: number; buttonHeight: number };
  radius: { card: number; closing: number; small: number; round: number };
  depth: { dotGrid: number; dotSize: number; glowAt: [number, number]; glowSize: [number, number]; cardEdge: "blended" | "defined" };
};

const TONES: Tone[] = ["calm", "bold", "playful", "serious"];
const LIGHT = { background: "#FFFFFF", surface: "#F4F6F5", border: "#E4E7E5", text: "#0B0F0D", muted: "#5B6560" };
const DARK_ROLES = { background: [0.177, 0.034], surface: [0.222, 0.041], border: [0.314, 0.052], text: [0.973, 0.007], muted: [0.726, 0.046] } as const;
export const NEAR_BLACK = "#04130D";
export const WHITE = "#FFFFFF";
const NAVY_HUE = 268;

/** look.md tone table (desktop / phone). */
const TONE_TABLE: Record<Tone, { display: number; hero: [number, number]; heroTracking: number; section: [number, number]; sectionTracking: number; radius: number; section_pad: [number, number]; glow: [number, number] }> = {
  calm: { display: 600, hero: [64, 38], heroTracking: -0.03, section: [44, 30], sectionTracking: -0.02, radius: 16, section_pad: [120, 72], glow: [0.08, 0.08] },
  bold: { display: 800, hero: [80, 42], heroTracking: -0.04, section: [68, 36], sectionTracking: -0.03, radius: 16, section_pad: [112, 64], glow: [0.16, 0.22] },
  playful: { display: 700, hero: [68, 40], heroTracking: -0.035, section: [52, 32], sectionTracking: -0.025, radius: 32, section_pad: [104, 64], glow: [0.14, 0.2] },
  serious: { display: 600, hero: [56, 34], heroTracking: -0.02, section: [40, 28], sectionTracking: -0.02, radius: 8, section_pad: [112, 64], glow: [0, 0] },
};

/** The tone's display weight, used for headlines only with the Neutral modern pairing. */
export const TONE_DISPLAY: Record<Tone, number> = { calm: TONE_TABLE.calm.display, bold: TONE_TABLE.bold.display, playful: TONE_TABLE.playful.display, serious: TONE_TABLE.serious.display };

/** The neutral hue for dark mode: navy, moved 50 degrees away from an accent that is itself blue, indigo or violet. */
export function neutralHueFor(accent: Oklch): number {
  if (accent.c < 0.03 || hueDistance(accent.h, NAVY_HUE) >= 50) return NAVY_HUE;
  return accent.h <= NAVY_HUE ? (accent.h + 50) % 360 : (accent.h - 50 + 360) % 360;
}

/** Text on the accent: near-black when it reaches 4.5:1, else white; when neither does, the accent moves until one does. */
export function accentPair(accent: string): { accent: string; onAccent: string; moved: boolean } {
  const ok = (a: string) => (contrast(a, NEAR_BLACK) >= 4.5 ? NEAR_BLACK : contrast(a, WHITE) >= 4.5 ? WHITE : null);
  const first = ok(accent);
  if (first) return { accent: accent.toUpperCase(), onAccent: first, moved: false };
  const o = hexToOklch(accent);
  for (let step = 0.01; step <= 0.5; step += 0.01) {
    for (const l of [o.l + step, o.l - step]) {
      if (l <= 0 || l >= 1) continue;
      const hex = oklchToHex({ ...o, l });
      const on = ok(hex);
      if (on) return { accent: hex, onAccent: on, moved: true };
    }
  }
  return { accent: accent.toUpperCase(), onAccent: NEAR_BLACK, moved: false };
}

const tint = (a: Oklch, l: number, maxC = a.c) => oklchToHex({ l, c: maxC, h: a.h });

const HEX = /^#[0-9a-f]{6}$/i;
const toneOf = (v: unknown): Tone => (TONES.includes(v as Tone) ? (v as Tone) : "calm");

/**
 * The tokens for one site, from its saved design brief and (for the content width, card edge and the owner's own
 * background) the approved brief. Same input, same tokens.
 */
export function designTokens(db: DesignBrief, brief: Record<string, unknown> = {}): DesignTokens {
  const look = (brief.look ?? {}) as { layout?: { max_width_px?: number }; card_edge?: string; background?: string };
  const mode: Mode = db.look.mode.value === "dark" ? "dark" : "light";
  const tone = toneOf(db.look.tone.value);
  const t = TONE_TABLE[tone];
  const given = db.look.accent.value && HEX.test(db.look.accent.value) ? db.look.accent.value.toUpperCase() : "#0F766E";
  const pair = accentPair(given);
  const a = hexToOklch(pair.accent);

  let neutrals: typeof LIGHT;
  let neutralHue: number | null = null;
  const ownBg = look.background && HEX.test(look.background) ? look.background.toUpperCase() : null;
  if (mode === "dark") {
    neutralHue = ownBg ? hexToOklch(ownBg).h : neutralHueFor(a);
    const role = (k: keyof typeof DARK_ROLES) => oklchToHex({ l: DARK_ROLES[k][0], c: DARK_ROLES[k][1], h: neutralHue! });
    neutrals = { background: ownBg ?? role("background"), surface: role("surface"), border: role("border"), text: role("text"), muted: role("muted") };
  } else {
    neutrals = { ...LIGHT, ...(ownBg ? { background: ownBg } : {}) };
  }
  // Text that misses 4.5:1 on the owner's own background moves until it passes; the owner's color never changes.
  for (const k of ["text", "muted"] as const) {
    const o = hexToOklch(neutrals[k]);
    const dir = luminance(neutrals.background) < 0.18 ? 1 : -1;
    for (let l = o.l; contrast(neutrals[k], neutrals.background) < 4.5 && l > 0 && l < 1; l += dir * 0.01) neutrals[k] = oklchToHex({ ...o, l });
  }

  const tints = {
    tint50: tint(a, 0.975), tint100: tint(a, 0.95), tint200: tint(a, 0.91), tint300: tint(a, 0.86),
    tint700: tint(a, Math.min(a.l, 0.5)), tint900: tint(a, mode === "dark" ? 0.27 : 0.32, Math.min(a.c, 0.09)),
  };
  // Accent as text: the accent where it reaches 4.5:1; otherwise the 700 step in light mode, the text color in dark mode.
  const accentText = contrast(pair.accent, neutrals.background) >= 4.5 ? pair.accent : mode === "light" && contrast(tints.tint700, neutrals.background) >= 4.5 ? tints.tint700 : neutrals.text;

  const pairing = DIRECTION.pairings.find((p) => p.name === db.direction.pairing.value) ?? DIRECTION.pairings[0];
  const headline = pairing.headingWeight === "tone" ? t.display : pairing.headingWeight;
  const signatures = db.direction.signatures.map((s) => s.value);
  const heroKind = db.direction.hero_kind.value;
  const glowAlpha = mode === "dark" ? t.glow[1] : t.glow[0];

  return {
    version: 1,
    mode,
    tone,
    direction: {
      pairing: pairing.name,
      motif: db.direction.motif.value,
      heroKind,
      heroLayout: heroKind === "fragment" ? "split" : "centred",
      signatures,
    },
    color: {
      ...neutrals,
      inverse: mode === "dark" ? neutrals.text : LIGHT.text,
      onInverse: mode === "dark" ? neutrals.background : WHITE,
      accent: pair.accent,
      onAccent: pair.onAccent,
      accentText,
      ...tints,
      glow: withAlpha(pair.accent, glowAlpha),
      dot: withAlpha(neutrals.text, mode === "dark" ? 0.14 : 0.16),
      edge: withAlpha(WHITE, mode === "dark" ? 0.12 : 0.5),
      shadow: withAlpha("#000000", mode === "dark" ? 0.45 : 0.08),
    },
    neutralHue: neutralHue === null ? null : Math.round(neutralHue),
    accentGiven: pair.moved ? given : null,
    font: {
      heading: pairing.heading,
      body: pairing.body,
      accent: pairing.accentFont,
      capsLabels: pairing.capsLabels,
      // Only headlines go above 700; the oversized numerals, when chosen, may use the headline weight.
      weight: { headline, strong: 700, title: 600, medium: 500, body: 400, numeral: signatures.includes("oversized-numerals") ? headline : 700 },
    },
    type: {
      hero: t.hero, heroTracking: t.heroTracking, heroLine: tone === "bold" ? 1.0 : 1.05,
      section: t.section, sectionTracking: t.sectionTracking, sectionLine: 1.08,
      body: [18, 16], bodyLine: 1.6,
      small: 15, label: 13, eyebrow: 13, eyebrowTracking: 0.12, capsTracking: 0.08, caption: 12,
      cardTitle: 20, price: 40, numeral: [72, 52],
    },
    space: {
      section: t.section_pad, gutter: [32, 16], cardPad: [32, 24], gap: 16,
      contentMax: typeof look.layout?.max_width_px === "number" ? Math.min(1440, Math.max(960, look.layout.max_width_px)) : 1200,
      headingGap: 28, heroGap: 32, buttonHeight: 48,
    },
    radius: { card: t.radius, closing: Math.round(t.radius * 1.25), small: Math.max(6, Math.round(t.radius / 2)), round: 999 },
    depth: {
      dotGrid: 16,
      dotSize: tone === "playful" ? 2 : 1,
      glowAt: [18, 8],
      glowSize: [60, 40],
      cardEdge: look.card_edge === "defined" || look.card_edge === "blended" ? look.card_edge : tone === "serious" ? "defined" : "blended",
    },
  };
}

/** The neutral colors of a token set: the colors check 3 accepts whatever their hue. */
export function neutralColors(t: DesignTokens): string[] {
  const c = t.color;
  return [c.background, c.surface, c.border, c.text, c.muted, c.inverse, c.onInverse, NEAR_BLACK, WHITE, "#000000"].map((h) => h.toUpperCase());
}
