import type { WorkspaceState } from "@/lib/workspace/types";
import { DONE_STAGE } from "@/lib/builder/site-stages";

/** The four steps a person sees at the top of a website project. */
export const PROGRESS_STEPS = ["Idea", "Build", "Publish", "Live"] as const;

export type Progress = {
  /** Index of the step in progress (3 when live). */
  active: number;
  /** Every step is finished: the site is live. */
  live: boolean;
  /** The step in progress stopped with a problem. */
  failed: boolean;
};

/**
 * Where a website project stands. Idea = the interview; Build = writing, polishing and testing the
 * site (runner stages 0 to 3); Publish = putting it online (stage 4); Live = finished.
 */
export function siteProgress(st: WorkspaceState): Progress {
  const b = st.site?.build;
  if (b) {
    if (b.stage >= DONE_STAGE && !b.error) return { active: 3, live: true, failed: false };
    const failed = b.failedStage !== undefined || Boolean(b.error);
    return { active: b.stage >= 4 ? 2 : 1, live: false, failed };
  }
  if (st.phase === "build" || st.phase === "verify") return { active: 1, live: false, failed: false };
  return { active: 0, live: false, failed: false };
}

/** "claude-sonnet-5-5" becomes "Claude Sonnet 5.5". Anything unexpected is shown as it is. */
export function modelLabel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return id;
  const name = m[1][0].toUpperCase() + m[1].slice(1);
  return `Claude ${name} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}
