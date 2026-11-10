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
import { attachmentNote } from "@/lib/builder/site-assets";
import { ChangeBody as Body } from "@/lib/builder/change-body";
import type { Msg, WorkspaceState } from "@/lib/workspace/types";
import { appliedChanges, changeLimit, changeMsgs, changesUsed, cleanInstruction, isMaking, LONG_REQUEST, MAX_REVISIONS, mergeWorkerUpdates, MIN_INSTRUCTION, needsAnswer, siteIsLive, type ChangeMsg } from "@/lib/builder/site-change";

export const dynamic = "force-dynamic";
// Scout rewrites the request with one or two model calls before the card appears.
export const maxDuration = 60;

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
  // A change that is only being checked and deployed after approval does not block the next request: its job is ahead in the queue.
  if (changeMsgs(state).some(isMaking)) return fail("A change is already running. I'll be done in a few minutes.", 409);

  /**
   * The worker updates change messages (status, phase, summary) while this request is working, and the owner can now send a request
   * while an approved change is still being checked. So a change message this request did not touch keeps the worker's latest version,
   * read again just before saving; otherwise a slow request (Scout takes seconds to plan) would put an old status back.
   */
  const keepWorkerUpdates = async (next: WorkspaceState): Promise<WorkspaceState> => {
    const [cur] = await db.select({ state: schema.projects.state }).from(schema.projects).where(eq(schema.projects.id, p.id));
    return mergeWorkerUpdates(next, state, cur?.state as WorkspaceState | undefined);
  };
  const save = async (wanted: WorkspaceState) => {
    const next = await keepWorkerUpdates(wanted);
    await db.update(schema.projects).set({ state: next, updatedAt: new Date() }).where(eq(schema.projects.id, p.id));
    return NextResponse.json({ state: next });
  };
  const patch = (s: WorkspaceState, msgId: number, change: Partial<ChangeMsg>): WorkspaceState => ({
    ...s,
    msgs: s.msgs.map((m) => (m.id === msgId && m.kind === "site_change" ? ({ ...m, ...change } as Msg) : m)),
  });
  const find = (msgId: number, status: ChangeMsg["status"]) => changeMsgs(state).find((c) => c.id === msgId && c.status === status);
  /** Queue one worker job for this change and move the message to its next status. */
  const queue = async (m: ChangeMsg, change: Partial<ChangeMsg>, base: WorkspaceState = state) => {
    const running = await db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.projectId, p.id), inArray(schema.jobs.type, ["site_build", "site_publish", "site_change"]), inArray(schema.jobs.status, ["queued", "running"])));
    // The one exception: jobs that are checking and deploying an approved change. The worker takes jobs one at a time, so a new job waits behind them.
    const publishing = new Set(changeMsgs(state).filter((c) => c.status === "publishing" && c.jobId).map((c) => c.jobId));
    if (running.some((r) => !publishing.has(r.id))) return fail("Something is already running on this site. Try again in a few minutes.", 409);
    const [job] = await db.insert(schema.jobs).values({ projectId: p.id, type: "site_change" }).returning({ id: schema.jobs.id });
    return save(patch(base, m.id, { ...change, jobId: job.id }));
  };

  /** Attached pictures must be this project's own. Only their details are kept in the chat; the bytes stay in site_assets. */
  const loadAssets = async (ids: string[] | undefined) => {
    const wanted = [...new Set(ids ?? [])];
    if (!wanted.length) return [];
    const rows = await db
      .select({ id: schema.siteAssets.id, name: schema.siteAssets.name, width: schema.siteAssets.width, height: schema.siteAssets.height })
      .from(schema.siteAssets)
      .where(and(eq(schema.siteAssets.projectId, p.id), inArray(schema.siteAssets.id, wanted)));
    return rows.length === wanted.length ? rows : null;
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
    // A change that failed its checks after approval can come back to its preview; nothing new is built on top of it until it is answered.
    if (changeMsgs(state).some(needsAnswer)) return fail("Approve or cancel the change above first.", 409);
    const limit = changeLimit();
    if (limit > 0 && changesUsed(state) >= limit) return fail(`This site has used its ${limit} changes for now.`, 429);
    return queue(m, { status: "queued", action: "make", note: undefined, error: undefined });
  }

  if ("approve" in data) {
    const m = find(data.approve, "review");
    return m ? queue(m, { status: "publishing", action: "publish", phase: "checking", note: undefined }) : gone();
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
    if ((m.revisions ?? 0) >= MAX_REVISIONS) return fail(`That's ${MAX_REVISIONS} rounds of changes. Approve it, or cancel it and start again with a new request.`, 409);
    const typed = cleanInstruction(data.text);
    if (typed.length < MIN_INSTRUCTION) return fail("Say a little more about what to change.", 400);
    const added = await loadAssets(data.assetIds);
    if (!added) return fail("One of the pictures is not there any more. Please attach it again.", 400);
    const have = new Map((m.assets ?? []).map((a) => [a.id, a]));
    for (const a of added) have.set(a.id, a);
    const feedback = typed + attachmentNote(added);
    // The owner's words are kept on the change card (not as a chat message after it), so the history stays with the change.
    return queue(m, { status: "queued", action: "make", feedback, lastFeedback: typed, adjustments: [...(m.adjustments ?? []), typed], revisions: (m.revisions ?? 0) + 1, note: undefined, ...(have.size ? { assets: [...have.values()] } : {}) });
  }

  // A new request. The one above has to be answered first, because the next change would build on top of it.
  if (changeMsgs(state).some(needsAnswer)) return fail("Approve or cancel the change above first.", 409);
  const text = cleanInstruction(data.text);
  if (text.length < MIN_INSTRUCTION) return fail("Say a little more about what to change.", 400);
  const loaded = await loadAssets(data.assetIds);
  if (!loaded) return fail("One of the pictures is not there any more. Please attach it again.", 400);
  const assets = loaded;
  const note = attachmentNote(assets);
  // Scout rewrites the request as a short plan the owner can check. If that fails, the owner's own words are used.
  let title: string | undefined;
  let changes: string[] | undefined;
  let instruction = text + note;
  let size: "small" | "substantial" | undefined;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
    const brief = state.site?.brief ?? {};
    const siteName = typeof brief.name === "string" && brief.name ? brief.name : "this site";
    const { plan, usage } = await planChange(anthropicComplete({ apiKey, model, timeoutMs: 30000, maxTokens: 3000 }), text + note, { siteName, sections: sectionsOf(brief), applied: appliedChanges(state), content: pageContentOf(brief) });
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
      // A long request goes to the agent in the owner's own words as well, so nothing is lost in the rewrite.
      instruction = text.length > LONG_REQUEST ? `${plan.instruction}\n\nThe owner's own words (follow these exactly where they differ from the summary above):\n${text}` : plan.instruction;
      // The planner may leave the file paths out of its rewrite; the agent always gets them.
      if (note && !plan.instruction.includes("/art/")) instruction += note;
      size = plan.size;
    }
  }
  let next: WorkspaceState = {
    ...state,
    msgs: state.msgs.map((m) => (m.kind === "site_change" && m.status === "proposed" ? ({ ...m, status: "cancelled" } as Msg) : m)),
  };
  next = pushMsg(next, { kind: "user", text });
  next = pushMsg(next, { kind: "site_change", instruction, ...(title ? { title, changes, size } : {}), status: "proposed", ...(assets.length ? { assets } : {}) });
  return save(next);
}
