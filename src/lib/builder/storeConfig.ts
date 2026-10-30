/**
 * The store config: the one object the whole builder works on.
 *
 * Build turns an idea into a StoreConfig. Chat instructions edit it. Verify checks it.
 * The preview draws it. Later, the real store template reads the same object.
 */

export type StyleId = "modern" | "contemporary" | "antique";
export type ToneId = "warm" | "refined" | "playful";
export type PresetId = "boutique" | "ceramics" | "plants" | "candles" | "coffee" | "jewelry" | "general";
export type ArtKind =
  | "mug" | "bowl" | "vase" | "dress" | "knit" | "tote"
  | "plant" | "succulent" | "candle" | "necklace" | "coffee" | "tin";

export type SampleProduct = { name: string; price: number; art: ArtKind };
export type TrustItem = { title: string; body: string };

export type StoreConfig = {
  presetId: PresetId;
  /** "boutique", "ceramics shop", … used in the eyebrow line. */
  kind: string;
  name: string;
  location: string;
  style: StyleId;
  tone: ToneId;
  dark: boolean;
  /** Accent colour, #rrggbb. Every other colour is derived from it. */
  accent: string;
  headline: string;
  subhead: string;
  cta: string;
  categories: string[];
  products: SampleProduct[];
  trust: TrustItem[];
  pickup: boolean;
  /** Copy the owner typed. Tone and preset changes never overwrite these. */
  locked: { name: boolean; headline: boolean; subhead: boolean };
};

/* ---------- Colour maths ---------- */

export type Palette = {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentText: string;
  accentInk: string;
  tint: string;
};

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix two colours. t is the share of b: 0 gives a, 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function paletteFor(accent: string, dark: boolean): Palette {
  let bg: string, surface: string, ink: string;
  if (dark) {
    bg = mix("#111111", accent, 0.1);
    surface = mix(bg, "#ffffff", 0.06);
    ink = mix("#f5f5f5", accent, 0.08);
  } else {
    bg = mix("#ffffff", accent, 0.06);
    surface = "#ffffff";
    ink = mix("#141414", accent, 0.15);
  }
  // Muted text: as soft as it can be while staying readable.
  let muted = ink;
  for (let t = 0.45; t >= 0; t -= 0.05) {
    muted = mix(ink, bg, t);
    if (contrast(muted, bg) >= 4.5) break;
  }
  const line = mix(ink, bg, 0.86);
  const accentInk = contrast("#ffffff", accent) >= contrast("#141414", accent) ? "#ffffff" : "#141414";
  const tint = mix(accent, bg, dark ? 0.78 : 0.84);
  // Accent used as small text: nudged toward the ink colour only as far as needed to stay readable.
  let accentText = accent;
  for (let t = 0.1; t <= 1 && contrast(accentText, bg) < 4.5; t += 0.1) accentText = mix(accent, ink, t);
  return { bg, surface, ink, muted, line, accent, accentText, accentInk, tint };
}

/* ---------- Styles ---------- */

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
const SERIF = 'ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, "Times New Roman", serif';

export const STYLES: Record<
  StyleId,
  { label: string; head: string; body: string; radius: string; weight: number; track: string; caps: string; ornament: boolean }
> = {
  modern: { label: "Modern", head: SANS, body: SANS, radius: "4px", weight: 500, track: "-0.02em", caps: "0.14em", ornament: false },
  contemporary: { label: "Contemporary", head: SANS, body: SANS, radius: "14px", weight: 400, track: "-0.03em", caps: "0.12em", ornament: false },
  antique: { label: "Antique", head: SERIF, body: SERIF, radius: "2px", weight: 400, track: "0", caps: "0.22em", ornament: true },
};

/* ---------- Presets ---------- */

type Copy = Record<ToneId, string>;

export type Preset = {
  id: PresetId;
  kind: string;
  match: RegExp;
  accent: string;
  style: StyleId;
  tone: ToneId;
  names: string[];
  categories: string[];
  products: SampleProduct[];
  headline: Copy;
  subhead: Copy;
  cta: string;
};

export const PRESETS: Preset[] = [
  {
    id: "boutique",
    kind: "boutique",
    match: /boutique|clothing|clothes|fashion|apparel|dress|wardrobe|garment|menswear|womenswear/i,
    accent: "#7b3f61",
    style: "contemporary",
    tone: "refined",
    names: ["Maple & Thread", "Little Atelier", "Rue Verte"],
    categories: ["New in", "Dresses", "Knitwear", "Accessories"],
    products: [
      { name: "Wrap dress", price: 128, art: "dress" },
      { name: "Wool crew knit", price: 96, art: "knit" },
      { name: "Everyday tote", price: 68, art: "tote" },
      { name: "Linen shirt dress", price: 112, art: "dress" },
    ],
    headline: { warm: "Clothes you'll reach for again", refined: "Pieces worth keeping", playful: "Dress like it's Friday" },
    subhead: {
      warm: "Seasonal pieces, picked with care and ready for pickup.",
      refined: "A considered edit of the season, in small quantities.",
      playful: "New drops, bold color and easy returns.",
    },
    cta: "Shop new in",
  },
  {
    id: "jewelry",
    kind: "jewelry shop",
    match: /jewel|\brings?\b|necklace|earring|bracelet/i,
    accent: "#a07a3a",
    style: "modern",
    tone: "refined",
    names: ["Fine Thread", "Gilded Bird", "Little Gold"],
    categories: ["Necklaces", "Rings", "Earrings"],
    products: [
      { name: "Fine chain necklace", price: 88, art: "necklace" },
      { name: "Pendant necklace", price: 74, art: "necklace" },
      { name: "Everyday tote", price: 58, art: "tote" },
      { name: "Gift tin", price: 24, art: "tin" },
    ],
    headline: { warm: "Pieces that go with everything", refined: "Small, lasting details", playful: "Wear something fun" },
    subhead: {
      warm: "Everyday jewelry in simple shapes.",
      refined: "Necklaces, rings and earrings in clean lines.",
      playful: "Stackable, mixable and a little bold.",
    },
    cta: "Shop jewelry",
  },
  {
    id: "ceramics",
    kind: "ceramics shop",
    match: /cerami|potter|stoneware|\bmugs?\b|kiln|\bclay\b/i,
    accent: "#b4644a",
    style: "contemporary",
    tone: "warm",
    names: ["Kiln & Clay", "Slow Glaze", "Hearth Pottery"],
    categories: ["Mugs", "Bowls", "Vases", "Gifts"],
    products: [
      { name: "Speckled mug", price: 34, art: "mug" },
      { name: "Serving bowl", price: 58, art: "bowl" },
      { name: "Bud vase", price: 42, art: "vase" },
      { name: "Tall mug", price: 38, art: "mug" },
    ],
    headline: { warm: "Made slowly, used daily", refined: "Form, glaze, restraint", playful: "Mugs with personality" },
    subhead: {
      warm: "Mugs, bowls and vases for the table you actually use.",
      refined: "A small collection of everyday ceramics.",
      playful: "Bright glazes for your morning routine.",
    },
    cta: "Shop ceramics",
  },
  {
    id: "plants",
    kind: "plant shop",
    match: /plant|nursery|succulent|botanic|garden/i,
    accent: "#3f7a52",
    style: "contemporary",
    tone: "warm",
    names: ["Leaf & Pot", "Green Shelf", "Sprout Supply"],
    categories: ["Houseplants", "Pots", "Care kits", "Gifts"],
    products: [
      { name: "Leafy houseplant", price: 36, art: "plant" },
      { name: "Mini succulent", price: 18, art: "succulent" },
      { name: "Statement plant", price: 52, art: "plant" },
      { name: "Plant care kit", price: 24, art: "tin" },
    ],
    headline: { warm: "Green things for every shelf", refined: "A quieter kind of green", playful: "Plants that make a scene" },
    subhead: {
      warm: "Houseplants, pots and simple care guides.",
      refined: "Carefully chosen plants and planters.",
      playful: "Leafy picks, funky pots and care kits.",
    },
    cta: "Shop plants",
  },
  {
    id: "candles",
    kind: "candle shop",
    match: /candle|fragrance|\bwax\b|scent|diffuser/i,
    accent: "#c07a2c",
    style: "antique",
    tone: "warm",
    names: ["Ember & Wick", "Small Flame", "Dusk Candle Co."],
    categories: ["Candles", "Diffusers", "Gift sets"],
    products: [
      { name: "Amber candle", price: 28, art: "candle" },
      { name: "Cedar candle", price: 34, art: "candle" },
      { name: "Travel tin", price: 22, art: "tin" },
      { name: "Large candle", price: 42, art: "candle" },
    ],
    headline: { warm: "Light something slow", refined: "Scent, softly", playful: "Glow up your shelf" },
    subhead: {
      warm: "Small-batch candles for evenings in.",
      refined: "A short list of candles and diffusers.",
      playful: "Fun scents, bright jars, gift-ready.",
    },
    cta: "Shop candles",
  },
  {
    id: "coffee",
    kind: "coffee shop",
    match: /coffee|roast|espresso|\btea\b/i,
    accent: "#6b4a35",
    style: "modern",
    tone: "warm",
    names: ["Slow Roast", "Third Shelf Coffee", "Morning Ritual"],
    categories: ["Beans", "Subscriptions", "Gear"],
    products: [
      { name: "House blend", price: 18, art: "coffee" },
      { name: "Single origin", price: 22, art: "coffee" },
      { name: "Brew tin", price: 26, art: "tin" },
      { name: "Ceramic mug", price: 24, art: "mug" },
    ],
    headline: { warm: "Coffee for slow mornings", refined: "A focused roast list", playful: "Wake up on purpose" },
    subhead: {
      warm: "Beans, subscriptions and the gear to brew them.",
      refined: "Single-origin beans and brewing gear.",
      playful: "Fresh picks, easy subscriptions, zero fuss.",
    },
    cta: "Shop coffee",
  },
  {
    id: "general",
    kind: "shop",
    match: /./,
    accent: "#2f5d62",
    style: "contemporary",
    tone: "warm",
    names: ["Common Goods", "Hand & Hearth", "Corner Shelf"],
    categories: ["New", "Bestsellers", "Gifts"],
    products: [
      { name: "Everyday mug", price: 28, art: "mug" },
      { name: "Canvas tote", price: 36, art: "tote" },
      { name: "Soy candle", price: 26, art: "candle" },
      { name: "Desk plant", price: 22, art: "succulent" },
    ],
    headline: { warm: "Good things, close to home", refined: "A considered collection", playful: "Your next favorite thing" },
    subhead: {
      warm: "A small shop with things worth having.",
      refined: "A short list of things chosen with care.",
      playful: "Fresh finds, friendly prices, easy returns.",
    },
    cta: "Shop now",
  },
];

export const presetById = (id: PresetId): Preset => PRESETS.find((p) => p.id === id)!;

/* ---------- Copy helpers ---------- */

export function headlineFor(p: Preset, tone: ToneId): string {
  return p.headline[tone];
}

export function subheadFor(p: Preset, tone: ToneId, location: string): string {
  const base = p.subhead[tone];
  return location ? `A ${p.kind} in ${location}. ${base}` : base;
}

export function trustFor(pickup: boolean): TrustItem[] {
  return [
    { title: "Picked with care", body: "Every item is chosen with care." },
    { title: "Easy returns", body: "Changed your mind? Send it back within the return window." },
    pickup
      ? { title: "Local pickup", body: "Collect your order near you, no shipping needed." }
      : { title: "Simple shipping", body: "Clear shipping costs shown before you pay." },
    { title: "A real person replies", body: "Questions about an order? Write to us any time." },
  ];
}

export type BuildOptions = {
  presetId: PresetId;
  seed: number;
  name?: string;
  location?: string;
  style?: StyleId;
  tone?: ToneId;
  dark?: boolean;
  accent?: string;
  pickup?: boolean;
};

export function buildConfig(o: BuildOptions): StoreConfig {
  const p = presetById(o.presetId);
  const tone = o.tone ?? p.tone;
  const location = o.location ?? "";
  return {
    presetId: p.id,
    kind: p.kind,
    name: o.name ?? p.names[o.seed % p.names.length],
    location,
    style: o.style ?? p.style,
    tone,
    dark: o.dark ?? false,
    accent: o.accent ?? p.accent,
    headline: headlineFor(p, tone),
    subhead: subheadFor(p, tone, location),
    cta: p.cta,
    categories: [...p.categories],
    products: p.products.map((x) => ({ ...x })),
    trust: trustFor(o.pickup ?? false),
    pickup: o.pickup ?? false,
    locked: { name: Boolean(o.name), headline: false, subhead: false },
  };
}
