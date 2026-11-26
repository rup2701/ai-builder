/**
 * The shape check for design tokens a build starts from (PR B). The worker hands the tokens saved with the Visual design
 * tile (DesignTokens from design-tokens.ts) to the runner, which writes them into the site as src/theme.ts. Anything that
 * does not have this shape is not passed on, and the build goes on as it did before tokens existed.
 * The runner keeps the same check in its src/theme-tokens.ts; the two must accept the same things.
 *
 * Extra fields are allowed, so a newer token set still passes. A missing or wrong field fails. Pure.
 */

const HEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
/** Font and choice names go into a TypeScript file, so only plain names pass. */
const NAME = /^[A-Za-z0-9 -]{1,40}$/;

const COLOR_KEYS = [
  "background", "surface", "border", "text", "muted", "inverse", "onInverse", "accent", "onAccent", "accentText",
  "tint50", "tint100", "tint200", "tint300", "tint700", "tint900", "glow", "dot", "edge", "shadow",
] as const;
const WEIGHT_KEYS = ["headline", "strong", "title", "medium", "body", "numeral"] as const;
const TYPE_KEYS = [
  "hero", "heroTracking", "heroLine", "section", "sectionTracking", "sectionLine", "body", "bodyLine",
  "small", "label", "eyebrow", "eyebrowTracking", "capsTracking", "caption", "cardTitle", "price", "numeral",
] as const;
const SPACE_KEYS = ["section", "gutter", "cardPad", "gap", "contentMax", "headingGap", "heroGap", "buttonHeight"] as const;
const RADIUS_KEYS = ["card", "closing", "small", "round"] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isNum);
const numOrPair = (v: unknown) => isNum(v) || isPair(v);

/** Null when the tokens have the shape a build can use; otherwise what is wrong, in a few words. */
export function themeTokensProblem(x: unknown): string | null {
  if (!isObj(x)) return "not an object";
  if (x.version !== 1) return "version is not 1";
  if (x.mode !== "light" && x.mode !== "dark") return "mode is not light or dark";
  if (!["calm", "bold", "playful", "serious"].includes(x.tone as string)) return "tone is not one of the four";
  if (!(x.neutralHue === null || isNum(x.neutralHue))) return "neutralHue";
  if (!(x.accentGiven === null || (typeof x.accentGiven === "string" && HEX.test(x.accentGiven)))) return "accentGiven";

  const d = x.direction;
  if (!isObj(d)) return "direction is missing";
  for (const k of ["pairing", "motif", "heroKind"]) if (typeof d[k] !== "string" || !NAME.test(d[k] as string)) return `direction.${k}`;
  if (d.heroLayout !== "centred" && d.heroLayout !== "split") return "direction.heroLayout";
  if (!Array.isArray(d.signatures) || d.signatures.length > 3 || !d.signatures.every((s) => typeof s === "string" && NAME.test(s))) return "direction.signatures";

  const c = x.color;
  if (!isObj(c)) return "color is missing";
  for (const k of COLOR_KEYS) if (typeof c[k] !== "string" || !HEX.test(c[k] as string)) return `color.${k}`;

  const f = x.font;
  if (!isObj(f)) return "font is missing";
  for (const k of ["heading", "body"]) if (typeof f[k] !== "string" || !NAME.test(f[k] as string)) return `font.${k}`;
  if (!(f.accent === null || (typeof f.accent === "string" && NAME.test(f.accent)))) return "font.accent";
  if (typeof f.capsLabels !== "boolean") return "font.capsLabels";
  if (!isObj(f.weight)) return "font.weight is missing";
  for (const k of WEIGHT_KEYS) {
    const w = f.weight[k];
    if (!isNum(w) || w < 100 || w > 900) return `font.weight.${k}`;
  }

  const groups: [string, readonly string[]][] = [["type", TYPE_KEYS], ["space", SPACE_KEYS], ["radius", RADIUS_KEYS]];
  for (const [name, keys] of groups) {
    const g = x[name];
    if (!isObj(g)) return `${name} is missing`;
    for (const k of keys) if (!numOrPair(g[k])) return `${name}.${k}`;
  }

  const dp = x.depth;
  if (!isObj(dp)) return "depth is missing";
  if (!isNum(dp.dotGrid) || !isNum(dp.dotSize) || !isPair(dp.glowAt) || !isPair(dp.glowSize)) return "depth";
  if (dp.cardEdge !== "blended" && dp.cardEdge !== "defined") return "depth.cardEdge";
  return null;
}
