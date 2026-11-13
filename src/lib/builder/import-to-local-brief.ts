import type { ImportResult } from "./site-import";
import type { Consent } from "./import-to-brief";

/**
 * Turns what the website reader found into a local business brief (a restaurant first) for the local-business pack.
 * Everything comes from the reader's result, and the reader only copies what the owner's pages say, so nothing here is invented:
 * what the pages did not give stays empty and is listed in `not_found` for the owner to fill in.
 * The caller must pass proof that the owner said the site and its pictures can be used, or that this is a private test.
 */

type Brief = Record<string, unknown>;

const RESTAURANT = /restaurant|cuisine|kitchen|cafe|café|bistro|diner|eatery|grill|bar\b|pizzeria|bakery|food|dining/i;
const HERO_ALT = /dining|interior|restaurant|dining room|ambiance|ambience|outdoor/i;
const ABOUT_ALT = /chef|team|staff|kitchen|owner/i;
const BUTTON_LINE = /^(order now|order online|book now|reserve( now)?|learn more|read more|click here)$/i;

/** Only https addresses are used as links. */
export function httpsOnly(url: string | undefined): string | null {
  const u = (url ?? "").trim();
  return /^https:\/\//i.test(u) && u.length < 500 ? u : null;
}

/** A page's text without the footer line the reader sometimes keeps (copyright, address, phone, hours) and without button labels that were read as text. */
export function cleanBody(text: string): string {
  const lines = text.split("\n");
  const cut = lines.findIndex((l) => l.includes("©"));
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).map((l) => l.trim()).filter((l) => l && !BUTTON_LINE.test(l));
  return kept.join("\n");
}

function linkFor(actions: ImportResult["actions"], re: RegExp): string | null {
  for (const a of actions ?? []) if (re.test(a.label)) { const u = httpsOnly(a.url); if (u) return u; }
  return null;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function importToLocalBrief(r: ImportResult, consent: Consent, opts: { accent?: string } = {}): { brief: Brief; notFound: string[] } {
  const isTest = !!consent && "privateTest" in consent && consent.privateTest === true && !!consent.by;
  const isOwner = !!consent && "ownerConfirmed" in consent && consent.ownerConfirmed === true && !!consent.confirmedBy;
  if (!isTest && !isOwner) throw new Error("The owner has not confirmed that this site and its pictures can be used.");
  const who = isTest ? (consent as { by: string }).by : (consent as { confirmedBy: string }).confirmedBy;
  if (!r.name) throw new Error("The site gave no name, so there is nothing to build from yet.");
  const menu = r.menu ?? [];
  if (!menu.length && !RESTAURANT.test(r.kind ?? "")) throw new Error("This pack is for restaurants for now, and the site shows neither a menu nor a kind of food business.");
  const notFound: string[] = [];
  const need = (have: unknown, label: string) => { if (!have || (Array.isArray(have) && !have.length)) notFound.push(label); };

  need(r.tagline, "tagline"); need(r.about, "about text"); need(r.address, "address"); need(r.phone, "phone"); need(r.email, "email");
  need(r.hours, "opening hours"); need(menu, "menu"); need(r.testimonials, "customer reviews"); need(r.socials, "social links");

  const reserve = linkFor(r.actions, /reserv|book/i);
  const order = linkFor(r.actions, /order/i);
  const catering = linkFor(r.actions, /cater/i);
  const menuLink = linkFor(r.actions, /menu/i);
  need(reserve, "booking link"); need(order, "online ordering link");

  const withAlt = (r.images ?? []).filter((i) => i.alt && i.alt.trim() && httpsOnly(i.src));
  const noAlt = (r.images ?? []).length - withAlt.length;
  if (noAlt > 0) notFound.push(`${noAlt} picture${noAlt === 1 ? "" : "s"} with no description were left out`);
  const gallery = withAlt.slice(0, 30).map((i) => ({ src: i.src, alt: i.alt.trim() }));
  const pick = (re: RegExp) => { const m = gallery.find((g) => re.test(g.alt)); return m ? { src: m.src, alt: m.alt } : null; };
  const hero = pick(HERO_ALT);
  const aboutImage = pick(ABOUT_ALT);

  // The catering words are the pages that sit under the site's catering address, or are titled catering, with the footer cut off.
  const cat = (r.extras ?? []).filter((e) => /\/cater/i.test(e.url ?? "") || /cater/i.test(e.title));
  const seen = new Set<string>();
  const features = cat.map((e) => ({ title: e.title, body: cleanBody(e.body) })).filter((f) => {
    const k = f.body.toLowerCase();
    if (!f.body || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 4);
  need(features, "catering page");
  const aboutTitle = (r.extras ?? []).find((e) => /story|about/i.test(e.title))?.title;
  // A page the site itself calls its story or journey becomes the story page, in the owner's words with the footer cut off.
  // When the site has none, there is no story page: the interview asks the owner for one.
  const storyExtra = (r.extras ?? []).find((e) => (/story|journey/i.test(e.title) || /\/(our-?)?(story|journey)/i.test(e.url ?? "")) && !/cater/i.test(e.title) && cleanBody(e.body).length > 40);
  const story = storyExtra ? { heading: storyExtra.title, body: cleanBody(storyExtra.body) } : null;
  need(story, "story page");

  const brief: Brief = {
    schema_version: "1.0",
    purpose: isTest
      ? `Private test: a brief built from a public website (${r.sourceUrl}) to try the tool. The owner has not been asked yet, so this must not be published or shown to anyone. Text, menu and pictures belong to the owner. Anything the site did not give is empty and listed under not_found.`
      : `Brief built from the owner's existing website (${r.sourceUrl}), used with the owner's confirmation. Text, menu and pictures are the owner's own. Anything the site did not give is empty and listed under not_found.`,
    site: { name: r.name, kind: "local-business", business_type: "restaurant", kind_label: r.kind ?? null, tagline: r.tagline ?? null },
    look: { design: "restaurant_001", mode: "light", accent: /^#[0-9a-f]{6}$/i.test(opts.accent ?? "") ? opts.accent : "#c2410c" },
    contact: { address: r.address ?? null, phone: r.phone ?? null, email: r.email ?? null, hours: r.hours ?? [] },
    links: { reserve, order, catering, menu: menuLink, delivery: [] },
    story,
    about: r.about ? { heading: aboutTitle ?? "About us", body: r.about } : null,
    menu: {
      show_prices: true,
      highlights: [],
      categories: menu.map((c) => ({ name: c.category, items: c.items.map((i) => (i.price ? { name: i.name, price: i.price } : { name: i.name })) })),
    },
    images: { use_photos: true, owner_confirmed: isOwner, confirmed_by: who, hero, about: aboutImage, gallery },
    catering: features.length ? { heading: "Catering", features } : null,
    testimonials: (r.testimonials ?? []).map((t) => (t.author ? { quote: t.quote, author: t.author } : { quote: t.quote })),
    socials: (r.socials ?? []).map((s) => ({ label: cap(s.network), url: s.url })).filter((s) => httpsOnly(s.url)),
    page_plan: { default_order: ["hero", "highlights", "menu", "about", "gallery", "reviews", "catering", "ways", "footer"], off: [], scaffold: true },
    source_url: r.sourceUrl,
    not_found: notFound,
    not_in_this_version: ["checking which tables are free", "online ordering and payments", "an owner screen for table requests", "multiple locations", "languages other than English"],
    assumptions: [
      "Prices are shown exactly as the site wrote them. The owner can hide them with one request.",
      ...(reserve ? [`The Reserve button opens the site's own page (${reserve}). No booking service was found, so there is no booking form.`] : []),
      "The hero and about pictures were chosen only by their description on the site (dining, interior, chef, team). The owner can pick others.",
      "Menu text keeps the site's spelling. Nothing was corrected.",
      "The accent colour is a default. The owner can ask for another.",
    ],
    placeholders: [],
    ...(isTest ? { private_test: true } : {}),
    consent: isTest ? { private_test: true, by: who } : { owner_confirmed: true, by: who },
  };
  return { brief, notFound };
}
