import * as cheerio from "cheerio";
import { ImportError, safeFetchHtml, type FetchDeps } from "./safe-fetch";

/**
 * Turns pages of an existing website into plain facts. Nothing here calls a model.
 * Unlike a general text scraper, it keeps header and footer text and short lines, because a local business keeps its address,
 * phone and hours there, and menu lines ("Pad Thai 14") are short.
 */

export type PageText = { url: string; title: string; text: string };
export type SiteImage = { src: string; alt: string };
export type SiteSnapshot = {
  rootUrl: string;
  title: string;
  description: string;
  pages: PageText[];
  phones: string[];
  emails: string[];
  socials: { network: string; url: string }[];
  /** schema.org data the site publishes about itself (business name, address, hours). */
  structured: unknown[];
  images: SiteImage[];
};

export const MAX_PAGES = 5;
export const MAX_TEXT_CHARS = 24_000;
const MAX_IMAGES = 12;
const SOCIAL: [string, RegExp][] = [
  ["instagram", /(^|\.)instagram\.com$/],
  ["facebook", /(^|\.)facebook\.com$/],
  ["x", /(^|\.)(x|twitter)\.com$/],
  ["linkedin", /(^|\.)linkedin\.com$/],
  ["youtube", /(^|\.)youtube\.com$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["yelp", /(^|\.)yelp\.com$/],
];
const SUBPAGE = /menu|about|story|contact|hours|location|visit|find-us|services|order|reserv|book/i;
const BUSINESS_TYPES = /(LocalBusiness|Restaurant|CafeOrCoffeeShop|Bakery|BarOrPub|FoodEstablishment|Store|HealthAndBeautyBusiness|Organization|ProfessionalService)/;

type Page = { page: PageText; links: { href: string; text: string }[]; phones: string[]; emails: string[]; socials: { network: string; url: string }[]; structured: unknown[]; images: SiteImage[]; description: string };

const abs = (href: string | undefined, base: string): string | null => {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};

export function extractPage(html: string, pageUrl: string): Page {
  const $ = cheerio.load(html);
  const structured: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      for (const item of Array.isArray(data) ? data : data?.["@graph"] ? data["@graph"] : [data]) {
        const t = JSON.stringify(item?.["@type"] ?? "");
        if (item && BUSINESS_TYPES.test(t)) structured.push(item);
      }
    } catch {
      /* ignore malformed data */
    }
  });
  const description = ($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "").trim().slice(0, 400);
  const ogImage = abs($('meta[property="og:image"]').attr("content"), pageUrl);

  const phones = new Set<string>();
  const emails = new Set<string>();
  const socials: { network: string; url: string }[] = [];
  const links: { href: string; text: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const label = $(el).text().replace(/\s+/g, " ").trim().slice(0, 80);
    if (/^tel:/i.test(href)) return void phones.add(decodeURIComponent(href.slice(4)).trim());
    if (/^mailto:/i.test(href)) return void emails.add(decodeURIComponent(href.slice(7).split("?")[0]).trim());
    const full = abs(href, pageUrl);
    if (!full) return;
    const host = new URL(full).hostname.toLowerCase();
    const net = SOCIAL.find(([, re]) => re.test(host));
    if (net && !socials.some((s) => s.url === full)) socials.push({ network: net[0], url: full });
    links.push({ href: full, text: label });
  });

  const images: SiteImage[] = [];
  const addImage = (src: string | null, alt: string) => {
    if (!src || images.length >= MAX_IMAGES || images.some((i) => i.src === src)) return;
    if (/\.svg(\?|$)|^data:|sprite|logo|icon|pixel|tracking/i.test(src)) return;
    images.push({ src, alt: alt.trim().slice(0, 140) });
  };
  addImage(ogImage, "");
  $("img").each((_, el) => {
    const w = Number($(el).attr("width") ?? 0);
    if (w && w < 120) return;
    addImage(abs($(el).attr("src") ?? $(el).attr("data-src"), pageUrl), $(el).attr("alt") ?? "");
  });

  $("script, style, noscript, iframe, svg, nav, form, select, button").remove();
  const seen = new Set<string>();
  const lines: string[] = [];
  $("h1,h2,h3,h4,h5,p,li,td,th,address,span,div,a,dt,dd").each((_, el) => {
    // Only leaf-ish text: skip containers whose children carry the same text.
    if ($(el).children("p,li,div,h1,h2,h3,h4,h5,td,th,address").length) return;
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > 400 || seen.has(t)) return;
    seen.add(t);
    lines.push(t);
  });
  const title = ($("title").text() || $("h1").first().text()).replace(/\s+/g, " ").trim().slice(0, 160);
  return { page: { url: pageUrl, title, text: lines.join("\n") }, links, phones: [...phones], emails: [...emails], socials, structured, images, description };
}

/** Which same-site pages are worth reading for a local business: menu, about, contact, hours. */
export function pickSubpages(links: { href: string; text: string }[], rootUrl: string, limit = MAX_PAGES - 1): string[] {
  const root = new URL(rootUrl);
  const out: string[] = [];
  for (const l of links) {
    let u: URL;
    try {
      u = new URL(l.href);
    } catch {
      continue;
    }
    if (u.hostname.replace(/^www\./, "") !== root.hostname.replace(/^www\./, "")) continue;
    u.hash = "";
    const key = u.toString();
    if (key === root.toString() || /\.(pdf|jpe?g|png|webp|gif|zip)$/i.test(u.pathname) || out.includes(key)) continue;
    if (SUBPAGE.test(u.pathname) || SUBPAGE.test(l.text)) out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

/** Reads the home page and a few useful pages of the same site. A failing sub-page is skipped; a failing home page is an error. */
export async function crawlSite(raw: string, deps: FetchDeps = {}): Promise<SiteSnapshot> {
  const home = await safeFetchHtml(raw, deps);
  const first = extractPage(home.html, home.url);
  const pages = [first];
  for (const next of pickSubpages(first.links, home.url)) {
    try {
      const r = await safeFetchHtml(next, deps);
      pages.push(extractPage(r.html, r.url));
    } catch {
      /* skip it */
    }
  }
  let room = MAX_TEXT_CHARS;
  const kept: PageText[] = [];
  for (const p of pages) {
    if (room <= 0) break;
    const text = p.page.text.slice(0, room);
    room -= text.length;
    if (text.trim()) kept.push({ ...p.page, text });
  }
  if (!kept.length) throw new ImportError("I could not find readable text on that website. It may be built in a way I cannot read yet.");
  const uniq = <T,>(xs: T[], key: (x: T) => string) => xs.filter((x, i) => xs.findIndex((y) => key(y) === key(x)) === i);
  return {
    rootUrl: home.url,
    title: first.page.title,
    description: first.description,
    pages: kept,
    phones: uniq(pages.flatMap((p) => p.phones), (x) => x.replace(/\D/g, "")),
    emails: uniq(pages.flatMap((p) => p.emails), (x) => x.toLowerCase()),
    socials: uniq(pages.flatMap((p) => p.socials), (x) => x.url),
    structured: pages.flatMap((p) => p.structured).slice(0, 4),
    images: uniq(pages.flatMap((p) => p.images), (x) => x.src).slice(0, MAX_IMAGES),
  };
}
