import type { ImportResult, Work } from "./site-import";

/**
 * Turns what the website reader found into an artist store brief, on top of a base brief (the Studio Avant brief).
 * Everything comes from the reader's result and the reader only copies what the owner's pages say, so nothing here is invented:
 * what the pages did not give stays empty and is listed in `not_found` for the owner to fill in.
 * The caller must pass proof that the owner (or someone they allowed) said the site and its pictures can be used.
 */

/** The owner agreed, or this is a private test of our own tool on public content that nobody else sees and that is never published. */
export type Consent = { ownerConfirmed: true; confirmedBy: string; note?: string } | { privateTest: true; by: string };
type Brief = Record<string, unknown>;

const CURRENCY: [RegExp, string][] = [[/£/, "GBP"], [/€/, "EUR"], [/\$/, "USD"]];

/** "£2,250.00" becomes 225000 (minor units). Anything else becomes null. */
export function priceToMinor(price: string | undefined): number | null {
  if (!price) return null;
  const m = /(\d[\d,]*)(?:\.(\d{1,2}))?/.exec(price);
  if (!m) return null;
  const whole = Number(m[1].replace(/,/g, ""));
  const frac = Number((m[2] ?? "0").padEnd(2, "0"));
  return Number.isFinite(whole) ? whole * 100 + frac : null;
}

export function currencyOf(works: Work[], fallback: string): string {
  for (const w of works) for (const [re, code] of CURRENCY) if (w.price && re.test(w.price)) return code;
  return fallback;
}

export function importToBrief(base: Brief, r: ImportResult, consent: Consent): { brief: Brief; notFound: string[] } {
  const isTest = !!consent && "privateTest" in consent && consent.privateTest === true && !!consent.by;
  const isOwner = !!consent && "ownerConfirmed" in consent && consent.ownerConfirmed === true && !!consent.confirmedBy;
  if (!isTest && !isOwner) throw new Error("The owner has not confirmed that this site and its pictures can be used.");
  const who = isTest ? (consent as { by: string }).by : (consent as { confirmedBy: string }).confirmedBy;
  if (!r.name) throw new Error("The site gave no name, so there is nothing to build from yet.");
  const notFound: string[] = [];
  const brief: Brief = JSON.parse(JSON.stringify(base));

  const store = (brief.store ?? {}) as Record<string, unknown>;
  brief.store = {
    ...store,
    name: r.name,
    sells: r.tagline ?? r.kind ?? store.sells,
    artist: { name: r.name, note: "Imported from the owner's own website. The owner can change everything in the owner area." },
  };
  brief.purpose = isTest
    ? `Private test: a brief built from a public website (${r.sourceUrl}) to try the tool. The owner has not been asked yet, so this must not be published or shown to anyone. Works, words and pictures belong to the owner. Anything the site did not give is empty and listed under not_found.`
    : `Brief built from the owner's existing website (${r.sourceUrl}), used with the owner's confirmation. Works, words and pictures are the owner's own. Anything the site did not give is empty and listed under not_found.`;

  const works = r.catalog.map((w, i) => {
    const minor = priceToMinor(w.price);
    if (!w.price) notFound.push(`price of ${w.title}`);
    return {
      title: w.title,
      year: w.year ?? null,
      medium: w.medium ?? null,
      size: w.size ?? null,
      price_minor: minor,
      status: w.status ?? null,
      // Pictures come later: until then the work shows the neutral placeholder. The address is kept so the picture step can use it.
      image: null,
      image_source: w.image ?? null,
      show_on_home: i < 8,
      feature_on_home: i === 0,
    };
  });
  // The person's name for the wordmark ("Simone Russell Art" is the business, "Simone Russell" the artist).
  const artistName = r.name.replace(/\s+(art|studio|gallery|paintings?|fine art|design)$/i, "").trim() || r.name;
  (brief.store as Record<string, unknown>).artist = { name: artistName, note: "Imported from the owner's own website. The owner can change everything in the owner area." };
  delete brief.sample_catalog;
  const oldCatalog = (base.catalog ?? {}) as Record<string, unknown>;
  brief.catalog = {
    // The base brief's field list, statuses and notes on originals and prints are kept; only the works and the Sold rule change.
    ...oldCatalog,
    status_values: [
      "Available (can be bought from its page)",
      "Sold (stays visible and keeps its list price, cannot be bought)",
      "Private collection (stays visible, cannot be bought)",
      "Not for sale (stays visible, cannot be bought)",
    ],
    mode: "provided",
    note: "These are the owner's real works, copied from their website. They are not samples and must not be labelled as samples. A work with no status or no price is shown without a buy button until the owner sets them.",
    works,
  };
  brief.categories = ["Original work"];
  brief.series = { note: "No series were found on the site. The owner can add series later.", sample_series: [] };
  brief.imagery = {
    source: "imported_from_owner_site",
    rules: ["Pictures were copied from the owner's own website with their confirmation.", "No stock or generated photos are fetched or invented.", "No pictures are fetched yet: every work shows the neutral placeholder until the owner adds one."],
  };
  const orders = (brief.orders ?? {}) as Record<string, unknown>;
  brief.orders = { ...orders, currency: currencyOf(r.catalog, String(orders.currency ?? "USD")) };

  brief.content = {
    tagline: r.tagline ?? null,
    about: r.about ?? null,
    contact: { phone: r.phone ?? null, email: r.email ?? null, address: r.address ?? null, socials: r.socials },
    newsletter: r.signup,
    sections: r.extras.map((e) => ({ title: e.title, text: e.body })),
    testimonials: r.testimonials,
    note: "Every text here is the owner's own wording, copied exactly. Use it as written; do not rewrite, shorten or add to it.",
  };
  if (!r.about) notFound.push("about text");
  if (!r.email) notFound.push("email address");
  if (!r.catalog.length) notFound.push("works");
  if (!r.testimonials.length) notFound.push("testimonials");

  const assumptions = Array.isArray(brief.assumptions) ? (brief.assumptions as string[]) : [];
  brief.assumptions = [
    ...assumptions.filter((a) => !/sample|fictional/i.test(a)),
    isTest ? `Private test by ${who}: built from the public site to try the tool. It is not shown to anyone or published until the owner agrees.` : `Imported on the owner's confirmation (${who}).`,
    "Shipping amounts, tax and countries are still the pack's estimates until the owner sets their own.",
    "The first eight works are shown on the home page and the first is featured. The owner can change this.",
  ];
  // Words from the sample brief that name the sample studio must not reach the owner's site.
  const swap = (v: unknown): unknown =>
    typeof v === "string" ? v.replace(/Studio Avant/g, r.name!).replace(/Neil Patrick/g, artistName) : Array.isArray(v) ? v.map(swap) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v;
  for (const k of ["pages", "look"]) brief[k] = swap(brief[k]);
  // Sold works keep their price on screen.
  const pg = (brief.pages ?? {}) as Record<string, unknown>;
  if (typeof pg.work_index === "string") pg.work_index = pg.work_index.replace("or 'Sold'", "or 'Sold' with its list price");
  if (typeof pg.work_page === "string") pg.work_page = pg.work_page.replace("it shows the status instead and no buy button", "it shows the status, and the list price for a Sold work, and no buy button");
  // Real links and real wording, not the sample's placeholders.
  const look = (brief.look ?? {}) as { footer?: { columns?: string[] } };
  if (look.footer?.columns && r.socials.length) look.footer.columns = look.footer.columns.map((c) => (/^Follow/.test(c) ? `Follow (${r.socials.map((s) => s.network).join(", ")}: the real links in content.contact.socials)` : c));
  if (r.extras.length) {
    const pages = (brief.pages ?? {}) as Record<string, any>;
    if (pages.commissions) pages.commissions.page = "Explains how commissions work and has an inquiry form: name, email, what they have in mind, rough size and budget range. Use the owner's own wording from content.sections (for example the FAQ answer about commissions); write sample wording only where the owner's pages say nothing.";
    brief.policies = { ...((brief.policies ?? {}) as Record<string, unknown>), note: "Use the owner's own wording from content.sections for shipping, returns and payment. Sample wording only where the owner's pages say nothing." };
  }
  brief.not_found = notFound;
  if (isTest) brief.private_test = true;
  return { brief, notFound };
}
