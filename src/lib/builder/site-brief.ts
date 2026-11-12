import { z } from "zod";

/**
 * The website brief: what the site interview saves and the runner builds from.
 * Same shape as the runner's vertical-packs/site/brief.example.json. This check only keeps out
 * a brief the runner could not use; the runner's own specs decide everything else.
 */

const Block = z.object({ type: z.string().min(1) }).passthrough();

export const SiteBrief = z
  .object({
    site: z.object({ name: z.string().trim().min(1).max(60), kind: z.literal("waitlist") }).passthrough(),
    audience: z.object({ icp: z.string().trim().min(5) }).passthrough(),
    blocks: z.array(Block).min(3),
    claims: z.array(z.object({ text: z.string().min(1), confirmed: z.boolean() }).passthrough()).default([]),
    look: z.object({}).passthrough(),
  })
  .passthrough()
  .superRefine((b, ctx) => {
    const types = b.blocks.map((x) => x.type);
    for (const need of ["hero", "waitlist"]) {
      if (!types.includes(need)) ctx.addIssue({ code: "custom", message: `blocks must include a "${need}" block` });
    }
  });

/** PARKED (old SaaS sign-up pack, not used by the builder): same envelope, different blocks, and a single-email signup instead of a waitlist form. */
export const SaasBrief = z
  .object({
    site: z.object({ name: z.string().trim().min(1).max(60), kind: z.literal("saas") }).passthrough(),
    audience: z.object({ icp: z.string().trim().min(5) }).passthrough(),
    blocks: z.array(Block).min(4),
    signup: z.object({ fields: z.array(z.object({ key: z.string(), type: z.string() }).passthrough()).min(1) }).passthrough(),
    claims: z.array(z.object({ text: z.string().min(1), confirmed: z.boolean() }).passthrough()).default([]),
    look: z.object({}).passthrough(),
  })
  .passthrough()
  .superRefine((b, ctx) => {
    const types = b.blocks.map((x) => x.type);
    for (const need of ["hero", "cta", "footer"]) {
      if (!types.includes(need)) ctx.addIssue({ code: "custom", message: `blocks must include a "${need}" block` });
    }
    if (!b.signup.fields.some((f) => f.key === "email")) ctx.addIssue({ code: "custom", path: ["signup", "fields"], message: 'signup must have an "email" field' });
    // Content only from the owner: a block that needs content must have it.
    for (const blk of b.blocks as Record<string, any>[]) {
      if (blk.type === "pricing" && !(blk.contact_only || (Array.isArray(blk.plans) && blk.plans.length))) ctx.addIssue({ code: "custom", message: "a pricing block needs plans or contact_only; leave it out if the owner gave no pricing" });
      if (blk.type === "testimonials" && !(Array.isArray(blk.items) && blk.items.length)) ctx.addIssue({ code: "custom", message: "a testimonials block needs quotes the owner gave; leave it out otherwise" });
    }
  });


/** Yearly price from the owner-typed monthly price: floor(monthly x 12 x (1 - discount / 100)), whole dollars. Integer arithmetic, so 3000 x 0.8 never lands on 2399. */
export function yearlyPrice(monthly: number, discountPercent: number): number {
  const total = Math.round(monthly * 100) * 12 * (100 - discountPercent);
  return (total - (total % 10000)) / 10000;
}
/** The per-month equivalent of a yearly price, whole dollars rounded down. */
export const perMonthOf = (yearly: number) => Math.floor(yearly / 12);

const Plan = z.object({ name: z.string().trim().min(1).max(40), monthly_price: z.number().nonnegative() }).passthrough();

/** The product showcase brief: no sign-up, no owner area. Sections in blocks, the brand and the main button beside them. */
export const ShowcaseBrief = z
  .object({
    site: z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(["product-showcase", "saas-showcase"]) }).passthrough(),
    audience: z.object({ icp: z.string().trim().min(5) }).passthrough(),
    brand: z.object({ tone: z.enum(["calm", "bold", "playful", "serious"]), color: z.enum(["light", "dark", "blue-accent"]) }).passthrough(),
    main_button: z.object({ label: z.string().trim().min(1).max(30), link: z.string().nullable().optional() }).passthrough(),
    secondary_button: z.object({ label: z.string().trim().min(1).max(30), link: z.string().nullable().optional() }).passthrough().optional(),
    sign_in: z.object({ label: z.string().trim().min(1).max(30), link: z.string().nullable().optional() }).passthrough().nullable().optional(),
    blocks: z.array(Block).min(5),
    look: z.object({}).passthrough(),
    placeholders: z.array(z.object({ where: z.string(), what: z.string() }).passthrough()).default([]),
  })
  .passthrough()
  .superRefine((b, ctx) => {
    const types = b.blocks.map((x) => x.type);
    for (const need of ["hero", "how_it_works", "faq", "closing_cta", "footer"]) {
      if (!types.includes(need)) ctx.addIssue({ code: "custom", message: `blocks must include a "${need}" block` });
    }
    for (const key of ["main_button", "secondary_button", "sign_in"] as const) {
      const link = (b[key] as { link?: string | null } | undefined)?.link;
      if (link && !/^(https:\/\/\S+|mailto:\S+@\S+)$/.test(link)) ctx.addIssue({ code: "custom", path: [key, "link"], message: "the link must start with https:// or mailto:" });
    }
    // A closing section may have its own pair of buttons (target "custom"); their links follow the same rule.
    for (const blk of b.blocks as Record<string, any>[]) {
      if (blk.type !== "closing_cta" && blk.type !== "hero") continue;
      for (const k of ["cta", "secondary_cta"]) {
        const c = blk[k] as { target?: string; link?: string | null } | undefined;
        if (c?.target === "custom" && c.link && !/^(https:\/\/\S+|mailto:\S+@\S+)$/.test(c.link)) ctx.addIssue({ code: "custom", path: ["blocks", blk.type, k, "link"], message: "the link must start with https:// or mailto:" });
      }
    }
    for (const blk of b.blocks as Record<string, any>[]) {
      if (blk.type !== "pricing") continue;
      const plans = Array.isArray(blk.plans) ? blk.plans : [];
      if (plans.length < 1 || plans.length > 3) ctx.addIssue({ code: "custom", message: "a pricing block needs one to three plans" });
      const parsed = z.array(Plan).safeParse(plans);
      if (!parsed.success) ctx.addIssue({ code: "custom", message: "every plan needs a name and a numeric monthly_price" });
      if (blk.billing === "monthly_and_yearly") {
        const d = blk.yearly_discount_percent;
        if (!Number.isInteger(d) || d < 0 || d > 90) { ctx.addIssue({ code: "custom", message: "yearly_discount_percent must be a whole number from 0 to 90" }); continue; }
        for (const pl of plans as Record<string, any>[]) {
          if (typeof pl.monthly_price !== "number") continue;
          const y = yearlyPrice(pl.monthly_price, d);
          if (pl.yearly_price !== y) ctx.addIssue({ code: "custom", message: `plan "${pl.name}": yearly_price must be ${y} (floor of monthly x 12 x (1 - ${d}%)), not ${pl.yearly_price}` });
          if (pl.yearly_per_month !== perMonthOf(y)) ctx.addIssue({ code: "custom", message: `plan "${pl.name}": yearly_per_month must be ${perMonthOf(y)} (floor of the yearly price / 12), not ${pl.yearly_per_month}` });
        }
      }
    }
  });

const Https = z.string().refine((u) => /^https:\/\/\S+$/i.test(u) && u.length < 500, "must start with https://");

/**
 * The local business brief (a restaurant first): the shape the runner's local-business pack builds from. Content comes from the owner or
 * their own site, so the checks are about safety, not style: a kind and a design the pack has, links that are https, and proof of consent.
 * A private test must say so and cannot claim the owner agreed; anything else needs the owner's confirmation for the pictures and the text.
 */
export const LocalBusinessBrief = z
  .object({
    site: z.object({ name: z.string().trim().min(1).max(80), kind: z.literal("local-business"), business_type: z.string().trim().min(1).max(40) }).passthrough(),
    look: z.object({ design: z.literal("restaurant_001"), accent: z.string().regex(/^#[0-9a-f]{6}$/i, "must be a hex colour like #c2410c").optional() }).passthrough(),
    contact: z.object({ hours: z.array(z.string()).default([]) }).passthrough(),
    links: z.object({}).passthrough().optional(),
    menu: z
      .object({
        show_prices: z.boolean().optional(),
        categories: z.array(z.object({ name: z.string().trim().min(1), items: z.array(z.object({ name: z.string().trim().min(1), price: z.string().optional() }).passthrough()) }).passthrough()),
      })
      .passthrough(),
    images: z.object({ use_photos: z.boolean(), owner_confirmed: z.boolean() }).passthrough(),
    testimonials: z.array(z.object({ quote: z.string().trim().min(1) }).passthrough()).default([]),
    socials: z.array(z.object({ label: z.string().min(1), url: Https }).passthrough()).default([]),
    story: z.object({ body: z.string().trim().min(1) }).passthrough().nullable().optional(),
    private_test: z.boolean().optional(),
    consent: z.object({ by: z.string().trim().min(1) }).passthrough(),
  })
  .passthrough()
  .superRefine((b, ctx) => {
    const c = b.consent as Record<string, unknown>;
    if (b.private_test === true) {
      if (c.private_test !== true) ctx.addIssue({ code: "custom", path: ["consent"], message: "a private test must carry consent.private_test true" });
    } else {
      if (c.owner_confirmed !== true) ctx.addIssue({ code: "custom", path: ["consent"], message: "the owner has not confirmed that this site and its pictures can be used (consent.owner_confirmed must be true)" });
      if (b.images.owner_confirmed !== true) ctx.addIssue({ code: "custom", path: ["images", "owner_confirmed"], message: "must be true once the owner confirmed" });
    }
    for (const [k, v] of Object.entries((b.links ?? {}) as Record<string, unknown>)) {
      if (typeof v === "string" && !Https.safeParse(v).success) ctx.addIssue({ code: "custom", path: ["links", k], message: "the link must start with https://" });
    }
  });

export type SiteBriefT = z.infer<typeof SiteBrief>;
export type SitePack = "waitlist" | "showcase" | "local";

/** "saas" is the old name of the showcase pack; projects started under it keep working. "local" is the local business pack (a restaurant first). */
export const normalizePack = (p?: string | null): SitePack =>
  p === "showcase" || p === "saas" || p === "product-showcase" ? "showcase" : p === "local" || p === "local-business" ? "local" : "waitlist";

/** The value to carry in a link (?pack=...) for a pack other than the waitlist one, or nothing. */
export const packParam = (p?: string | null): "showcase" | "local" | undefined => {
  const n = normalizePack(p);
  return n === "waitlist" ? undefined : n;
};
export const isLocal = (p?: string | null) => normalizePack(p) === "local";

/** A link asked for the product showcase pack (pack=showcase, product-showcase or the old saas). */
export const isShowcase = (p?: string | null) => normalizePack(p) === "showcase";

export function validateSiteBrief(input: unknown, pack: SitePack | "saas" = "waitlist"): { ok: true; brief: SiteBriefT } | { ok: false; error: string } {
  const n = normalizePack(pack);
  const r = (n === "showcase" ? ShowcaseBrief : n === "local" ? LocalBusinessBrief : SiteBrief).safeParse(input) as ReturnType<typeof SiteBrief.safeParse>;
  if (r.success) return { ok: true, brief: r.data };
  const lines = r.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "brief"}: ${i.message}`);
  return { ok: false, error: `The brief is not valid. Fix these and call save_brief again:\n${lines.join("\n")}` };
}

export const siteSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "site";

/** Short readable pieces for the brief card. Missing parts come back empty, never throw. */
export function briefCard(b: Record<string, unknown>) {
  const blocks = ((b.blocks as Record<string, unknown>[] | undefined) ?? []);
  const get = (t: string) => blocks.find((x) => x.type === t) as Record<string, any> | undefined;
  const hero = get("hero"), preview = get("preview") ?? get("visual"), tools = get("integrations");
  const pills = get("pills") ?? get("benefits_bento");
  // The showcase pack shows its pills where the waitlist pack shows benefits, and its signup where the waitlist has a form.
  const benefits = get("benefits") ?? (pills ? { items: ((pills.items as { text: string }[] | undefined) ?? []).map((i) => ({ title: i.text, text: "" })) } : undefined);
  const wl = get("waitlist") ?? ((b.signup as Record<string, any> | undefined) ? { form: b.signup } : undefined);
  const site = (b.site ?? {}) as Record<string, any>;
  const aud = (b.audience ?? {}) as Record<string, any>;
  const claims = ((b.claims as { text: string; confirmed: boolean }[] | undefined) ?? []);
  return {
    name: String(site.name ?? ""),
    oneLiner: String(site.one_liner ?? ""),
    audience: String(aud.icp ?? ""),
    goal: aud.success_target ? `${aud.success_target.signups} sign-ups in ${aud.success_target.days} days` : "",
    headline: String(hero?.headline ?? ""),
    subheadline: String(hero?.subheadline ?? ""),
    button: String(hero?.cta?.label ?? ""),
    note: String(hero?.note ?? ""),
    toolsHeading: String(tools?.heading ?? ""),
    tools: (tools?.items as string[] | undefined) ?? [],
    previewHeading: String(preview?.heading ?? ""),
    benefits: ((benefits?.items as { title: string; text: string }[] | undefined) ?? []).map((i) => ({ title: i.title, text: i.text })),
    fields: ((wl?.form?.fields as { label: string; required?: boolean }[] | undefined) ?? []).map((f) => `${f.label}${f.required ? " (required)" : ""}`),
    perks: (wl?.perks as string[] | undefined) ?? [],
    thanks: String(wl?.form?.success_message ?? ""),
    look: [(b.look as Record<string, any> | undefined)?.preset, ...(((site.brand_words as string[] | undefined) ?? [])), ...(((b.brand as Record<string, any> | undefined)?.tone ? [(b.brand as Record<string, any>).tone] : []))].filter(Boolean).join(", "),
    placeholders: ((b.placeholders as { where: string; what: string }[] | undefined) ?? []).map((p) => p.what),
    link: String((b.main_button as Record<string, any> | undefined)?.link ?? ""),
    unconfirmed: claims.filter((c) => !c.confirmed).map((c) => c.text),
    contact: String(site.contact_email ?? ""),
  };
}
