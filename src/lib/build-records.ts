/**
 * Learning data (APP-15): one row in build_records per full site build, written quietly by the worker after the build.
 * The worker side (reading run.json, AGENT_LOG.md and git) is in worker/build-record.ts. This file holds what the web
 * app needs too: keeping Scout's first draft of the brief, and noting later facts (archived, restored) on the records.
 * Saving a record never fails or slows down what the owner is doing: every write here is best effort.
 */
import type { WorkspaceState } from "./workspace/types";

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * Scout's drafted brief, kept next to the one the owner approves. It is taken the first time the interview reaches the
 * review screen (phase "summary" with a brief) and never replaced after that, so the owner's edits show as the
 * difference between the draft and the brief at build time. Some interview steps rebuild state.site from scratch, so the
 * draft is carried over from the state before the turn.
 */
export function keepDraftBrief(prev: WorkspaceState, next: WorkspaceState, now: () => string = () => new Date().toISOString()): WorkspaceState {
  const site = next.site;
  if (!site?.brief) return next;
  if (site.draftBrief) return next;
  if (prev.site?.draftBrief) return { ...next, site: { ...site, draftBrief: prev.site.draftBrief, draftBriefAt: prev.site.draftBriefAt } };
  if (next.phase !== "summary") return next;
  return { ...next, site: { ...site, draftBrief: site.brief, draftBriefAt: now() } };
}

/** A later fact about a project, appended to details.events on each of its build records, for example { event: "archived", at }. */
export async function noteOnBuildRecords(db: Db, projectId: string, event: string, at: string = new Date().toISOString()): Promise<void> {
  try {
    await db.query(
      `UPDATE build_records
          SET details = jsonb_set(details, '{events}', COALESCE(details->'events', '[]'::jsonb) || $2::jsonb)
        WHERE project_id = $1`,
      [projectId, JSON.stringify([{ event, at }])],
    );
  } catch (e) {
    console.warn(`[build-record] could not note ${event} on project ${projectId.slice(0, 8)}: ${e instanceof Error ? e.message : e}`);
  }
}
