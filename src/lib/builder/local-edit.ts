import { validateSiteBrief } from "./site-brief";

/**
 * Small, code-checked changes to a restaurant brief before it is built, and the brief a restaurant owner without a website gets from
 * what they typed. The model never writes facts: every value here must be the person's own words (the caller checks that against what
 * they wrote), and code turns a pasted menu into sections and dishes. Nothing is filled in: what was not given stays empty and is listed in not_found.
 */

type Brief = Record<string, unknown>;

export const TEXT_FIELDS = ["name", "tagline", "kind_label"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
const MAX: Record<TextField, number> = { name: 80, tagline: 140, kind_label: 60 };

/** Sections the owner can switch off. The hero and the footer are always there. */
export const SWITCHABLE = ["highlights", "menu", "about", "gallery", "reviews", "catering", "ways"] as const;
export type Switchable = (typeof SWITCHABLE)[number];
const MIN_GALLERY = 3;

const clone = (b: Brief): Brief => JSON.parse(JSON.stringify(b));
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

const MIN_HIGHLIGHTS = 3;
const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");

/**
 * Whether the brief has anything to show in a section. This mirrors the page rules of the local-business pack (visibleSections in its content.ts),
 * so the plan card does not offer a section that would be left out anyway. A section with nothing to show stays out even when it is switched on.
 */
export function sectionHasContent(b: Brief, s: Switchable): boolean {
  const menu = ((b.menu as { categories?: { items?: { name?: string }[] }[]; highlights?: string[] } | undefined) ?? {});
  const dishes = (menu.categories ?? []).flatMap((c) => c.items ?? []);
  const images = (b.images ?? {}) as { gallery?: { alt?: string }[]; use_photos?: boolean };
  const links = (b.links ?? {}) as Record<string, unknown>;
  const phone = str((b.contact as { phone?: unknown } | undefined)?.phone);
  switch (s) {
    case "menu": return dishes.length > 0;
    // The story's first paragraph fills this section, so a story or an about text is enough.
    case "about": return Boolean(b.about || b.story);
    case "gallery": return (images.gallery?.length ?? 0) >= MIN_GALLERY;
    case "reviews": return ((b.testimonials as unknown[] | undefined) ?? []).length > 0;
    case "catering": return Boolean(b.catering);
    case "highlights": {
      // Pinned dishes first; else dishes with a picture whose description is exactly the dish name (and only when pictures are allowed).
      const names = new Set(dishes.map((d) => norm(d.name ?? "")));
      const pinned = (menu.highlights ?? []).filter((n) => names.has(norm(n))).length;
      if (pinned) return pinned >= MIN_HIGHLIGHTS;
      if (!images.use_photos) return false;
      const alts = new Set((images.gallery ?? []).map((g) => norm(g.alt ?? "")));
      return dishes.filter((d) => alts.has(norm(d.name ?? ""))).length >= MIN_HIGHLIGHTS;
    }
    case "ways": {
      // Needs at least two cards. The site always gets a way to request a table; the others need a menu, an order link, or catering with a phone or link.
      const cards = 1 + (dishes.length || str(links.menu) ? 1 : 0) + (str(links.order) || ((links.delivery as unknown[] | undefined)?.length ?? 0) ? 1 : 0) + (b.catering && (str(links.catering) || phone) ? 1 : 0);
      return cards >= 2;
    }
  }
}

export type EditResult = { ok: true; brief: Brief; said: string } | { ok: false; error: string };

/** Change the name, the tagline or the line above the name. The value must be what the person typed; the caller checks that. */
export function setText(brief: Brief, field: unknown, value: unknown): EditResult {
  if (!TEXT_FIELDS.includes(field as TextField)) return { ok: false, error: "Only the name, the tagline and the line above the name can be changed here." };
  const f = field as TextField;
  const v = typeof value === "string" ? clean(value) : "";
  if (!v) return { ok: false, error: "The new text is empty." };
  if (v.length > MAX[f]) return { ok: false, error: `That is too long. Keep it under ${MAX[f]} characters.` };
  if (/[<>]|https?:\/\//i.test(v)) return { ok: false, error: "Plain words only, with no links or tags." };
  const next = clone(brief);
  const site = { ...((next.site ?? {}) as Record<string, unknown>) };
  site[f] = v;
  next.site = site;
  const ok = validateSiteBrief(next, "local");
  if (!ok.ok) return { ok: false, error: ok.error };
  return { ok: true, brief: ok.brief as unknown as Brief, said: `${f === "kind_label" ? "The line above the name" : f === "name" ? "The name" : "The tagline"} is now "${v}".` };
}

/** Template mode: the page draws every section, with placeholder blocks where there is no content (page_plan.scaffold, set on every restaurant brief). Ways to order needs real links, so it never gets a placeholder. */
export const isScaffoldBrief = (b: Brief): boolean => (b.page_plan as { scaffold?: boolean } | undefined)?.scaffold === true;
const hasPlaceholder = (b: Brief, s: Switchable): boolean => isScaffoldBrief(b) && s !== "ways";

/** Switch a section on or off. Off sections are listed in page_plan.off, which the page already honours. */
export function setSection(brief: Brief, section: unknown, on: unknown): EditResult {
  if (!SWITCHABLE.includes(section as Switchable)) return { ok: false, error: `Sections that can be switched are: ${SWITCHABLE.join(", ")}. The top of the page and the footer are always shown.` };
  if (typeof on !== "boolean") return { ok: false, error: "Say whether the section should be on or off." };
  const s = section as Switchable;
  const next = clone(brief);
  const plan = { ...((next.page_plan ?? {}) as Record<string, unknown>) };
  const off = new Set(((plan.off as string[] | undefined) ?? []).filter((x) => typeof x === "string"));
  if (on) off.delete(s); else off.add(s);
  plan.off = [...off];
  next.page_plan = plan;
  const ok = validateSiteBrief(next, "local");
  if (!ok.ok) return { ok: false, error: ok.error };
  const has = sectionHasContent(next, s) || hasPlaceholder(next, s);
  const note = on && !has ? ` There is nothing to show in it yet (it was not found on the website or given by the owner), so it will not appear until there is.` : "";
  return { ok: true, brief: ok.brief as unknown as Brief, said: `The ${s} section is now ${on ? "on" : "off"}.${note}` };
}

export const SECTION_LABEL: Record<Switchable, string> = { highlights: "Menu highlights", menu: "Menu", about: "About", gallery: "Our Food", reviews: "Customer reviews", catering: "Catering", ways: "Ways to order" };
const NEEDS: Record<Switchable, string> = { highlights: " (needs pictures of your dishes)", menu: " (needs your content)", about: " (needs your content)", gallery: " (needs your content)", reviews: " (needs your content)", catering: " (needs your content)", ways: " (needs a menu or an order link)" };

/**
 * The page plan Scout shows once the brief is saved, in the format the chat turns into a card of ticks (plan-card.ts): the sections that
 * are on, and "more sections to add" for the ones that are off or have nothing to show yet. The hero and the footer are always there.
 * Written by code from the brief, so it only ever lists what the page rules know about.
 */
export function localPlanText(b: Brief): string {
  const off = new Set(sectionsOff(b));
  const added: string[] = ["Hero"];
  const extra: string[] = [];
  for (const s of SWITCHABLE) {
    const has = sectionHasContent(b, s);
    if (off.has(s)) extra.push(SECTION_LABEL[s]);
    else if (!has && hasPlaceholder(b, s)) added.push(SECTION_LABEL[s] + " (placeholder until you add it)");
    else if (!has) extra.push(SECTION_LABEL[s] + NEEDS[s]);
    else added.push(SECTION_LABEL[s]);
  }
  added.push("Footer");
  return ["Here is your page. Tick the sections you want, then press Looks good.", "", "I've added these sections:", ...added.map((x) => `- ${x}`), "", "More sections to add:", ...(extra.length ? extra : ["Nothing else to add right now"]).map((x) => `- ${x}`)].join("\n");
}

const sectionOfLabel = (name: string): Switchable | undefined => SWITCHABLE.find((s) => name.trim().toLowerCase().startsWith(SECTION_LABEL[s].toLowerCase()));

/**
 * The person's answer to the plan card ("Looks good. Add: Customer reviews. Drop: Catering."), applied by code with no model call.
 * Returns null when the text is not a plan answer. A section with nothing to show can be ticked, but stays out until there is something.
 */
export function applyPlanReply(b: Brief, text: string): { brief: Brief; said: string } | null {
  const t = text.trim();
  if (!/^looks good\./i.test(t)) return null;
  const list = (word: string) => { const m = new RegExp(`${word}: (.+?)\\.(?: |$)`, "i").exec(t); return m ? m[1].split(/,\s*/).map(sectionOfLabel).filter((x): x is Switchable => Boolean(x)) : []; };
  let cur = b;
  const empty: string[] = [];
  for (const [sections, on] of [[list("add"), true], [list("drop"), false]] as const) {
    for (const sec of sections) {
      const r = setSection(cur, sec, on);
      if (!r.ok) continue;
      cur = r.brief;
      if (on && !sectionHasContent(cur, sec) && !hasPlaceholder(cur, sec)) empty.push(SECTION_LABEL[sec]);
    }
  }
  const off = sectionsOff(cur).map((x) => SECTION_LABEL[x as Switchable]).filter(Boolean);
  const said = [
    off.length ? `Done. Left off: ${off.join(", ")}.` : "Done. Nothing is switched off.",
    empty.length ? `${empty.join(" and ")} ${empty.length === 1 ? "has" : "have"} nothing to show yet, so ${empty.length === 1 ? "it" : "they"} will appear once there is content for ${empty.length === 1 ? "it" : "them"}. After the site is built you can add it in the change box.` : "",
    "Press Build my site when you are ready.",
  ].filter(Boolean).join(" ");
  return { brief: cur, said };
}

/** The sections switched off in a brief. */
export const sectionsOff = (b: Brief): string[] => (((b.page_plan as { off?: string[] } | undefined)?.off) ?? []).filter((x) => typeof x === "string");

// ---- A pasted menu --------------------------------------------------------------------------------------------------

const PRICE = /^(.*?)(?:\s*[-–—:|·]\s*|\s{2,}|\s+)(\$?\d{1,4}(?:[.,]\d{1,2})?)\s*$/;
const BULLET = /^[\s\-*•·▪►]+/;

/** True when a line names a menu section rather than a dish: it ends with a colon, starts with #, or is a short all-capitals line. */
function isHeader(line: string): boolean {
  if (/^#{1,3}\s*\S/.test(line)) return true;
  if (/:$/.test(line)) return true;
  const t = line.replace(BULLET, "");
  return t.length <= 32 && /[A-Z]/.test(t) && t === t.toUpperCase() && !/\d/.test(t);
}
const headerText = (line: string) => clean(line.replace(/^#{1,3}\s*/, "").replace(/:$/, "")).replace(/\b([A-Za-z])([A-Za-z']*)/g, (_, a: string, r: string) => a.toUpperCase() + r.toLowerCase());

/**
 * Turns a menu the owner typed into sections and dishes, line by line. A line with a price at the end is a dish with that price exactly as typed;
 * a line without one is a dish with no price; a header line starts a new section. Descriptions are not guessed at: a line over 80 characters is rejected.
 * The result only ever holds the owner's own words.
 */
export function parseMenuText(text: string): { ok: true; categories: { name: string; items: { name: string; price?: string }[] }[]; dishes: number } | { ok: false; error: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, error: "The menu is empty." };
  const cats: { name: string; items: { name: string; price?: string }[] }[] = [];
  let cur: { name: string; items: { name: string; price?: string }[] } | null = null;
  for (const raw of lines) {
    if (isHeader(raw)) {
      const name = headerText(raw);
      if (!name || name.length > 40) return { ok: false, error: `The section name "${raw.slice(0, 40)}" is too long.` };
      cur = { name, items: [] };
      cats.push(cur);
      continue;
    }
    const line = clean(raw.replace(BULLET, ""));
    if (!line) continue;
    if (line.length > 80) return { ok: false, error: `This line is too long to be a dish: "${line.slice(0, 40)}…". Put one dish on each line, with its price at the end.` };
    const m = PRICE.exec(line);
    const item = m && clean(m[1]) ? { name: clean(m[1]), price: m[2] } : { name: line };
    if (!cur) { cur = { name: "Menu", items: [] }; cats.push(cur); }
    cur.items.push(item);
  }
  const kept = cats.filter((c) => c.items.length > 0);
  if (!kept.length) return { ok: false, error: "No dishes were found in the menu." };
  if (kept.length > 12 || kept.some((c) => c.items.length > 40)) return { ok: false, error: "That is a very long menu. Keep it under 12 sections and 40 dishes in each for now." };
  return { ok: true, categories: kept, dishes: kept.reduce((n, c) => n + c.items.length, 0) };
}

// ---- A brief from what the owner typed --------------------------------------------------------------------------------

export type OwnerBasics = {
  name: string;
  kind_label: string;
  address?: string;
  phone?: string;
  hours?: string[];
  tagline?: string;
  menu_text?: string;
  story?: string;
};

/**
 * The brief for an owner with no website. Everything comes from OwnerBasics, which the caller has checked against the person's own messages.
 * No pictures (the hero is a colour field), no reviews, no links: those are not invented. What is missing is listed in not_found.
 */
export function briefFromOwner(b: OwnerBasics, consent: { by: string; at: string }): { brief: Brief; notFound: string[] } | { error: string } {
  const name = clean(b.name ?? "");
  const kind = clean(b.kind_label ?? "");
  if (!name) return { error: "The restaurant's name is needed." };
  if (!kind) return { error: "The kind of food is needed (for example: Indian kitchen, pizzeria, cafe)." };
  const address = clean(b.address ?? "");
  const phone = clean(b.phone ?? "");
  const hours = (b.hours ?? []).map(clean).filter(Boolean).slice(0, 14);
  if (!address && !phone && !hours.length) return { error: "At least one way to reach the restaurant is needed: an address, a phone number or opening hours." };
  let categories: { name: string; items: { name: string; price?: string }[] }[] = [];
  if (b.menu_text && b.menu_text.trim()) {
    const m = parseMenuText(b.menu_text);
    if (!m.ok) return { error: m.error };
    categories = m.categories;
  }
  const story = clean(b.story ?? "");
  const tagline = clean(b.tagline ?? "");
  const notFound: string[] = [];
  if (!tagline) notFound.push("tagline");
  if (!story) notFound.push("story page");
  if (!address) notFound.push("address");
  if (!phone) notFound.push("phone");
  if (!hours.length) notFound.push("opening hours");
  if (!categories.length) notFound.push("menu");
  notFound.push("pictures", "customer reviews", "social links", "booking link", "online ordering link");

  const brief: Brief = {
    schema_version: "1.0",
    purpose: "Brief built from details the person typed in the chat, because the restaurant has no website to read. Everything here is their own words (they may be the owner or building the site for the owner). Anything the owner did not give is empty and listed under not_found.",
    site: { name, kind: "local-business", business_type: "restaurant", kind_label: kind, tagline: tagline || null },
    look: { design: "restaurant_001", mode: "light", accent: "#c2410c" },
    contact: { address: address || null, phone: phone || null, email: null, hours },
    links: { reserve: null, order: null, catering: null, menu: null, delivery: [] },
    story: story ? { heading: "Our story", body: story } : null,
    about: null,
    menu: { show_prices: true, highlights: [], categories },
    images: { use_photos: false, owner_confirmed: true, confirmed_by: consent.by, hero: null, about: null, gallery: [] },
    catering: null,
    testimonials: [],
    socials: [],
    page_plan: { default_order: ["hero", "highlights", "menu", "about", "gallery", "reviews", "catering", "ways", "footer"], off: [], scaffold: true },
    source_url: null,
    not_found: notFound,
    not_in_this_version: ["checking which tables are free", "online ordering and payments", "an owner screen for table requests", "multiple locations", "languages other than English"],
    assumptions: [
      "There is no website, so everything here is what was typed in the chat. Nothing was added.",
      "There are no pictures yet, so the top of the page is a colour field. The owner can add pictures later.",
      "Prices are shown exactly as the owner typed them. The owner can hide them with one request.",
      "The accent colour is a default. The owner can ask for another.",
    ],
    placeholders: [],
    consent: { owner_confirmed: true, by: consent.by, at: consent.at, source: "typed_by_the_person_building_the_site" },
  };
  const v = validateSiteBrief(brief, "local");
  if (!v.ok) return { error: v.error };
  return { brief: v.brief as unknown as Brief, notFound };
}

/** The brief with the menu from a spreadsheet. It replaces the menu, drops "menu" from the not-found list and keeps everything else. */
export function withMenu(brief: Brief, categories: { name: string; items: { name: string; price?: string; description?: string }[] }[]): { brief: Brief } | { error: string } {
  const b = brief as Record<string, unknown>;
  const prev = (b.menu ?? {}) as Record<string, unknown>;
  const nf = ((b.not_found as string[] | undefined) ?? []).filter((n) => n !== "menu");
  const next = { ...b, menu: { ...prev, show_prices: prev.show_prices ?? true, highlights: [], categories }, not_found: nf };
  const v = validateSiteBrief(next, "local");
  return v.ok ? { brief: v.brief as unknown as Brief } : { error: "The menu could not be added. " + v.error };
}
