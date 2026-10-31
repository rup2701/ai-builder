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
  | { kind: "change"; lines: string[]; version: number; results: Check[] };

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
};

/** Progress of a website build, written by the worker and read by the right-hand pane. */
export type SiteBuild = {
  /** Index into SITE_STAGES. The last index means finished. */
  stage: number;
  startedAt: string;
  finishedAt?: string;
  /** Files the agent has written so far: a sign of life during the long stage. */
  files: number;
  /** Set when a stage failed. The stage index it stopped at, and a plain message. */
  failedStage?: number;
  error?: string;
  /** The live address and the owner sign-in, once deployed. */
  url?: string;
  adminUrl?: string;
  ownerEmail?: string;
  /** True when this run only simulates the stages (no model calls, nothing is built). */
  fake?: boolean;
  /** Set when an email will be sent at the end; the address it goes to. */
  notifyEmail?: string;
};
