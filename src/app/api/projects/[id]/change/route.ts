import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import { pushMsg } from "@/lib/workspace/state";
import type { Msg, WorkspaceState } from "@/lib/workspace/types";
import { changeLimit, changeMsgs, changesUsed, cleanInstruction, isOpen, MIN_INSTRUCTION, siteIsLive } from "@/lib/builder/site-change";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({ text: z.string().min(1).max(2000) }),
  z.object({ confirm: z.number().int() }),
  z.object({ cancel: z.number().int() }),
]);

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Changes to a live website, asked for in the chat.
 *   { text }     proposes a change: the chat shows it with a "Make this change" button. Nothing runs yet.
 *   { confirm }  queues it for the worker.
 *   { cancel }   drops a proposal.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return fail("Sign in first.", 401);
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return fail("Not found.", 404);
  if (p.kind !== "site") return fail("This project is not a website.", 400);

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return fail("Tell me what to change.", 400);

  const state = p.state as WorkspaceState;
  if (!siteIsLive(state)) return fail("The site has to be live before it can be changed.", 409);
  if (changeMsgs(state).some(isOpen)) return fail("A change is already running. I'll be done in a few minutes.", 409);

  const save = async (next: WorkspaceState) => {
    await db.update(schema.projects).set({ state: next, updatedAt: new Date() }).where(eq(schema.projects.id, p.id));
    return NextResponse.json({ state: next });
  };
  const setStatus = (s: WorkspaceState, msgId: number, patch: Partial<Extract<Msg, { kind: "site_change" }>>): WorkspaceState => ({
    ...s,
    msgs: s.msgs.map((m) => (m.id === msgId && m.kind === "site_change" ? ({ ...m, ...patch } as Msg) : m)),
  });

  const data = body.data;
  if ("cancel" in data) {
    const cancelId = data.cancel;
    const m = changeMsgs(state).find((c) => c.id === cancelId && c.status === "proposed");
    if (!m) return fail("That change is not waiting any more.", 409);
    return save(setStatus(state, m.id, { status: "cancelled" }));
  }

  if ("confirm" in data) {
    const confirmId = data.confirm;
    const m = changeMsgs(state).find((c) => c.id === confirmId && c.status === "proposed");
    if (!m) return fail("That change is not waiting any more.", 409);
    const limit = changeLimit();
    if (limit > 0 && changesUsed(state) >= limit) return fail(`This site has used its ${limit} changes for now.`, 429);
    const running = await db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.projectId, p.id), inArray(schema.jobs.type, ["site_build", "site_publish", "site_change"]), inArray(schema.jobs.status, ["queued", "running"])))
      .limit(1);
    if (running.length) return fail("Something is already running on this site. Try again in a few minutes.", 409);
    const [job] = await db.insert(schema.jobs).values({ projectId: p.id, type: "site_change" }).returning({ id: schema.jobs.id });
    return save(setStatus(state, m.id, { status: "queued", jobId: job.id }));
  }

  // A new proposal replaces an older one that nobody confirmed.
  const text = cleanInstruction(data.text);
  if (text.length < MIN_INSTRUCTION) return fail("Say a little more about what to change.", 400);
  let next: WorkspaceState = {
    ...state,
    msgs: state.msgs.map((m) => (m.kind === "site_change" && m.status === "proposed" ? ({ ...m, status: "cancelled" } as Msg) : m)),
  };
  next = pushMsg(next, { kind: "user", text });
  next = pushMsg(next, { kind: "site_change", instruction: text, status: "proposed" });
  return save(next);
}
