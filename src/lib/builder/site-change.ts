import type { Msg, WorkspaceState } from "@/lib/workspace/types";

export type ChangeMsg = Extract<Msg, { kind: "site_change" }>;

/** How many changes a site may have in beta (SITE_CHANGE_LIMIT; 0 means no cap). Failed and cancelled ones do not count. */
export function changeLimit(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SITE_CHANGE_LIMIT ?? 5);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
}

/** Clean what the owner typed. It is passed to the runner as one argument, never through a shell, but a leading dash would read as a flag. */
export function cleanInstruction(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/^-+\s*/, "").slice(0, 500);
}

export const MIN_INSTRUCTION = 5;

/** A site can take changes once it is live, the folder is on the worker, and nothing else is running. */
export function siteIsLive(s: WorkspaceState): boolean {
  const b = s.site?.build;
  return Boolean(b?.url && b.finishedAt && b.runDir && !b.failedStage && s.phase !== "build" && s.phase !== "verify");
}

export function changeMsgs(s: WorkspaceState): ChangeMsg[] {
  return s.msgs.filter((m): m is ChangeMsg => m.kind === "site_change");
}

export const isOpen = (m: ChangeMsg) => m.status === "queued" || m.status === "working";

export function changesUsed(s: WorkspaceState): number {
  return changeMsgs(s).filter((m) => m.status === "queued" || m.status === "working" || m.status === "done").length;
}
