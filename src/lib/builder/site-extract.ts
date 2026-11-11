import * as cheerio from "cheerio";
import { ImportError, safeFetchHtml, type FetchDeps } from "./safe-fetch";

/**
 * Turns pages of an existing website into plain facts. Nothing here calls a model.
 * Unlike a general text scraper, it keeps header and footer text and short lines, because a local business keeps its address,
 * phone and hours there, and menu lines ("Pad Thai 14") are short.
 */

export type PageText = { url: string; title: string; text: string };
export type SiteImage = { src: string; alt: string };
export type SiteAction = { label: string; url: string };
export type SiteSnapshot = {
  rootUrl: string;
  title: string;
  description: string;
  pages: PageText[];
  phones: string[];
  emails: string[];
  socials: { network: string; url: string }[];
  /** The buttons and links the home page offers (Order online, Reserve, View menu) with where they go. */
  actions: SiteAction[];
  /** schema.org data the site publishes about itself (business name, address, hours). */
  structured: unknown[];
  images: SiteImage[];
  /** Links the home page offers, and which of them were read, so a missing page can be explained. */
  linksSeen: { href: string; text: string; read: boolean }[];
  /** True when a page has an email box to sign up (a newsletter), seen before forms are stripped for reading. */
  signup: boolean;
};

export const MAX_PAGES = 7;
export const MAX_TEXT_CHARS = 40_000;
const MAX_IMAGES = 30;
const SOCIAL: [string, RegExp][] = [
  ["instagram", /(^|\.)instagram\.com$/],
  ["facebook", /(^|\.)facebook\.com$/],
  ["x", /(^|\.)(x|twitter)\.com$/],
  ["linkedin", /(^|\.)linkedin\.com$/],
  ["youtube", /(^|\.)youtube\.com$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["yelp", /(^|\.)yelp\.com$/],
];
const SUBPAGE = /menu|about|story|contact|hours|location|visit|find-us|services|order|reserv|book|catering|events?|experience|gallery|special|shop|store|paintings?|originals?|prints?|collections?|portfolio|work|commission|artworks?|exhibitions?|press|projects?|pricing|packages?|areas?|testimonials?|faqs?|shipping|returns|delivery/i;
/** Words on a button or link that say what a visitor can do here. Their addresses become the new site's buttons. */
const ACTION = /order|reserv|book|menu|catering|call us|get directions|appointment|buy|purchase|commission|enquir|inquir|subscribe/i;
const BUSINESS_TYPES = /(LocalBusiness|Restaurant|CafeOrCoffeeShop|Bakery|BarOrPub|FoodEstablishment|Store|HealthAndBeautyBusiness|Organization|ProfessionalService)/;

type Page = { signup: boolean; page: PageText; actions: SiteAction[]; links: { href: string; text: string }[]; phones: string[]; emails: string[]; socials: { network: string; url: string }[]; structured: unknown[]; images: SiteImage[]; description: string };

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
  const addImage = (raw: string | null, alt: string) => {
    if (!raw || images.length >= MAX_IMAGES) return;
    // Some hosts write the same address two ways (%7E and ~), so compare one spelling.
    let src = raw.replace(/%7E/gi, "~");
    // Wix serves the original file at the plain media address, without the /v1/... resize part (which is often a thumbnail).
    const wix = /^(https:\/\/static\.wixstatic\.com\/media\/[^/]+)\/v1\//.exec(src);
    if (wix) src = wix[1];
    if (images.some((i) => i.src === src)) return;
    if (/\.svg(\?|$)|^data:|sprite|logo|icon|pixel|tracking/i.test(src) || /logo|icon/i.test(alt)) return;
    // Resizing hosts put the size in the address (w_45,h_45): a thumbnail is not a picture to build a page around.
    const size = /[/,_]w_(\d+),h_(\d+)/.exec(src);
    if (size && Number(size[1]) < 300) return;
    if (wix && /w_(\d+),h_(\d+)/.test(raw) && Number(/w_(\d+)/.exec(raw)?.[1]) < 100) return; // an icon-sized thumbnail, not a photo
    // A camera or editor file name is not a description, so it becomes empty (the owner or the agent writes a real one).
    let text = alt.replace(/\.(jpe?g|png|webp|gif|avif)\b/gi, "").replace(/\s+/g, " ").trim();
    if (/^(img|dsc|dscn|pxl|image|photo|screenshot|copy of)?[\s_-]*\d[\w -]*(edited|copy)?$/i.test(text) || /^\d{4,}[\w_-]*$/.test(text) || /_edited|^img_?\d/i.test(text) || /\w+_\w*\d{3,}/.test(text)) text = "";
    images.push({ src, alt: text.slice(0, 140) });
  };
  addImage(ogImage, "");
  $("img").each((_, el) => {
    const w = Number($(el).attr("width") ?? 0);
    if (w && w < 120) return;
    addImage(abs($(el).attr("src") ?? $(el).attr("data-src"), pageUrl), $(el).attr("alt") ?? "");
  });

  const signup = $('input[type="email"]').length > 0 || /subscribe|newsletter|mailing list/i.test($("form").text());
  $("script, style, noscript, iframe, svg, nav, form, select, button").remove();
  const seen = new Set<string>();
  const lines: string[] = [];
  $("h1,h2,h3,h4,h5,p,li,td,th,address,span,div,a,dt,dd").each((_, el) => {
    // Only leaf-ish text: skip containers whose children carry the same text.
    if ($(el).children("p,li,div,h1,h2,h3,h4,h5,td,th,address").length) return;
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > 400 || seen.has(t)) return;
    seen.add(t);
    // Headings are marked so each block of text can be matched to what it is (Commissions, FAQ, Exhibitions).
    lines.push(/^h[1-4]$/i.test(el.tagName) ? `## ${t}` : t);
  });
  const title = ($("title").text() || $("h1").first().text()).replace(/\s+/g, " ").trim().slice(0, 160);
  const actions: SiteAction[] = [];
  for (const l of links) {
    const label = l.text.replace(/\s+/g, " ").trim();
    if (label.length < 3 || label.length > 40 || !ACTION.test(label)) continue;
    if (actions.some((a) => a.url === l.href || a.label.toLowerCase() === label.toLowerCase())) continue;
    actions.push({ label, url: l.href });
  }
  return { signup, page: { url: pageUrl, title, text: lines.join("\n") }, actions: actions.slice(0, 8), links, phones: [...phones], emails: [...emails], socials, structured, images, description };
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
  }
  // A page of one item (/work/low-tide) is skipped when the list it belongs to (/work) is read: the list already shows every item.
  const parentOf = (k: string) => { const u = new URL(k); const parts = u.pathname.split("/").filter(Boolean); return parts.length > 1 ? `${u.origin}/${parts.slice(0, -1).join("/")}` : null; };
  for (let i = out.length - 1; i >= 0; i--) {
    const parent = parentOf(out[i]);
    if (parent && out.some((o) => o.replace(/\/$/, "") === parent)) out.splice(i, 1);
  }
  // The menu first, then contact and hours, then the story, then the rest, so a small page budget goes to what matters most.
  const rank = (k: string) => {
    const t = `${new URL(k).pathname} ${links.find((l) => l.href.split("#")[0] === k)?.text ?? ""}`;
    return /menu|shop|store|paintings?|originals?|collections?|portfolio|artworks?|work|projects?/i.test(t) ? 0 : /hours|location|contact|visit|find-us|commission/i.test(t) ? 1 : /about|story/i.test(t) ? 2 : /catering|services|event|experience|prints?|pricing|packages?|areas?|exhibition|faq|shipping|returns|delivery/i.test(t) ? 3 : 4;
  };
  return out.map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i).slice(0, limit).map((x) => x.k);
}

/** Reads the home page and a few useful pages of the same site. A failing sub-page is skipped; a failing home page is an error. */
export async function crawlSite(raw: string, deps: FetchDeps = {}): Promise<SiteSnapshot> {
  const home = await safeFetchHtml(raw, deps);
  const first = extractPage(home.html, home.url);
  const pages = [first];
  const chosen = pickSubpages(first.links, home.url);
  for (const next of chosen) {
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
    // Only the home page's own buttons: other pages repeat the menu bar.
    actions: first.actions,
    structured: pages.flatMap((p) => p.structured).slice(0, 4),
    images: uniq(pages.flatMap((p) => p.images), (x) => x.src).slice(0, MAX_IMAGES),
    signup: pages.some((p) => p.signup),
    linksSeen: uniq(first.links, (x) => x.href).slice(0, 60).map((l) => ({ ...l, read: pages.some((p) => p.page.url.replace(/\/$/, "") === l.href.split("#")[0].replace(/\/$/, "")) })),
  };
}
