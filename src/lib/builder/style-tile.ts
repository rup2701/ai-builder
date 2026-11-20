/**
 * The style tile (APP-42 step 3): one static HTML page that shows the look a showcase site will start from, drawn by code
 * from the saved design brief, the approved brief and the design tokens. No model call: same input, same page.
 *
 *   - Every color, font, weight, size, spacing and radius is a named token on :root (from design-tokens.ts). The rules
 *     below :root only use var(--...), so a later design system input is a drop-in (APP-42 decision 5).
 *   - Every word is the owner's or Scout's approved wording (from the brief), a field name from the design brief's sample
 *     card, a fixed template word, or a marked placeholder. Nothing is invented: no names, numbers or results.
 *   - The sample cards are generic and each is marked Sample, with a Concept preview caption.
 *   - The page says it is indicative: the hero and the sections show the look, not the final layout or copy.
 *   - The page reflows with container queries, so a 390 px frame shows the phone layout.
 *
 * Pure: no model, no database, no network. The checks on the result are in tile-checks.ts.
 */
import { sensitiveVertical, type DesignBrief } from "./design-brief";
import { contrast, type DesignTokens } from "./design-tokens";
import { tileIcon } from "./tile-icons";

/** Raised when the template changes in a way that should mark saved tiles stale. */
export const TILE_TEMPLATE_VERSION = 4;
/** The large feature card is used only when its title and line together have at least this many characters. */
export const BIG_CARD_MIN = 100;

export const INDICATIVE = "Indicative: the hero and the sections show the look, not the final layout or copy.";
export const CAPTION = "Concept preview · sample cards, not real data";
export const SAMPLE = "Sample";
/** Section labels the template adds above a heading (eyebrows). */
export const EYEBROWS: Record<string, string> = {
  benefits_bento: "Features",
  how_it_works: "How it works",
  pricing: "Pricing",
  faq: "FAQ",
  use_case_cards: "Use cases",
  examples_gallery: "Examples",
};
/** Every fixed word the template itself puts on the page. Check 1 accepts these and nothing else that is not sourced. */
export const TEMPLATE_WORDS = [INDICATIVE, CAPTION, SAMPLE, "+", "→", ...Object.values(EYEBROWS)];
/**
 * Footer links the showcase pack's default footer adds that the tile leaves out, even when the brief lists them (RP, 20
 * November): no page stands behind them unless the owner makes one. Check 6 fails if one appears.
 */
export const HIDDEN_FOOTER_LINKS = ["About", "Docs", "Changelog", "Security"];
const hiddenFooter = (label: string) => HIDDEN_FOOTER_LINKS.some((h) => h.toLowerCase() === label.trim().toLowerCase());

/** Every footer link label the brief holds: its footer columns, its legal links and its Sign in link. */
export function briefFooterLabels(brief: Rec): string[] {
  const f = blockOf(brief, "footer");
  if (!f) return [];
  return [...arr(f.columns).flatMap((c) => arr(c.links)), ...arr(f.legal_links), ...(f.sign_in ? [f.sign_in as Rec] : [])].map((l) => str(l.label)).filter(Boolean);
}

/** The footer links the tile shows: the brief's, in its order, without the hidden ones and without repeats. */
export const footerLinks = (brief: Rec) => [...new Set(briefFooterLabels(brief).filter((l) => !hiddenFooter(l)))];

/** A placeholder: one short label in brackets, for something only the owner can supply. */
export const PLACEHOLDER = /^\[[^\]]+: owner to supply[^\]]*\]$/;

// ---- reading the brief ----

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Rec[]) : []);
const blocksOf = (brief: Rec) => arr(brief.blocks);
const blockOf = (brief: Rec, type: string) => blocksOf(brief).find((b) => b.type === type);

/** The sections the page shows, in the brief's order, without the ones the owner turned off. */
export function sectionOrder(brief: Rec): string[] {
  const plan = (brief.page_plan ?? {}) as { order?: string[]; optional?: Record<string, boolean> };
  const order = Array.isArray(plan.order) && plan.order.length ? plan.order : blocksOf(brief).map((b) => String(b.type));
  return order.filter((t) => plan.optional?.[t] !== false && blockOf(brief, t));
}

/** Testimonials stay off the tile when a care rule (code or model) or a sensitive vertical says so. */
export function testimonialsOff(db: DesignBrief, brief: Rec): boolean {
  if (sensitiveVertical(brief, db.care)) return true;
  return db.care.some((c) => /testimonial/i.test(c.rule) && /(leav\w* .*out|without it|do not show|never sample|stay marked sample)/i.test(c.rule));
}

/**
 * Every piece of text the tile may show that comes from the brief or the design brief (check 1's sources). The keys are the
 * wording fields only: notes, rules and Scout's working text in the brief are never on the page. Testimonials' sample quotes
 * are never a source.
 */
export function tileSources(db: DesignBrief, brief: Rec): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const s = str(v);
    if (s) out.push(s);
  };
  add(db.name.value);
  add((brief.site as Rec | undefined)?.name);
  for (const n of arr(brief.nav)) add(n.label);
  add((brief.sign_in as Rec | undefined)?.label);
  for (const b of blocksOf(brief)) {
    if (b.type === "testimonials") continue;
    for (const k of ["headline", "subheadline", "heading", "tagline"]) add(b[k]);
    for (const k of ["cta", "secondary_cta", "sign_in"]) add((b[k] as Rec | undefined)?.label);
    for (const it of arr(b.items)) for (const k of ["title", "text", "q", "label"]) add(it[k]);
    for (const p of arr(b.plans)) {
      for (const k of ["name", "price_label", "period_label", "button"]) add(p[k]);
      for (const f of Array.isArray(p.features) ? p.features : []) add(f);
    }
    for (const c of arr(b.columns)) for (const l of arr(c.links)) add(l.label);
    for (const l of arr(b.legal_links)) add(l.label);
  }
  for (const p of db.plans) {
    add(p.name);
    add(p.price);
    add(p.length);
  }
  add(db.sample_card.item);
  for (const f of db.sample_card.fields) {
    add(f.label);
    add(f.filler);
  }
  for (const p of db.placeholders) add(p.text);
  return out;
}

// ---- HTML ----

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** :root, from the tokens. The only place in the page that holds a color or a length. */
export function rootCss(t: DesignTokens): string {
  const c = t.color;
  const font = (f: string | null) => (f ? `"${f}", ui-sans-serif, system-ui, sans-serif` : "inherit");
  const px = (n: number) => `${n}px`;
  // Feature icons sit on a small tile (a tint in light mode, the 900 step in dark mode), stroked in the accent where it
  // reaches 3:1 on that tile, otherwise the 700 step (look.md, Icons).
  const iconTile = t.mode === "dark" ? c.tint900 : c.tint100;
  const iconStroke = contrast(c.accent, iconTile) >= 3 ? c.accent : c.tint700;
  const vars: Record<string, string> = {
    bg: c.background, surface: c.surface, border: c.border, text: c.text, muted: c.muted,
    inverse: c.inverse, "on-inverse": c.onInverse, accent: c.accent, "on-accent": c.onAccent, "accent-text": c.accentText,
    "tint-50": c.tint50, "tint-100": c.tint100, "tint-200": c.tint200, "tint-300": c.tint300, "tint-700": c.tint700, "tint-900": c.tint900,
    glow: c.glow, dot: c.dot, edge: c.edge, "shadow-color": c.shadow, transparent: "#00000000",
    "font-heading": font(t.font.heading), "font-body": font(t.font.body), "font-accent": font(t.font.accent ?? t.font.body),
    "w-headline": String(t.font.weight.headline), "w-strong": String(t.font.weight.strong), "w-title": String(t.font.weight.title),
    "w-medium": String(t.font.weight.medium), "w-body": String(t.font.weight.body), "w-numeral": String(t.font.weight.numeral),
    caps: t.font.capsLabels ? "uppercase" : "none", "tr-caps": t.font.capsLabels ? `${t.type.capsTracking}em` : "0em",
    "fs-hero": px(t.type.hero[0]), "fs-hero-phone": px(t.type.hero[1]), "tr-hero": `${t.type.heroTracking}em`, "lh-hero": String(t.type.heroLine),
    "fs-section": px(t.type.section[0]), "fs-section-phone": px(t.type.section[1]), "tr-section": `${t.type.sectionTracking}em`, "lh-section": String(t.type.sectionLine),
    "fs-body": px(t.type.body[0]), "fs-body-phone": px(t.type.body[1]), "lh-body": String(t.type.bodyLine),
    "fs-small": px(t.type.small), "fs-label": px(t.type.label), "fs-eyebrow": px(t.type.eyebrow), "tr-eyebrow": `${t.type.eyebrowTracking}em`,
    "fs-caption": px(t.type.caption), "fs-card-title": px(t.type.cardTitle), "fs-price": px(t.type.price), "fs-logo": px(20),
    "fs-numeral": px(t.type.numeral[0]), "fs-numeral-phone": px(t.type.numeral[1]),
    "sp-section": px(t.space.section[0]), "sp-section-phone": px(t.space.section[1]),
    gutter: px(t.space.gutter[0]), "gutter-phone": px(t.space.gutter[1]),
    pad: px(t.space.cardPad[0]), "pad-phone": px(t.space.cardPad[1]), gap: px(t.space.gap), "gap-small": px(8), "gap-tiny": px(4),
    "content-max": px(t.space.contentMax), "text-max": px(640), "heading-gap": px(t.space.headingGap), "hero-gap": px(t.space.heroGap),
    "btn-h": px(t.space.buttonHeight), "btn-pad": px(22), line: px(1), "line-strong": px(2), "card-min": px(240), "sample-w": px(300),
    "stack-h": px(320), "stack-h-phone": px(280), "stack-shift": px(28), "band-pad": px(10), "icon": px(40), "dot-mark": px(8), "icon-tile": iconTile, "icon-stroke": iconStroke, "icon-glyph": px(22), "icon-big": px(56), "icon-glyph-big": px(30), "mini-w": px(150), "mini-h": px(96), "mini-bar": px(8), "mini-chip-w": px(40), "mini-chip-h": px(14),
    "r-card": px(t.radius.card), "r-closing": px(t.radius.closing), "r-small": px(t.radius.small), "r-round": px(t.radius.round),
    "dot-grid": px(t.depth.dotGrid), "dot-size": px(t.depth.dotSize),
    "glow-x": `${t.depth.glowAt[0]}%`, "glow-y": `${t.depth.glowAt[1]}%`, "glow-w": `${t.depth.glowSize[0]}%`, "glow-h": `${t.depth.glowSize[1]}%`,
    shadow: `0 12px 30px var(--shadow-color)`, "tilt-1": "-5deg", "tilt-2": "2deg", "tilt-3": "6deg",
  };
  return `:root{${Object.entries(vars).map(([k, v]) => `--${k}:${v}`).join(";")}}`;
}

/** The page's rules. They use var(--...) only: no color or length is written here. */
const RULES = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;background:var(--bg)}
a{color:inherit;text-decoration:none}
body{font-family:var(--font-body);font-weight:var(--w-body);font-size:var(--fs-body);line-height:var(--lh-body);color:var(--text);overflow-wrap:anywhere}
.tile{container-type:inline-size;container-name:tile;min-height:100vh;background-image:radial-gradient(ellipse var(--glow-w) var(--glow-h) at var(--glow-x) var(--glow-y),var(--glow),var(--transparent)),radial-gradient(var(--dot) var(--dot-size),var(--transparent) var(--dot-size));background-size:100% 100%,var(--dot-grid) var(--dot-grid);background-repeat:no-repeat,repeat}
.page{--fs-hero-now:var(--fs-hero);--fs-section-now:var(--fs-section);--sp-now:var(--sp-section);--gutter-now:var(--gutter);--pad-now:var(--pad);--fs-numeral-now:var(--fs-numeral)}
.wrap{max-width:var(--content-max);margin:0 auto;padding:0 var(--gutter-now)}
.band{margin:0;padding:var(--band-pad) var(--gutter-now);background:var(--surface);border-bottom:var(--line) dashed var(--border);color:var(--muted);font-size:var(--fs-caption);text-align:center}
.caps{text-transform:var(--caps);letter-spacing:var(--tr-caps)}
header .wrap{display:flex;align-items:center;justify-content:space-between;gap:var(--gap);padding-top:var(--gap);padding-bottom:var(--gap)}
.logo{font-family:var(--font-heading);font-weight:var(--w-strong);font-size:var(--fs-logo)}
nav{display:flex;align-items:center;gap:var(--gap)}
nav a{color:var(--muted);text-decoration:none;font-size:var(--fs-label);font-weight:var(--w-title)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:var(--btn-h);padding:0 var(--btn-pad);border-radius:var(--r-round);background:var(--accent);color:var(--on-accent);font-weight:var(--w-title);font-size:var(--fs-label);text-decoration:none;border:var(--line) solid var(--accent)}
.btn.ghost{background:var(--transparent);color:var(--text);border-color:var(--border)}
.btn.small{min-height:var(--icon)}
.hero{padding:var(--sp-now) 0}
.hero .wrap{display:grid;gap:var(--hero-gap);align-items:center}
.hero.split .wrap{grid-template-columns:1.05fr 1fr}
.hero.centred .wrap{text-align:center;justify-items:center}
h1,h2{font-family:var(--font-heading);font-weight:var(--w-headline);margin:0}
h1{font-size:var(--fs-hero-now);letter-spacing:var(--tr-hero);line-height:var(--lh-hero)}
h1 em{font-style:normal;color:var(--accent-text)}
h2{font-size:var(--fs-section-now);letter-spacing:var(--tr-section);line-height:var(--lh-section)}
.lead{margin:var(--heading-gap) 0 var(--hero-gap);color:var(--muted);max-width:var(--text-max)}
.actions{display:flex;flex-wrap:wrap;gap:var(--gap-small)}
.hero.centred .actions{justify-content:center}
.stack{position:relative;min-height:var(--stack-h);display:grid;place-items:center}
.sample-card{position:absolute;width:var(--sample-w);max-width:100%;padding:var(--gap);border-radius:var(--r-card);background:var(--surface);border:var(--line) solid var(--border);box-shadow:var(--shadow);text-align:left}
.sample-card.s1{transform:translate(calc(var(--stack-shift) * -1),calc(var(--stack-shift) * -1)) rotate(var(--tilt-1))}
.sample-card.s2{transform:rotate(var(--tilt-2))}
.sample-card.s3{transform:translate(var(--stack-shift),var(--stack-shift)) rotate(var(--tilt-3));border-color:var(--accent)}
.stack.list{display:grid;gap:var(--gap-small);min-height:0}
.stack.list .sample-card{position:static;transform:none;width:100%}
.frame{border-radius:var(--r-card);border:var(--line) solid var(--border);background:var(--surface);box-shadow:var(--shadow);overflow:hidden}
.frame .bar{display:flex;gap:var(--gap-tiny);padding:var(--gap-small) var(--gap)}
.frame .bar i{width:var(--dot-mark);height:var(--dot-mark);border-radius:var(--r-round);background:var(--border)}
.frame .stack{padding:var(--gap)}
.top{display:flex;justify-content:space-between;align-items:center;gap:var(--gap-small);font-size:var(--fs-caption);color:var(--muted);font-weight:var(--w-title)}
.chip{display:inline-flex;align-items:center;padding:0 var(--gap-small);border-radius:var(--r-round);border:var(--line) solid var(--accent);color:var(--accent-text);font-size:var(--fs-caption);font-weight:var(--w-title)}
.sample-title{margin:var(--gap-small) 0;font-family:var(--font-heading);font-weight:var(--w-strong);font-size:var(--fs-card-title)}
.row{display:flex;justify-content:space-between;gap:var(--gap-small);font-size:var(--fs-small);color:var(--muted);border-top:var(--line) solid var(--border);padding-top:var(--gap-tiny);margin-top:var(--gap-tiny)}
.row b{color:var(--text);font-family:var(--font-accent);font-weight:var(--w-strong)}
.caption{margin:var(--gap-small) 0 0;font-size:var(--fs-caption);color:var(--muted)}
.hero.split .caption{text-align:center}
section.s{padding:var(--sp-now) 0 0}
.head{text-align:center;max-width:var(--text-max);margin:0 auto var(--heading-gap)}
.eyebrow{display:block;margin-bottom:var(--gap-small);font-size:var(--fs-eyebrow);letter-spacing:var(--tr-eyebrow);text-transform:uppercase;font-weight:var(--w-strong);color:var(--accent-text)}
.grid{display:grid;gap:var(--gap);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--card-min)),1fr))}
.card{padding:var(--pad-now);border-radius:var(--r-card);background:var(--surface);border:var(--line) solid var(--border);box-shadow:inset 0 var(--line) 0 var(--edge)}
.grid.bento{grid-template-columns:repeat(4,1fr)}
.grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.card.big{grid-column:span 2;grid-row:span 2;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(135deg,var(--tint-900),var(--surface));border-color:var(--tint-700)}
.card.big h3{font-size:var(--fs-section-now);font-family:var(--font-heading);font-weight:var(--w-strong);letter-spacing:var(--tr-section);line-height:var(--lh-section)}
.card.big p{font-size:var(--fs-body)}
.card.big .card-icon{width:var(--icon-big);height:var(--icon-big)}
.card.big .card-icon svg{width:var(--icon-glyph-big);height:var(--icon-glyph-big)}
.grid.bento .card.wide{grid-column:span 2}
.card h3,.plan h3{margin:0 0 var(--gap-small);font-size:var(--fs-card-title);font-weight:var(--w-title)}
.card p,.plan li{margin:0;color:var(--muted);font-size:var(--fs-small)}
.card-icon{display:inline-flex;align-items:center;justify-content:center;width:var(--icon);height:var(--icon);margin-bottom:var(--gap);border-radius:var(--r-small);background:var(--icon-tile);color:var(--icon-stroke)}
.card-icon svg{width:var(--icon-glyph);height:var(--icon-glyph)}
.steps{display:grid;gap:var(--gap);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--card-min)),1fr))}
.step{border-top:var(--line-strong) solid var(--accent);padding-top:var(--gap)}
.step h3{margin:var(--gap-small) 0;font-size:var(--fs-card-title);font-weight:var(--w-strong)}
.step p{margin:0;color:var(--muted);font-size:var(--fs-small)}
.numeral{font-family:var(--font-heading);font-size:var(--fs-numeral-now);line-height:1;color:var(--accent-text);font-weight:var(--w-strong)}
.numeral[data-signature="oversized-numerals"]{font-weight:var(--w-numeral)}
.plan{display:flex;flex-direction:column;gap:var(--gap-small);padding:var(--pad-now);border-radius:var(--r-card);background:var(--surface);border:var(--line) solid var(--border)}
.plan.highlight{border:var(--line-strong) solid var(--accent)}
.plan .unit{color:var(--muted);font-size:var(--fs-label);font-weight:var(--w-title)}
.price{font-family:var(--font-heading);font-size:var(--fs-price);font-weight:var(--w-strong);color:var(--accent-text)}
.plan ul{list-style:none;margin:0;padding:0;display:grid;gap:var(--gap-tiny);flex:1}
.plan .btn{margin-top:var(--gap)}
.faq{max-width:var(--content-max);display:grid;gap:var(--gap-small)}
.q{display:flex;justify-content:space-between;gap:var(--gap);padding:var(--gap);border-radius:var(--r-small);background:var(--surface);border:var(--line) solid var(--border);font-weight:var(--w-medium)}
.q span:last-child{color:var(--accent-text)}
.closing{padding:var(--sp-now) var(--pad-now);border-radius:var(--r-closing);background:linear-gradient(135deg,var(--tint-900),var(--surface));border:var(--line) solid var(--tint-700);text-align:center;position:relative;overflow:hidden}
.closing .lead{margin-left:auto;margin-right:auto}
.closing .actions{justify-content:center}
.motif{position:absolute;right:var(--pad-now);top:50%;width:var(--mini-w);height:var(--mini-h);transform:translateY(-50%)}
.mini{position:absolute;inset:0;padding:var(--gap-small);border-radius:var(--r-small);border:var(--line) solid var(--border);background:var(--surface);box-shadow:var(--shadow);display:flex;flex-direction:column;gap:var(--gap-small)}
.mini:nth-child(1){transform:translate(calc(var(--stack-shift) * -0.5),calc(var(--stack-shift) * -0.5)) rotate(var(--tilt-1))}
.mini:nth-child(2){transform:rotate(var(--tilt-2))}
.mini:nth-child(3){transform:translate(calc(var(--stack-shift) * 0.5),calc(var(--stack-shift) * 0.5)) rotate(var(--tilt-3));border-color:var(--accent)}
.mini b{display:block;width:var(--mini-chip-w);height:var(--mini-chip-h);align-self:flex-end;border-radius:var(--r-round);border:var(--line) solid var(--accent)}
.mini i{display:block;height:var(--mini-bar);border-radius:var(--r-round);background:var(--border)}
.mini i:last-child{width:60%}
.notice{margin:var(--sp-now) auto 0;max-width:var(--text-max);padding:var(--gap);border:var(--line) dashed var(--border);border-radius:var(--r-small);color:var(--muted);font-size:var(--fs-label);text-align:center}
footer{margin-top:var(--sp-now);border-top:var(--line) solid var(--border)}
footer .wrap{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--gap);padding-top:var(--pad-now);padding-bottom:var(--pad-now);color:var(--muted);font-size:var(--fs-label)}
footer .links{display:flex;flex-wrap:wrap;gap:var(--gap)}
@container tile (max-width: 640px){
.page{--fs-hero-now:var(--fs-hero-phone);--fs-section-now:var(--fs-section-phone);--sp-now:var(--sp-section-phone);--gutter-now:var(--gutter-phone);--pad-now:var(--pad-phone);--fs-numeral-now:var(--fs-numeral-phone);font-size:var(--fs-body-phone)}
nav a:not(.btn){display:none}
.hero.split .wrap{grid-template-columns:1fr}
.stack{min-height:var(--stack-h-phone)}
.grid.bento,.grid.cols-2,.grid.cols-3{grid-template-columns:1fr}
.card.big,.grid.bento .card.wide{grid-column:auto;grid-row:auto}
}
@container tile (max-width: 1100px){
.motif{display:none}
}`;

/**
 * Columns for a grid of equal cards: never four in one row (RP, 20 November). Four make a 2x2; two and three sit side by
 * side; five or more run three to a row. A phone always shows one column.
 */
export const cardColumns = (n: number) => (n <= 1 ? 1 : n === 2 || n === 4 ? 2 : 3);

function sampleCard(db: DesignBrief, n: number, cls: string): string {
  const [first, ...rest] = db.sample_card.fields;
  const rows = rest.slice(0, 3).map((f) => `<div class="row"><span>${esc(f.label)}</span><b>${esc(f.filler)}</b></div>`).join("");
  return `<div class="sample-card ${cls}" data-sample-card="${n}"><div class="top"><span class="caps">${esc(db.sample_card.item)}</span><span class="chip caps" data-sample>${SAMPLE}</span></div>${first ? `<div class="sample-title">${esc(first.filler)}</div>` : ""}${rows}</div>`;
}

function heroVisual(db: DesignBrief, t: DesignTokens): string {
  if (t.direction.heroKind === "owner-art") return `<div class="notice">[Product image: owner to supply]</div>`;
  const stack = t.direction.motif === "Stack" && t.direction.heroKind === "fragment";
  const cards = [1, 2, 3].map((n) => sampleCard(db, n, stack ? `s${n}` : "")).join("");
  const inner = `<div class="stack${stack ? "" : " list"}">${cards}</div>`;
  const body = t.direction.heroKind === "frame" ? `<div class="frame"><div class="bar"><i></i><i></i><i></i></div>${inner}</div>` : inner;
  return `<div class="visual">${body}<p class="caption">${esc(CAPTION)}</p></div>`;
}

/** The headline with its last sentence in the accent, when it has more than one. */
function headline(text: string): string {
  const parts = text.match(/[^.?!]+[.?!]+\s*/g);
  if (!parts || parts.length < 2) return esc(text);
  const tail = parts.pop()!.trim();
  return `${esc(parts.join("").trim())} <em>${esc(tail)}</em>`;
}

const sectionHead = (type: string, heading: string) =>
  `<div class="head">${EYEBROWS[type] ? `<span class="eyebrow">${esc(EYEBROWS[type])}</span>` : ""}<h2>${esc(heading)}</h2></div>`;

/** The plan's highlight comes from the design brief only, where the owner asked for it with a quote. Equal plans otherwise. */
function planHighlighted(db: DesignBrief, name: string): boolean {
  const p = db.plans.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return !!(p && p.highlight && p.highlight_quote);
}

function section(type: string, b: Rec, db: DesignBrief, t: DesignTokens, brief: Rec): string {
  const heading = str(b.heading);
  const oversized = t.direction.signatures.includes("oversized-numerals");
  const sig = oversized ? ` data-signature="oversized-numerals"` : "";
  switch (type) {
    case "benefits_bento":
    case "use_case_cards":
    case "examples_gallery": {
      const items = arr(b.items);
      // The bento: the first card is the large one (two columns, two rows on a grid of four) only when it has enough to say
      // to fill it (BIG_CARD_MIN characters); otherwise every card is the same size. Small cards widen so the rows beside the
      // large one close (three items: two wide; four: the last wide; five: four small). Each card opens with the icon the brief
      // names (tile-icons.ts); numerals are for How it works only (RP, 20 November).
      const first = items[0] ? `${str(items[0].title)} ${str(items[0].text)}` : "";
      const bento = type === "benefits_bento" && items.length >= 3 && items.length <= 5 && first.length >= BIG_CARD_MIN;
      const cls = (i: number) => (bento && i === 0 ? " big" : bento && ((items.length === 3 && i > 0) || (items.length === 4 && i === 3)) ? " wide" : "");
      const cards = items.map((it, i) => `<div class="card${cls(i)}"><span class="card-icon">${tileIcon(it.icon)}</span><h3>${esc(str(it.title))}</h3><p>${esc(str(it.text))}</p></div>`).join("");
      return `<section class="s" id="${type}"><div class="wrap">${sectionHead(type, heading)}<div class="grid ${bento ? "bento" : `cols-${cardColumns(items.length)}`}">${cards}</div></div></section>`;
    }
    case "how_it_works": {
      const steps = arr(b.items).map((it, i) => `<div class="step"><div class="numeral" data-ordinal${sig}>${i + 1}</div><h3>${esc(str(it.title))}</h3><p>${esc(str(it.text))}</p></div>`).join("");
      return `<section class="s" id="how_it_works"><div class="wrap">${sectionHead(type, heading)}<div class="steps">${steps}</div></div></section>`;
    }
    case "pricing": {
      const plans = arr(b.plans).map((p) => {
        const name = str(p.name);
        const days = typeof p.validity_days === "number" ? String(p.validity_days) : "";
        const period = str(p.period_label);
        const unit = days && period.startsWith(days) ? period.slice(days.length).trim() : "";
        const big = days && unit ? `<div><span class="numeral"${sig}>${esc(days)}</span> <span class="unit caps">${esc(unit)}</span></div>` : "";
        const features = (Array.isArray(p.features) ? p.features : []).map((f) => `<li>${esc(String(f))}</li>`).join("");
        const label = str(p.button) || str((blockOf(brief, "hero")?.cta as Rec | undefined)?.label);
        const hi = planHighlighted(db, name);
        return `<div class="plan${hi ? " highlight" : ""}"><h3>${esc(name)}</h3>${big}<div class="price">${esc(str(p.price_label))}</div><ul>${features}</ul>${label ? `<a class="btn caps${hi ? "" : " ghost"}" href="#">${esc(label)}</a>` : ""}</div>`;
      }).join("");
      return `<section class="s" id="pricing"><div class="wrap">${sectionHead(type, heading)}<div class="grid">${plans}</div></div></section>`;
    }
    case "testimonials":
      if (testimonialsOff(db, brief)) return "";
      return `<section class="s" id="testimonials"><div class="wrap"><div class="notice">[Testimonials: owner to supply real quotes]</div></div></section>`;
    case "faq": {
      const qs = arr(b.items).map((it) => `<div class="q"><span>${esc(str(it.q))}</span><span>+</span></div>`).join("");
      return `<section class="s" id="faq"><div class="wrap">${sectionHead(type, heading)}<div class="faq">${qs}</div></div></section>`;
    }
    case "closing_cta": {
      const cta = str((b.cta as Rec | undefined)?.label);
      const second = str((b.secondary_cta as Rec | undefined)?.label);
      // The Stack motif again, as the pack asks (a motif seen only in the hero is a hero picture): three small cards, each
      // with a chip and two text bars, with no words. Hidden where the closing text needs the room.
      const mini = `<div class="mini"><b></b><i></i><i></i></div>`;
      const motif = t.direction.motif === "Stack" ? `<div class="motif" aria-hidden="true">${mini}${mini}${mini}</div>` : "";
      return `<section class="s" id="closing_cta"><div class="wrap"><div class="closing">${motif}<h2>${esc(str(b.headline))}</h2>${str(b.subheadline) ? `<p class="lead">${esc(str(b.subheadline))}</p>` : ""}<div class="actions">${cta ? `<a class="btn caps" href="#">${esc(cta)}</a>` : ""}${second ? `<a class="btn ghost caps" href="#">${esc(second)}</a>` : ""}</div></div></div></section>`;
    }
    default:
      return "";
  }
}

function fontsLink(t: DesignTokens): string {
  const fam = new Map<string, Set<number>>();
  const want = (f: string | null, ws: number[]) => {
    if (!f) return;
    const s = fam.get(f) ?? new Set<number>();
    ws.forEach((w) => s.add(w));
    fam.set(f, s);
  };
  want(t.font.heading, [t.font.weight.headline, t.font.weight.strong, t.font.weight.numeral]);
  want(t.font.body, [400, 500, 600, 700]);
  want(t.font.accent, [500, 700]);
  const q = [...fam].map(([f, ws]) => `family=${f.replace(/ /g, "+")}:wght@${[...ws].sort((a, b) => a - b).join(";")}`).join("&");
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=swap">`;
}

/** The whole tile as one HTML page. */
export function renderTile(db: DesignBrief, brief: Rec, t: DesignTokens): string {
  const hero = blockOf(brief, "hero") ?? {};
  const name = str((brief.site as Rec | undefined)?.name) || db.name.value;
  const nav = arr(brief.nav);
  const links = nav.filter((n) => n.style !== "button").map((n) => `<a class="caps" href="#">${esc(str(n.label))}</a>`).join("");
  const navButton = nav.find((n) => n.style === "button");
  const cta = str((hero.cta as Rec | undefined)?.label) || str(navButton?.label);
  const second = str((hero.secondary_cta as Rec | undefined)?.label);
  const split = t.direction.heroLayout === "split";
  const heroHtml = `<section class="hero ${split ? "split" : "centred"}"><div class="wrap"><div><h1>${headline(str(hero.headline))}</h1>${str(hero.subheadline) ? `<p class="lead">${esc(str(hero.subheadline))}</p>` : ""}<div class="actions">${cta ? `<a class="btn caps" href="#">${esc(cta)}</a>` : ""}${second ? `<a class="btn ghost caps" href="#">${esc(second)}</a>` : ""}</div></div>${heroVisual(db, t)}</div></section>`;

  const body = sectionOrder(brief)
    .filter((type) => !["hero", "footer"].includes(type))
    .map((type) => section(type, blockOf(brief, type)!, db, t, brief))
    .join("");
  const notices = db.placeholders.map((p) => `<div class="notice">${esc(p.text)}</div>`).join("");

  const footer = blockOf(brief, "footer");
  const footLinks = footerLinks(brief).map((l) => `<a class="caps" href="#" data-footer-link>${esc(l)}</a>`);
  const footerHtml = footer ? `<footer><div class="wrap"><span>${esc(str(footer.tagline) || name)}</span><span class="links">${footLinks.join("")}</span></div></footer>` : "";

  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(name)} style tile</title>`,
    fontsLink(t),
    `<style>${rootCss(t)}${RULES}</style></head>`,
    `<body><div class="tile"><div class="page">`,
    `<p class="band">${esc(INDICATIVE)}</p>`,
    `<header><div class="wrap"><span class="logo">${esc(name)}</span><nav>${links}${cta ? `<a class="btn small caps" href="#">${esc(cta)}</a>` : ""}</nav></div></header>`,
    heroHtml,
    body,
    notices ? `<div class="wrap">${notices}</div>` : "",
    footerHtml,
    `</div></div></body></html>`,
  ].join("");
}
