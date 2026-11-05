import type { Check } from "@/lib/builder/verify";
import type { BriefSummary, QId, StoreBrief } from "@/lib/builder/brief";
import type { StoreConfig } from "@/lib/builder/storeConfig";

export type Phase = "idle" | "intake" | "summary" | "build" | "verify" | "iterate";

type MsgBody =
  | { kind: "user"; text: string }
  | { kind: "bot"; text: string; hint?: string; free?: true; options?: string[]; palette?: string[] }
  | { kind: "build" }
  | { kind: "recap"; items: { label: string; value: string }[] }
  | { kind: "summary"; data: BriefSummary }
  | { kind: "checks"; results: Check[] }
  | { kind: "change"; lines: string[]; version: number; results: Check[] }
  /** A finished website build. The password is kept only until the person says they have saved it. */
  | { kind: "site_ready"; name: string; url: string; adminUrl: string; ownerEmail: string; password?: string; checks: string[] }
  /** One change to a live website, asked for in the chat. "proposed" waits for the person to press the button. */
  | {
      kind: "site_change";
      instruction: string;
      /** review: the change is made and checked, shown in a preview, and not live yet. */
      status: "proposed" | "queued" | "working" | "review" | "publishing" | "done" | "failed" | "cancelled" | "removed";
      jobId?: string;
      /** What the next worker job does for this change. */
      action?: "make" | "publish" | "discard";
      /** The code before this change, so "remove" and a failed change can put it back. */
      baseHead?: string;
      /** The owner's request for a revision, and how many rounds there have been (up to 3). */
      feedback?: string;
      revisions?: number;
      /** A short line shown on the card, for example why a revision or a publish did not work. */
      note?: string;
      /** The job whose record holds the pictures (they are not live pictures until the change is published). */
      snapJobId?: string;
      /** What changed, in the agent's own plain words (done). */
      summary?: string;
      error?: string;
      /** The section the picture shows, and which pictures exist. */
      anchor?: string;
      snaps?: { before: boolean; after: boolean };
    };

export type Msg = { id: number } & MsgBody;
export type MsgInput = MsgBody;

/** Everything the workspace shows. Saved on the project, so it survives refresh and closing the tab. */
export type WorkspaceState = {
  v: 1;
  phase: Phase;
  nextId: number;
  msgs: Msg[];
  brief: StoreBrief | null;
  qid: QId | null;
  history: StoreConfig[];
  buildStep: number;
  firstIdea: string;
  published: boolean;
  jobId: string | null;
  /** Website projects: the brief the interview saved (the runner's brief.json). */
  site?: { brief: Record<string, unknown>; build?: SiteBuild };
  /** Which website pack the interview and build use. Missing means the waitlist pack. */
  sitePack?: "waitlist" | "saas";
};

/** Progress of a website build, written by the worker and read by the side pane. */
export type SiteBuild = {
  /** Index into SITE_STAGES. The last index means finished. */
  stage: number;
  startedAt: string;
  finishedAt?: string;
  /** Files the agent has written so far: a sign of life during the long stage. */
  files: number;
  /** Written by the worker every few seconds while it runs the build. A stale value means the worker stopped. */
  heartbeatAt?: string;
  /** Set when a stage failed. The stage index it stopped at, and a plain message. */
  failedStage?: number;
  error?: string;
  /** The finished site's folder on the worker. With it, a failed publish can be retried without rebuilding. Empty when the folder is gone. */
  runDir?: string;
  /** The live address and the owner sign-in, once deployed. */
  url?: string;
  adminUrl?: string;
  ownerEmail?: string;
  /** True when this run only simulates the stages (no model calls, nothing is built). */
  fake?: boolean;
  /** Set when an email will be sent at the end; the address it goes to. */
  notifyEmail?: string;
};
