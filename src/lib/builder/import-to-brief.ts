import type { ImportResult, Work } from "./site-import";

/**
 * Turns what the website reader found into an artist store brief, on top of a base brief (the Studio Avant brief).
 * Everything comes from the reader's result and the reader only copies what the owner's pages say, so nothing here is invented:
 * what the pages did not give stays empty and is listed in `not_found` for the owner to fill in.
 * The caller must pass proof that the owner (or someone they allowed) said the site and its pictures can be used.
 */

export type Consent = { ownerConfirmed: true; confirmedBy: string; note?: string };
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
  if (!consent || consent.ownerConfirmed !== true || !consent.confirmedBy) throw new Error("The owner has not confirmed that this site and its pictures can be used.");
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
  brief.purpose = `Brief built from the owner's existing website (${r.sourceUrl}), used with the owner's confirmation. Works, words and pictures are the owner's own. Anything the site did not give is empty and listed under not_found.`;

  const works = r.catalog.map((w, i) => {
    const minor = priceToMinor(w.price);
    if (!w.price && w.status !== "Sold") notFound.push(`price of ${w.title}`);
    return {
      title: w.title,
      year: w.year ?? null,
      medium: w.medium ?? null,
      size: w.size ?? null,
      price_minor: w.status === "Sold" ? null : minor,
      status: w.status ?? null,
      image: w.image ?? null,
      show_on_home: i < 8 && !!w.image,
      feature_on_home: i === 0 && !!w.image,
    };
  });
  delete brief.sample_catalog;
  brief.catalog = {
    mode: "provided",
    note: "These are the owner's real works, copied from their website. They are not samples and must not be labelled as samples. A work with no status or no price is shown without a buy button until the owner sets them.",
    works,
  };
  brief.categories = ["Original work"];
  brief.series = { note: "No series were found on the site. The owner can add series later.", sample_series: [] };
  brief.imagery = {
    source: "imported_from_owner_site",
    rules: ["Pictures were copied from the owner's own website with their confirmation.", "No stock or generated photos are fetched or invented.", "A work without a picture shows a neutral placeholder until the owner adds one."],
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
    `Imported on the owner's confirmation (${consent.confirmedBy}).`,
    "Shipping amounts, tax and countries are still the pack's estimates until the owner sets their own.",
    "The first eight works with a picture are shown on the home page and the first is featured. The owner can change this.",
  ];
  brief.not_found = notFound;
  return { brief, notFound };
}
