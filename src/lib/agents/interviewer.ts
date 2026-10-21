import type { WorkspaceState } from "@/lib/workspace/types";
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
  // When ANTHROPIC_API_KEY is set and the model interviewer exists, return it here.
  return ruleInterviewer;
}
