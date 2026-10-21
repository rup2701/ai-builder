import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { WorkspaceState } from "@/lib/workspace/types";

export type Project = typeof schema.projects.$inferSelect;

/** A project, only if this user owns it. */
export async function loadOwned(projectId: string, userId: string): Promise<Project | null> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const [row] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)))
    .limit(1);
  return row ?? null;
}

export function titleFor(state: WorkspaceState, idea: string): string {
  const cfg = state.history[state.history.length - 1];
  if (cfg?.name) return cfg.name;
  const t = idea.trim();
  return t ? (t.length > 48 ? `${t.slice(0, 45)}…` : t) : "New project";
}

export function statusFor(state: WorkspaceState): string {
  if (state.phase === "build" || state.phase === "verify") return "building";
  if (state.history.length > 0) return state.published ? "published" : "ready";
  return "draft";
}
