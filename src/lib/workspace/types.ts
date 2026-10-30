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
  site?: { brief: Record<string, unknown> };
};
