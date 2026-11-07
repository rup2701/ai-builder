import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import { pushMsg } from "@/lib/workspace/state";
import { anthropicComplete } from "@/lib/agents/anthropic";
import { pageContentOf, planChange, sectionsOf } from "@/lib/agents/change-planner";
import { logUsage } from "@/lib/usage";
import type { Msg, WorkspaceState } from "@/lib/workspace/types";
import { appliedChanges, changeLimit, changeMsgs, changesUsed, cleanInstruction, isOpen, MAX_REVISIONS, MIN_INSTRUCTION, needsAnswer, siteIsLive, type ChangeMsg } from "@/lib/builder/site-change";

export const dynamic = "force-dynamic";
// Scout rewrites the request with one or two model calls before the card appears.
export const maxDuration = 60;

const Body = z.union([
  z.object({ text: z.string().min(1).max(2000) }),
  z.object({ confirm: z.number().int() }),
  z.object({ cancel: z.number().int() }),
  z.object({ approve: z.number().int() }),
  z.object({ revise: z.number().int(), text: z.string().min(1).max(2000) }),
  z.object({ remove: z.number().int() }),
  z.object({ undo: z.number().int() }),
]);

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Changes to a live website, asked for in the chat. One change moves through these steps:
 *   { text }             proposes a change: the chat shows it with a "Make this change" button. Nothing runs yet.
 *   { confirm } / { cancel }   start it, or drop the proposal.
 *   (the worker makes the change, checks it and shows a preview. Nothing is live yet.)
 *   { approve }          publish it.
 *   { revise, text }     ask for changes; the agent revises it (up to MAX_REVISIONS rounds) and shows a new preview.
 *   { remove }           put the code back as it was. Nothing is published.
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
  const patch = (s: WorkspaceState, msgId: number, change: Partial<ChangeMsg>): WorkspaceState => ({
    ...s,
    msgs: s.msgs.map((m) => (m.id === msgId && m.kind === "site_change" ? ({ ...m, ...change } as Msg) : m)),
  });
  const find = (msgId: number, status: ChangeMsg["status"]) => changeMsgs(state).find((c) => c.id === msgId && c.status === status);
  /** Queue one worker job for this change and move the message to its next status. */
  const queue = async (m: ChangeMsg, change: Partial<ChangeMsg>) => {
    const running = await db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.projectId, p.id), inArray(schema.jobs.type, ["site_build", "site_publish", "site_change"]), inArray(schema.jobs.status, ["queued", "running"])))
      .limit(1);
    if (running.length) return fail("Something is already running on this site. Try again in a few minutes.", 409);
    const [job] = await db.insert(schema.jobs).values({ projectId: p.id, type: "site_change" }).returning({ id: schema.jobs.id });
    return save(patch(state, m.id, { ...change, jobId: job.id }));
  };

  const data = body.data;
  const gone = () => fail("That change is not waiting any more.", 409);

  if ("cancel" in data) {
    const m = find(data.cancel, "proposed");
    return m ? save(patch(state, m.id, { status: "cancelled" })) : gone();
  }

  if ("confirm" in data) {
    const m = find(data.confirm, "proposed");
    if (!m) return gone();
    const limit = changeLimit();
    if (limit > 0 && changesUsed(state) >= limit) return fail(`This site has used its ${limit} changes for now.`, 429);
    return queue(m, { status: "queued", action: "make", note: undefined, error: undefined });
  }

  if ("approve" in data) {
    const m = find(data.approve, "review");
    return m ? queue(m, { status: "publishing", action: "publish", note: undefined }) : gone();
  }

  if ("undo" in data) {
    const m = find(data.undo, "done");
    if (!m || !m.published) return gone();
    const latest = Math.max(...changeMsgs(state).filter((c) => c.status === "done").map((c) => c.id));
    if (m.id !== latest) return fail("Only the latest change can be undone.", 409);
    return queue(m, { status: "working", action: "discard", note: undefined });
  }

  if ("remove" in data) {
    const m = find(data.remove, "review");
    return m ? queue(m, { status: "working", action: "discard", note: undefined }) : gone();
  }

  if ("revise" in data) {
    const m = find(data.revise, "review");
    if (!m) return gone();
    if ((m.revisions ?? 0) >= MAX_REVISIONS) return fail(`That's ${MAX_REVISIONS} rounds of changes. Approve it, or remove it and start again with a new request.`, 409);
    const feedback = cleanInstruction(data.text);
    if (feedback.length < MIN_INSTRUCTION) return fail("Say a little more about what to change.", 400);
    return queue(m, { status: "queued", action: "make", feedback, revisions: (m.revisions ?? 0) + 1, note: undefined });
  }

  // A new request. The one above has to be answered first, because the next change would build on top of it.
  if (changeMsgs(state).some(needsAnswer)) return fail("Finish the change above first: approve it, ask for changes, or remove it.", 409);
  const text = cleanInstruction(data.text);
  if (text.length < MIN_INSTRUCTION) return fail("Say a little more about what to change.", 400);
  // Scout rewrites the request as a short plan the owner can check. If that fails, the owner's own words are used.
  let title: string | undefined;
  let changes: string[] | undefined;
  let instruction = text;
  let size: "small" | "substantial" | undefined;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
    const brief = state.site?.brief ?? {};
    const siteName = typeof brief.name === "string" && brief.name ? brief.name : "this site";
    const { plan, usage } = await planChange(anthropicComplete({ apiKey, model, timeoutMs: 25000 }), cleanInstruction(data.text, 1200), { siteName, sections: sectionsOf(brief), applied: appliedChanges(state), content: pageContentOf(brief) });
    if (usage) await logUsage({ projectId: p.id, step: "change_plan", model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd }).catch(() => {});
    // A question, or something that cannot be done: the chat keeps what the owner wrote and the reply, and nothing is queued.
    const reply = plan?.answer ?? plan?.decline;
    if (reply) {
      let next = pushMsg(state, { kind: "user", text });
      next = pushMsg(next, { kind: "bot", text: reply });
      return save(next);
    }
    if (plan?.title && plan.changes && plan.instruction) {
      title = plan.title;
      changes = plan.changes;
      instruction = plan.instruction;
      size = plan.size;
    }
  }
  let next: WorkspaceState = {
    ...state,
    msgs: state.msgs.map((m) => (m.kind === "site_change" && m.status === "proposed" ? ({ ...m, status: "cancelled" } as Msg) : m)),
  };
  next = pushMsg(next, { kind: "user", text });
  next = pushMsg(next, { kind: "site_change", instruction, ...(title ? { title, changes, size } : {}), status: "proposed" });
  return save(next);
}
