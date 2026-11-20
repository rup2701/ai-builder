/**
 * The automatic checks on a style tile: the five from the template analysis (APP-42, 18 November) and a sixth for the footer. They read the finished HTML,
 * not the renderer's inputs, so a renderer bug that leaks a word, drops a Sample mark or adds a color is caught.
 *
 *   1. Every visible word is sourced: the brief's wording, a field from the design brief's sample card or placeholders, a
 *      fixed template word, a marked placeholder, or a step's ordinal. Nothing else.
 *   2. Every sample card carries a visible Sample mark, and the Concept preview caption is there.
 *   3. One accent: every color is a neutral of the token set or within 15 degrees of the accent's hue (OKLCH).
 *   4. The headlines use the weight the pairing gives; nothing else goes above 700, except the oversized numerals.
 *   5. No sideways scroll at 390 px. Here a static check (nothing wider than 358 px that is not allowed to shrink, long words
 *      wrap, a phone layout exists); the measurement in a real browser at 390 px is in scripts/tile-try.mts.
 *   6. Every footer link is one of the brief's footer links, and none is a link the tile leaves out (About, Docs,
 *      Changelog, Security, from the pack's default footer).
 *   7. Every plan card shows its name and a price (the price as text, or a marked placeholder), never a blank.
 *
 * Pure: no browser, no network.
 */
import { DIRECTION } from "./design-brief";
import { hexToOklch, hueDistance, neutralColors, TONE_DISPLAY, type DesignTokens } from "./design-tokens";
import { CAPTION, HIDDEN_FOOTER_LINKS, PLACEHOLDER, SAMPLE, TEMPLATE_WORDS } from "./style-tile";

export type TileCheck = { id: 1 | 2 | 3 | 4 | 5 | 6 | 7; name: string; ok: boolean; detail: string };
export type TileChecks = { ok: boolean; checks: TileCheck[] };

// ---- a small HTML reader, enough for the page the renderer writes ----

export type El = { tag: string; attrs: Record<string, string>; children: (El | string)[]; raw?: string };
const VOID = new Set(["meta", "link", "br", "img", "input", "hr"]);
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export function parseHtml(html: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) {
      top.children.push(decode(m[4]));
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map((e) => e.tag).lastIndexOf(tag);
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? "").matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? "");
    const el: El = { tag, attrs, children: [] };
    top.children.push(el);
    if (tag === "style" || tag === "script") {
      const end = html.toLowerCase().indexOf(`</${tag}>`, re.lastIndex);
      el.raw = html.slice(re.lastIndex, end < 0 ? html.length : end);
      re.lastIndex = end < 0 ? html.length : end + tag.length + 3;
    } else if (!VOID.has(tag)) stack.push(el);
  }
  return root;
}

const els = (e: El): El[] => e.children.flatMap((c) => (typeof c === "string" ? [] : [c, ...els(c)]));
const textOf = (e: El): string => e.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const classes = (e: El) => (e.attrs.class ?? "").split(/\s+/);

/** Each visible piece of text with the element it sits in. Head, style and script are not visible. */
export function visibleText(root: El): { text: string; parent: El }[] {
  const out: { text: string; parent: El }[] = [];
  const walk = (e: El) => {
    if (["head", "style", "script", "title"].includes(e.tag)) return;
    for (const c of e.children) {
      if (typeof c === "string") {
        const t = c.replace(/\s+/g, " ").trim();
        if (t) out.push({ text: t, parent: e });
      } else walk(c);
    }
  };
  walk(root);
  return out;
}

// ---- the CSS the page holds ----

export type Rule = { selector: string; decls: Record<string, string>; inContainer: boolean };

export function cssOf(root: El): string {
  return els(root).filter((e) => e.tag === "style").map((e) => e.raw ?? "").join("\n");
}

export function parseCss(css: string): { vars: Record<string, string>; rules: Rule[]; containers: string[] } {
  const vars: Record<string, string> = {};
  const rules: Rule[] = [];
  const containers: string[] = [];
  const body = (s: string, inContainer: boolean) => {
    for (const m of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim();
      const decls: Record<string, string> = {};
      for (const d of m[2].split(";")) {
        const i = d.indexOf(":");
        if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      }
      if (selector === ":root") Object.assign(vars, Object.fromEntries(Object.entries(decls).filter(([k]) => k.startsWith("--"))));
      rules.push({ selector, decls, inContainer });
    }
  };
  let rest = css;
  for (const m of css.matchAll(/@container([^{]*)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)) {
    containers.push(m[1].trim());
    body(m[2], true);
    rest = rest.replace(m[0], "");
  }
  body(rest, false);
  return { vars, rules, containers };
}

/** A value with every var(--x) replaced from :root (rules on .page may set their own; those are read too). */
export function resolve(value: string, vars: Record<string, string>, depth = 0): string {
  if (depth > 8) return value;
  return value.replace(/var\(--([\w-]+)\)/g, (_, k) => (vars[`--${k}`] !== undefined ? resolve(vars[`--${k}`], vars, depth + 1) : `var(--${k})`));
}

// ---- the checks ----

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

export function checkWords(root: El, sources: string[]): TileCheck {
  const src = sources.map(norm);
  const fixed = new Set(TEMPLATE_WORDS.map(norm));
  const bad: string[] = [];
  for (const { text, parent } of visibleText(root)) {
    const n = norm(text);
    if (fixed.has(n) || PLACEHOLDER.test(text)) continue;
    if ("data-ordinal" in parent.attrs && /^\d{1,2}$/.test(text)) continue;
    if (src.some((s) => s.includes(n))) continue;
    bad.push(text);
  }
  return { id: 1, name: "Every word is sourced", ok: bad.length === 0, detail: bad.length ? `Not from the brief or the template: ${bad.slice(0, 5).map((b) => `"${b}"`).join(", ")}${bad.length > 5 ? ` and ${bad.length - 5} more` : ""}` : "Every visible word is the brief's wording, a sample card field, a template word or a placeholder." };
}

export function checkSamples(root: El, heroKind: string): TileCheck {
  const cards = els(root).filter((e) => "data-sample-card" in e.attrs);
  const unmarked = cards.filter((c) => !els(c).some((e) => "data-sample" in e.attrs && textOf(e).trim() === SAMPLE));
  const caption = visibleText(root).some((t) => t.text === CAPTION);
  if (heroKind === "owner-art" && cards.length === 0) return { id: 2, name: "Sample cards are marked", ok: true, detail: "The hero waits for the owner's image; there are no sample cards." };
  const ok = cards.length >= 3 && unmarked.length === 0 && caption;
  const why = [cards.length < 3 ? `${cards.length} sample cards, not 3` : "", unmarked.length ? `${unmarked.length} without a Sample mark` : "", caption ? "" : "no Concept preview caption"].filter(Boolean).join("; ");
  return { id: 2, name: "Sample cards are marked", ok, detail: ok ? `${cards.length} of ${cards.length} sample cards marked Sample, caption shown.` : why };
}

export function checkOneAccent(css: string, html: string, t: DesignTokens): TileCheck {
  const accentHue = hexToOklch(t.color.accent).h;
  const neutrals = new Set(neutralColors(t));
  const found = [...new Set([...css.matchAll(/#[0-9a-f]{3,8}\b/gi), ...html.replace(/<style>[\s\S]*?<\/style>/g, "").matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toUpperCase()))];
  const bad = found.filter((h) => {
    const base = h.length === 9 ? h.slice(0, 7) : h;
    if (neutrals.has(base)) return false;
    const o = hexToOklch(base);
    if (o.c < 0.02) return false;
    return hueDistance(o.h, accentHue) > 15;
  });
  return { id: 3, name: "One accent", ok: bad.length === 0, detail: bad.length ? `Colors outside the neutrals and the accent's hue: ${bad.join(", ")}` : `${found.length} colors, all neutrals or within 15 degrees of the accent ${t.color.accent}.` };
}

/** The headline weight the pack's pairing table gives, read from the closed list (not from the tokens). */
export function expectedHeadlineWeight(pairing: string, tone: string): number {
  const p = DIRECTION.pairings.find((x) => x.name === pairing) ?? DIRECTION.pairings[0];
  return p.headingWeight === "tone" ? TONE_DISPLAY[tone as keyof typeof TONE_DISPLAY] ?? 600 : p.headingWeight;
}

export function checkWeights(css: string, t: DesignTokens): TileCheck {
  const { vars, rules } = parseCss(css);
  const want = expectedHeadlineWeight(t.direction.pairing, t.tone);
  const problems: string[] = [];
  let headlines = 0;
  for (const r of rules) {
    const w = r.decls["font-weight"];
    if (!w) continue;
    const n = Number(resolve(w, vars));
    const isHeadline = r.selector.split(",").some((s) => /^(h1|h2)$/.test(s.trim()));
    if (isHeadline) {
      headlines++;
      if (n !== want) problems.push(`${r.selector} at ${n}, the pairing gives ${want}`);
    } else if (n > 700 && !r.selector.includes('[data-signature="oversized-numerals"]')) problems.push(`${r.selector} at ${n}`);
  }
  if (!headlines) problems.push("no headline weight set");
  return { id: 4, name: "Headline weight matches the pairing", ok: problems.length === 0, detail: problems.length ? problems.join("; ") : `Headlines at ${want} (${t.direction.pairing}); nothing else above 700 except the oversized numerals.` };
}

export const PHONE = 390;
/** The widest a fixed width may be at 390 px: the frame less the phone gutters (16 px each side). */
export const PHONE_ROOM = PHONE - 32;

export function checkPhoneWidth(css: string): TileCheck {
  const { vars, rules, containers } = parseCss(css);
  const problems: string[] = [];
  if (!containers.some((c) => /max-width:\s*(\d+)px/.test(c) && Number(/max-width:\s*(\d+)px/.exec(c)![1]) >= PHONE)) problems.push("no phone layout (container query)");
  const wraps = rules.some((r) => /\bbody\b/.test(r.selector) && /anywhere|break-word/.test(r.decls["overflow-wrap"] ?? ""));
  if (!wraps) problems.push("long words do not wrap");
  for (const r of rules) {
    for (const prop of ["width", "min-width", "flex-basis"]) {
      const v = r.decls[prop];
      if (!v) continue;
      const px = /^(\d+(?:\.\d+)?)px$/.exec(resolve(v, vars).trim());
      if (px && Number(px[1]) > PHONE_ROOM && r.decls["max-width"] !== "100%") problems.push(`${r.selector} ${prop} ${px[1]}px`);
    }
    const cols = r.decls["grid-template-columns"];
    if (cols && !r.inContainer && /px|var\(/.test(cols) && !/min\(100%/.test(cols)) problems.push(`${r.selector} columns do not shrink`);
    if (cols && !r.inContainer && !/auto-fit|auto-fill/.test(cols) && /fr\s+\d|fr\s+[\d.]+fr/.test(cols) && !rules.some((x) => x.inContainer && x.selector === r.selector && x.decls["grid-template-columns"])) {
      problems.push(`${r.selector} keeps its columns on a phone`);
    }
  }
  return { id: 5, name: "No sideways scroll at 390", ok: problems.length === 0, detail: problems.length ? problems.join("; ") : "Static check passed: nothing wider than 358 px that cannot shrink, long words wrap, a phone layout exists. Measured in a browser by scripts/tile-try.mts." };
}

export function checkFooter(root: El, briefLabels: string[]): TileCheck {
  const inBrief = new Set(briefLabels.map(norm));
  const hidden = new Set(HIDDEN_FOOTER_LINKS.map(norm));
  const shown = els(root).filter((e) => e.tag === "footer").flatMap((f) => els(f).filter((e) => e.tag === "a")).map((a) => textOf(a).trim());
  const bad = shown.filter((l) => !inBrief.has(norm(l)) || hidden.has(norm(l)));
  return {
    id: 6,
    name: "Footer links come from the brief",
    ok: bad.length === 0,
    detail: bad.length ? `Footer links not in the brief, or left out on purpose: ${bad.map((b) => `"${b}"`).join(", ")}` : `${shown.length} footer links, all from the brief${shown.length ? ` (${shown.join(", ")})` : ""}.`,
  };
}

export function checkPlans(root: El): TileCheck {
  const plans = els(root).filter((e) => "data-plan" in e.attrs);
  const bad = plans
    .map((p) => {
      const name = els(p).find((e) => e.tag === "h3");
      const price = els(p).find((e) => "data-price" in e.attrs);
      const n = name ? textOf(name).trim() : "";
      const missing = [n ? "" : "a name", price && textOf(price).trim() ? "" : "a price"].filter(Boolean);
      return missing.length ? `${n || "a plan"} has no ${missing.join(" and no ")}` : "";
    })
    .filter(Boolean);
  return { id: 7, name: "Plans show a name and a price", ok: bad.length === 0, detail: bad.length ? bad.join("; ") : plans.length ? `${plans.length} plans, each with a name and a price.` : "No pricing section." };
}

/** briefLabels: every footer link label the brief holds (briefFooterLabels in style-tile.ts). */
export function checkTile(html: string, sources: string[], t: DesignTokens, briefLabels: string[]): TileChecks {
  const root = parseHtml(html);
  const css = cssOf(root);
  const checks = [checkWords(root, sources), checkSamples(root, t.direction.heroKind), checkOneAccent(css, html, t), checkWeights(css, t), checkPhoneWidth(css), checkFooter(root, briefLabels), checkPlans(root)];
  return { ok: checks.every((c) => c.ok), checks };
}
