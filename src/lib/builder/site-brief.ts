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

export type SiteBriefT = z.infer<typeof SiteBrief>;

export function validateSiteBrief(input: unknown): { ok: true; brief: SiteBriefT } | { ok: false; error: string } {
  const r = SiteBrief.safeParse(input);
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
  const hero = get("hero"), preview = get("preview"), benefits = get("benefits"), tools = get("integrations"), wl = get("waitlist");
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
    look: [(b.look as Record<string, any> | undefined)?.preset, ...(((site.brand_words as string[] | undefined) ?? []))].filter(Boolean).join(", "),
    unconfirmed: claims.filter((c) => !c.confirmed).map((c) => c.text),
    contact: String(site.contact_email ?? ""),
  };
}
