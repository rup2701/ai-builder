import type { Msg, WorkspaceState } from "@/lib/workspace/types";

export type ChangeMsg = Extract<Msg, { kind: "site_change" }>;

/** How many changes a site may have in beta (SITE_CHANGE_LIMIT; 0 means no cap). Failed and cancelled ones do not count. */
export function changeLimit(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SITE_CHANGE_LIMIT ?? 5);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
}

/** Clean what the owner typed. It is passed to the runner as one argument, never through a shell, but a leading dash would read as a flag. */
export function cleanInstruction(raw: string, max = 2000): string {
  // Line breaks stay, so a numbered list or a few paragraphs keep their shape. Spaces and tabs collapse.
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .split("\n")
      .map((l) => l.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .replace(/^-+\s*/, "")
      .slice(0, max)
  );
}

/** Requests longer than this also reach the agent word for word, because a rewrite loses detail. */
export const LONG_REQUEST = 300;

export const MIN_INSTRUCTION = 5;

/** A site can take changes once it is live, the folder is on the worker, and nothing else is running. */
export function siteIsLive(s: WorkspaceState): boolean {
  const b = s.site?.build;
  return Boolean(b?.url && b.finishedAt && b.runDir && !b.failedStage && s.phase !== "build" && s.phase !== "verify");
}

export function changeMsgs(s: WorkspaceState): ChangeMsg[] {
  return s.msgs.filter((m): m is ChangeMsg => m.kind === "site_change");
}

/** The worker is busy with this change. */
export const isOpen = (m: ChangeMsg) => m.status === "queued" || m.status === "working" || m.status === "publishing";

/** The change is made and waiting for the owner: approve, ask for changes, or remove. */
export const needsAnswer = (m: ChangeMsg) => m.status === "review";

export const MAX_REVISIONS = 3;

/** What has already been made live through the chat, newest last, for Scout to compare a new request with. Undone and removed changes are not in it. */
export function appliedChanges(s: WorkspaceState, max = 10): string[] {
  return changeMsgs(s)
    .filter((m) => m.status === "done")
    .slice(-max)
    .map((m) => (m.title ? `${m.title}: ${(m.changes ?? []).join("; ")}` : m.instruction).slice(0, 400));
}

export function changesUsed(s: WorkspaceState): number {
  return changeMsgs(s).filter((m) => m.status === "queued" || m.status === "working" || m.status === "review" || m.status === "publishing" || m.status === "done").length;
}
