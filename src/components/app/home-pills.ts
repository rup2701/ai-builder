/**
 * The pills on Home and which starter cards each one lists. A card is written once (templates.tsx) and listed here by id, so the
 * same card can sit under more than one pill. The Appnomics site's hero (appnomics-landing HeroPrompt.tsx) keeps its own copy of
 * this; keep them in step.
 *
 * Scout learns the pill only as kind (site or store) and the template only as its pack: a card click and a typed idea send the
 * same two things. A typed idea with no card clicked uses the pill's default card.
 */
export type Pill = "site" | "store" | "mobile" | "saas";
export type SitePackParam = "showcase" | "local";

export type PillGroup = {
  /** Shown above the cards. The Website and Online store pills have one group with no heading. */
  heading?: string;
  items: { id: string; /** One short line under the card, for this pill only. */ line?: string }[];
};

const WAITLIST_LINE = "A launch page with a dashboard to read your sign-ups.";
const SHOWCASE_LINE = "A launch page with your pricing and a button to your own payment link.";

export const PILL_GROUPS: Record<Pill, PillGroup[]> = {
  site: [
    {
      items: [
        { id: "website-mvp", line: WAITLIST_LINE },
        { id: "website-saas" },
        { id: "website-restaurant" },
        { id: "website-portfolio" },
        { id: "website-resume" },
      ],
    },
  ],
  store: [{ items: [{ id: "fernhollow" }, { id: "boutique" }, { id: "art" }] }],
  mobile: [
    { heading: "Launch page", items: [{ id: "website-mvp", line: WAITLIST_LINE }, { id: "website-saas", line: SHOWCASE_LINE }] },
    { heading: "The app itself", items: [{ id: "mobile-app" }] },
  ],
  saas: [
    { heading: "Launch page", items: [{ id: "website-saas", line: SHOWCASE_LINE }, { id: "website-mvp", line: WAITLIST_LINE }] },
    { heading: "The app itself", items: [{ id: "saas-app" }] },
  ],
};

/** The card a typed idea uses when no card was clicked. Website and Online store have none, as before (the waitlist pack, the store). */
export const DEFAULT_TEMPLATE: Partial<Record<Pill, string>> = { mobile: "website-mvp", saas: "website-saas" };

/** Cards that open a pack other than the waitlist one (sent to /new as pack=...). */
export const TEMPLATE_PACK: Record<string, SitePackParam> = { "website-saas": "showcase", "website-restaurant": "local" };

/** What Home sends to /new for a pill and the clicked card (or none). */
export function handoff(pill: Pill, template: string | null): { kind: "site" | "store"; pack?: SitePackParam } {
  if (pill === "store") return { kind: "store" };
  const id = template ?? DEFAULT_TEMPLATE[pill];
  const pack = id ? TEMPLATE_PACK[id] : undefined;
  return pack ? { kind: "site", pack } : { kind: "site" };
}
