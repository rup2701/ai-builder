/**
 * Verify: checks the store before it can be published.
 *
 * "fail" blocks publishing. "warn" is a note the owner should read.
 * Every check runs on the config alone, so it is fast and repeatable.
 */

import { contrast, paletteFor, type StoreConfig } from "./storeConfig";

export type CheckStatus = "pass" | "warn" | "fail";
export type Check = { id: string; label: string; status: CheckStatus; detail: string };

const PROOF_CLAIMS = [
  /\bsince\s+(?:19|20)\d{2}\b/i,
  /\b\d[\d,]*\+?\s+(?:happy\s+)?(?:customers|reviews|stores|orders|clients|five[- ]star)\b/i,
  /\b(?:best|#1|number one|top[- ]rated|award[- ]winning|world'?s|guaranteed?)\b/i,
];
const NEEDS_PROOF = /\b(organic|fair[- ]trade|certified|sustainable|eco[- ]friendly|vegan|non[- ]toxic|handmade|hand-made)\b/i;

function copyOf(c: StoreConfig): string {
  return [c.name, c.headline, c.subhead, c.cta, ...c.categories, ...c.trust.map((t) => `${t.title} ${t.body}`)].join(" \n ");
}

export function verify(c: StoreConfig): Check[] {
  const out: Check[] = [];
  const pal = paletteFor(c.accent, c.dark);
  const r = (n: number) => n.toFixed(1);

  // Name
  const nameLen = c.name.trim().length;
  out.push(
    nameLen === 0
      ? { id: "name", label: "Store name", status: "fail", detail: "Your store needs a name." }
      : nameLen > 28
        ? { id: "name", label: "Store name", status: "warn", detail: `${nameLen} characters. Names over 28 get cut off on phones.` }
        : { id: "name", label: "Store name", status: "pass", detail: `“${c.name}” fits the header.` },
  );
  if (!c.locked.name) {
    out.push({
      id: "name-free",
      label: "Name availability",
      status: "warn",
      detail: "This name is a suggestion. Check it is free to use before you publish.",
    });
  }

  // Colour
  const body = contrast(pal.ink, pal.bg);
  const muted = contrast(pal.muted, pal.bg);
  out.push(
    body >= 4.5 && muted >= 4.5
      ? { id: "contrast-text", label: "Text is easy to read", status: "pass", detail: `Body text ${r(body)}:1, softer text ${r(muted)}:1 (4.5:1 is the minimum).` }
      : { id: "contrast-text", label: "Text is easy to read", status: "fail", detail: `Softer text is ${r(muted)}:1, below the 4.5:1 minimum.` },
  );
  const btn = contrast(pal.accentInk, pal.accent);
  out.push(
    btn >= 4.5
      ? { id: "contrast-button", label: "Buttons are readable", status: "pass", detail: `Button text ${r(btn)}:1.` }
      : btn >= 3
        ? { id: "contrast-button", label: "Buttons are readable", status: "warn", detail: `Button text is ${r(btn)}:1. Try a slightly deeper or lighter accent.` }
        : { id: "contrast-button", label: "Buttons are readable", status: "fail", detail: `Button text is only ${r(btn)}:1. Pick a deeper or lighter accent.` },
  );
  // Small accent text is shaded automatically when the accent is too light, so this only fails if even that is not enough.
  const acc = contrast(pal.accentText, pal.bg);
  const shaded = pal.accentText !== pal.accent;
  out.push(
    acc >= 4.5
      ? { id: "contrast-accent", label: "Accent text on the page", status: "pass", detail: shaded ? `${r(acc)}:1. Small accent text is shaded a little darker than the accent so it stays readable.` : `${r(acc)}:1 on the background.` }
      : { id: "contrast-accent", label: "Accent text on the page", status: "warn", detail: `Small accent text is ${r(acc)}:1. Say “darker accent” to fix it.` },
  );

  // Claims
  const copy = copyOf(c);
  const proof = PROOF_CLAIMS.map((re) => copy.match(re)?.[0]).find(Boolean);
  const maybe = copy.match(NEEDS_PROOF)?.[0];
  out.push(
    proof
      ? { id: "claims", label: "No claims we cannot back up", status: "fail", detail: `“${proof}” is a claim that needs proof. Remove it or replace it with something you can show.` }
      : maybe
        ? { id: "claims", label: "No claims we cannot back up", status: "warn", detail: `“${maybe}” is fine if it is true for every product. Be ready to show it.` }
        : { id: "claims", label: "No claims we cannot back up", status: "pass", detail: "No years in business, customer counts, awards or superlatives." },
  );

  // Copy length
  const long = c.headline.length > 60 || c.subhead.length > 140;
  out.push(
    long
      ? { id: "length", label: "Headline and intro fit", status: "warn", detail: "The headline or intro is long and will wrap a lot on phones." }
      : { id: "length", label: "Headline and intro fit", status: "pass", detail: "Short enough to read at a glance on a phone." },
  );

  // Categories
  const badCat = c.categories.some((x) => x.length > 18);
  out.push(
    c.categories.length < 2
      ? { id: "categories", label: "Categories", status: "warn", detail: "Add at least two categories so shoppers can browse." }
      : badCat
        ? { id: "categories", label: "Categories", status: "warn", detail: "A category name over 18 characters will not fit on one line." }
        : { id: "categories", label: "Categories", status: "pass", detail: `${c.categories.length} categories: ${c.categories.join(", ")}.` },
  );

  // Always-on notes about what is not real yet
  out.push({
    id: "products",
    label: "Products",
    status: "warn",
    detail: "These are sample products. Add yours from photos before you publish.",
  });
  out.push({
    id: "policies",
    label: "Returns and shipping",
    status: "warn",
    detail: "Policies use template wording. Review them and set your own terms.",
  });

  return out;
}

export function summarize(checks: Check[]): { pass: number; warn: number; fail: number } {
  return {
    pass: checks.filter((x) => x.status === "pass").length,
    warn: checks.filter((x) => x.status === "warn").length,
    fail: checks.filter((x) => x.status === "fail").length,
  };
}
