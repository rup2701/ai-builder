import type { WorkspaceState } from "@/lib/workspace/types";
import { makeModelInterviewer } from "./model-interviewer";
import { anthropicChat, anthropicComplete } from "./anthropic";
import { makeSiteInterviewer } from "./site-interviewer";
import { makeLocalInterviewer } from "./local-interviewer";
import { readRestaurantSite } from "@/lib/builder/read-website";
import { isLocal } from "@/lib/builder/site-brief";
import { intakeTurn, type TurnResult } from "@/lib/workspace/state";

/**
 * The interviewer reads one user message and returns the next workspace state.
 * The rule-based version is the fallback and the test double. A model version keeps this
 * signature: it receives the knowledge pack as cached context, fills the brief through the
 * schema in src/lib/builder/brief.ts, and anything the validator rejects is re-asked.
 */
/** Who is talking, for the places the interview records it (the restaurant owner's confirmation). */
export type TurnContext = { userEmail?: string };

export interface Interviewer {
  turn(state: WorkspaceState, text: string, ctx?: TurnContext): Promise<TurnResult>;
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

/** The website interview needs the model; there is no rule-based version of it. */
export function getSiteInterviewer(): Interviewer | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const chat = anthropicChat({ apiKey: key, model });
  const site = makeSiteInterviewer(chat, model);
  const local = makeLocalInterviewer(chat, model, readRestaurantSite);
  // The restaurant pack has its own interview; every other website pack uses the guide-driven one.
  return { model, turn: (state, text, ctx) => (isLocal(state.sitePack) ? local : site).turn(state, text, ctx) };
}
