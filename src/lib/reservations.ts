import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Table requests from a restaurant site's booking form. The site is on another address than the Builder, so the form posts across origins:
 * the Builder answers only the origin the site was published at. A request is saved first and emailed second, so a failed email never loses one.
 * It is a request, not a booking: nothing here checks availability, and the guest is told the owner will confirm.
 */

export const PER_PROJECT_PER_HOUR = 30;
export const PER_VISITOR_PER_HOUR = 5;
export const MAX_DAYS_AHEAD = 180;

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const text = (max: number) => z.string().transform(clean).pipe(z.string().max(max));

export const RequestInput = z
  .object({
    name: text(80).pipe(z.string().min(1, "Please tell us your name.")),
    phone: text(30).optional(),
    email: text(120).optional(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a date."),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Please choose a time."),
    party: z.coerce.number().int().min(1, "Please say how many of you.").max(20, "For a group of more than 20, please call us."),
    note: text(300).optional(),
    /** A box people never see. A bot fills it, so a request with anything in it is dropped without telling the sender. */
    website: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const digits = (v.phone ?? "").replace(/\D/g, "");
    const phoneOk = digits.length >= 7 && digits.length <= 15;
    const emailOk = !!v.email && /^\S+@\S+\.\S+$/.test(v.email);
    if (!phoneOk && !emailOk) ctx.addIssue({ code: "custom", path: ["phone"], message: "Please give a phone number or an email so the restaurant can confirm." });
    if (v.email && !emailOk) ctx.addIssue({ code: "custom", path: ["email"], message: "That email does not look right." });
  });

export type RequestT = z.infer<typeof RequestInput>;

/** The first problem in the guest's words, or null when the request is fine. `today` is the restaurant's date as yyyy-mm-dd. */
export function checkRequest(input: unknown, today: string): { ok: true; value: RequestT } | { ok: false; error: string } {
  const r = RequestInput.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "Please check the form." };
  const v = r.data;
  const d = Date.parse(`${v.day}T00:00:00Z`);
  const t0 = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(d) || new Date(d).toISOString().slice(0, 10) !== v.day) return { ok: false, error: "Please choose a date." };
  // The server's date is UTC and the restaurant's is not, so the evening before midnight UTC is still "today" for a guest: one day of slack.
  if (d < t0 - 86_400_000) return { ok: false, error: "Please choose today or a later date." };
  if (d > t0 + MAX_DAYS_AHEAD * 86_400_000) return { ok: false, error: "Please choose a date within the next six months." };
  return { ok: true, value: v };
}

export const hashVisitor = (ip: string, salt: string) => createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The email to the owner. Plain facts; the guest's words are escaped and kept as written. */
export function requestEmail(siteName: string, v: RequestT) {
  const when = `${v.day} at ${v.time}`;
  const contact = [v.phone ? `Phone: ${v.phone}` : "", v.email ? `Email: ${v.email}` : ""].filter(Boolean);
  const lines = [`${v.name} asked for a table for ${v.party} on ${when}.`, ...contact, ...(v.note ? [`Note: ${v.note}`] : []), "This is a request, not a booking. Please confirm with the guest by phone or email."];
  return {
    subject: `Table request for ${siteName}: ${v.party} on ${when}`,
    text: `${lines.join("\n")}\n`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a"><h1 style="font-size:20px;margin:0 0 16px">${esc(`Table request for ${siteName}`)}</h1>${lines.map((l) => `<p style="line-height:1.5;margin:0 0 10px">${esc(l)}</p>`).join("")}</div>`,
  };
}

export type ReserveProject = { name: string; ownerEmail: string; allowedOrigin: string | null };
export type ReserveDeps = {
  project: (id: string) => Promise<ReserveProject | null>;
  recent: (projectId: string, ipHash: string, since: Date) => Promise<{ project: number; visitor: number }>;
  save: (row: { projectId: string; v: RequestT; ipHash: string }) => Promise<string>;
  mail: (to: string, msg: ReturnType<typeof requestEmail>) => Promise<boolean>;
  markEmailed: (id: string) => Promise<void>;
  now: () => Date;
  adminCopy?: string;
  salt: string;
};

export type Reply = { status: number; body: { ok?: true; error?: string }; origin?: string };

/** Handles one request. Returns the status and body to send; `origin` is the one allowed to read the answer (CORS). */
export async function handleReservation(projectId: string, input: unknown, ctx: { origin: string | null; ip: string }, d: ReserveDeps): Promise<Reply> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return { status: 404, body: { error: "Not found." } };
  const p = await d.project(projectId);
  if (!p) return { status: 404, body: { error: "Not found." } };
  // Only the site this project was published at may post. Browsers send Origin on a cross-site post; a missing one is refused too.
  if (!p.allowedOrigin || ctx.origin !== p.allowedOrigin) return { status: 403, body: { error: "This form can only be used from the restaurant's own site." } };
  const reply = (status: number, body: Reply["body"]): Reply => ({ status, body, origin: p.allowedOrigin! });

  const now = d.now();
  const checked = checkRequest(input, now.toISOString().slice(0, 10));
  // A filled hidden box is a bot: it gets the same "thank you" as a guest and nothing is saved or sent.
  if (typeof (input as { website?: unknown } | null)?.website === "string" && (input as { website: string }).website.trim()) return reply(200, { ok: true });
  if (!checked.ok) return reply(422, { error: checked.error });

  const ipHash = hashVisitor(ctx.ip, d.salt);
  const n = await d.recent(projectId, ipHash, new Date(now.getTime() - 3_600_000));
  if (n.visitor >= PER_VISITOR_PER_HOUR || n.project >= PER_PROJECT_PER_HOUR) return reply(429, { error: "Too many requests just now. Please call the restaurant instead." });

  const id = await d.save({ projectId, v: checked.value, ipHash });
  const msg = requestEmail(p.name, checked.value);
  const sent = await d.mail(p.ownerEmail, msg).catch(() => false);
  if (d.adminCopy && d.adminCopy.toLowerCase() !== p.ownerEmail.toLowerCase()) await d.mail(d.adminCopy, { ...msg, subject: `[copy] ${msg.subject}` }).catch(() => false);
  if (sent) await d.markEmailed(id).catch(() => {});
  return reply(200, { ok: true });
}
