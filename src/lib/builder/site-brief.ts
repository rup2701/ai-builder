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

/** The SaaS product site brief: same envelope, different blocks, and a single-email signup instead of a waitlist form. */
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

/** The SaaS product showcase brief: no sign-up, no owner area. Sections in blocks, the brand and the main button beside them. */
export const ShowcaseBrief = z
  .object({
    site: z.object({ name: z.string().trim().min(1).max(60), kind: z.literal("saas-showcase") }).passthrough(),
    audience: z.object({ icp: z.string().trim().min(5) }).passthrough(),
    brand: z.object({ tone: z.enum(["calm", "bold", "playful", "serious"]), color: z.enum(["light", "dark", "blue-accent"]) }).passthrough(),
    main_button: z.object({ label: z.string().trim().min(1).max(30), link: z.string().nullable().optional() }).passthrough(),
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
    const link = b.main_button.link;
    if (link && !/^(https:\/\/\S+|mailto:\S+@\S+)$/.test(link)) ctx.addIssue({ code: "custom", path: ["main_button", "link"], message: "the link must start with https:// or mailto:" });
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

export type SiteBriefT = z.infer<typeof SiteBrief>;
export type SitePack = "waitlist" | "saas";

export function validateSiteBrief(input: unknown, pack: SitePack = "waitlist"): { ok: true; brief: SiteBriefT } | { ok: false; error: string } {
  const r = (pack === "saas" ? ShowcaseBrief : SiteBrief).safeParse(input) as ReturnType<typeof SiteBrief.safeParse>;
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
  // The SaaS pack shows its pills where the waitlist pack shows benefits, and its signup where the waitlist has a form.
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
