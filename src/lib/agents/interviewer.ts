import type { WorkspaceState } from "@/lib/workspace/types";
import { makeModelInterviewer } from "./model-interviewer";
import { anthropicComplete } from "./anthropic";
import { intakeTurn, type TurnResult } from "@/lib/workspace/state";

/**
 * The interviewer reads one user message and returns the next workspace state.
 * The rule-based version is the fallback and the test double. A model version keeps this
 * signature: it receives the knowledge pack as cached context, fills the brief through the
 * schema in src/lib/builder/brief.ts, and anything the validator rejects is re-asked.
 */
export interface Interviewer {
  turn(state: WorkspaceState, text: string): Promise<TurnResult>;
  /** Label written to the usage log. */
  model: string;
}

export const ruleInterviewer: Interviewer = {
  model: "rules",
  turn: async (state, text) => intakeTurn(state, text),
};

export function getInterviewer(): Interviewer {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || process.env.INTERVIEWER === "rules") return ruleInterviewer;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  return makeModelInterviewer(anthropicComplete({ apiKey: key, model }), model);
}