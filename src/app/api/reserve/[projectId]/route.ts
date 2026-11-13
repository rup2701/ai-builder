import { NextResponse } from "next/server";
import { and, count, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { sendEmail } from "@/lib/notify";
import { handleReservation, type ReserveDeps } from "@/lib/reservations";
import type { WorkspaceState } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const originOf = (u?: string) => { try { return u ? new URL(u).origin : null; } catch { return null; } };

function cors(origin: string | null | undefined) {
  return {
    "Access-Control-Allow-Origin": origin ?? "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

const deps: ReserveDeps = {
  salt: process.env.RESERVE_HASH_SALT || process.env.SESSION_SECRET || "reserve",
  adminCopy: process.env.ADMIN_NOTIFY_EMAIL?.trim() || undefined,
  now: () => new Date(),
  async project(id) {
    const rows = await db.select({ state: schema.projects.state, email: schema.users.email }).from(schema.projects).innerJoin(schema.users, eq(schema.users.id, schema.projects.ownerId)).where(eq(schema.projects.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    const st = row.state as WorkspaceState;
    const name = (st.site?.brief?.site as { name?: string } | undefined)?.name ?? "your restaurant";
    return { name, ownerEmail: row.email, allowedOrigin: originOf(st.site?.build?.url) };
  },
  async recent(projectId, ipHash, since) {
    const [p] = await db.select({ n: count() }).from(schema.tableRequests).where(and(eq(schema.tableRequests.projectId, projectId), gte(schema.tableRequests.createdAt, since)));
    const [v] = await db.select({ n: count() }).from(schema.tableRequests).where(and(eq(schema.tableRequests.projectId, projectId), eq(schema.tableRequests.ipHash, ipHash), gte(schema.tableRequests.createdAt, since)));
    return { project: p?.n ?? 0, visitor: v?.n ?? 0 };
  },
  async save({ projectId, v, ipHash }) {
    const [row] = await db.insert(schema.tableRequests).values({ projectId, guestName: v.name, phone: v.phone || null, email: v.email || null, day: v.day, time: v.time, partySize: v.party, note: v.note || null, ipHash }).returning({ id: schema.tableRequests.id });
    return row.id;
  },
  async mail(to, msg) {
    const r = await sendEmail(process.env, to, msg);
    if (!r.ok) console.error("table request email not sent:", r.error);
    return r.ok;
  },
  async markEmailed(id) {
    await db.update(schema.tableRequests).set({ emailed: true }).where(eq(schema.tableRequests.id, id));
  },
};

/** The restaurant site's booking form posts here. See src/lib/reservations.ts for the rules. */
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  const input = await req.json().catch(() => null);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const r = await handleReservation(projectId, input, { origin: req.headers.get("origin"), ip }, deps);
  return NextResponse.json(r.body, { status: r.status, headers: cors(r.origin) });
}

/** The browser asks first (a preflight). It is answered only for the site's own address. */
export async function OPTIONS(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  const origin = req.headers.get("origin");
  const p = /^[0-9a-f-]{36}$/i.test(projectId) ? await deps.project(projectId).catch(() => null) : null;
  const ok = !!p?.allowedOrigin && p.allowedOrigin === origin;
  return new NextResponse(null, { status: ok ? 204 : 403, headers: ok ? cors(origin) : undefined });
}
