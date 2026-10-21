/**
 * Workspace state transitions. Pure functions, no I/O.
 * The server runs the intake (and later the model) through these; the worker finishes builds;
 * the browser uses `pushMsg` for the iterate phase. Same code in all three places.
 */

import {
  QUESTIONS,
  REOPEN_WORDS,
  briefToIdea,
  nextQuestion,
  readAnswer,
  reopen,
  seedBrief,
  settleAll,
  summarizeBrief,
  type StoreBrief,
} from "@/lib/builder/brief";
import { buildFromIdea } from "@/lib/builder/interpret";
import { verify } from "@/lib/builder/verify";
import type { Msg, MsgInput, WorkspaceState } from "./types";

export const BUILD_STEPS = ["Reading your idea", "Choosing a look", "Writing the pages", "Drawing the preview"];

export function pushMsg(s: WorkspaceState, m: MsgInput): WorkspaceState {
  return { ...s, nextId: s.nextId + 1, msgs: [...s.msgs, { ...m, id: s.nextId } as Msg] };
}

export function emptyState(): WorkspaceState {
  return {
    v: 1,
    phase: "idle",
    nextId: 1,
    msgs: [],
    brief: null,
    qid: null,
    history: [],
    buildStep: 0,
    firstIdea: "",
    published: false,
    jobId: null,
  };
}

export const ASK_FIRST =
  "What do you want to launch? Describe it in a sentence, like “an online clothing boutique in Los Gatos”.";

function askNext(s: WorkspaceState, b: StoreBrief): WorkspaceState {
  const q = nextQuestion(b);
  if (!q) {
    let n = pushMsg({ ...s, brief: b, phase: "summary", qid: null }, { kind: "summary", data: summarizeBrief(b) });
    n = pushMsg(n, { kind: "bot", text: "Does this look right? Say “build it” to go ahead, or tell me what to change." });
    return n;
  }
  return pushMsg({ ...s, brief: b, phase: "intake", qid: q.id }, { kind: "bot", text: q.ask, hint: q.how });
}

function startIntake(s: WorkspaceState, text: string): WorkspaceState {
  const b = seedBrief(text);
  const n = pushMsg({ ...s, firstIdea: text, published: false }, {
    kind: "bot",
    text: "Nice. A few quick questions first, one at a time. You can say “just build it” whenever you like.",
  });
  return askNext(n, b);
}

/** A new project. With an idea (from the hero) the first questions are already asked. */
export function initialState(idea?: string): WorkspaceState {
  let s = emptyState();
  const text = idea?.trim();
  if (text) return startIntake(pushMsg(s, { kind: "user", text }), text);
  s = pushMsg(s, { kind: "bot", text: ASK_FIRST });
  return s;
}

export type TurnResult = { state: WorkspaceState; action?: "build" };

/** One user message during idle, intake or summary (and "start over" after a build). */
export function intakeTurn(prev: WorkspaceState, raw: string): TurnResult {
  const text = raw.trim();
  if (!text) return { state: prev };
  let s = pushMsg(prev, { kind: "user", text });

  if (s.phase === "iterate" && /^\s*(start over|reset)\b/i.test(text)) {
    s = { ...s, history: [], published: false, brief: null, qid: null, buildStep: 0, jobId: null };
    s = pushMsg(s, { kind: "bot", text: "Starting over from your first idea." });
    return { state: startIntake(s, s.firstIdea || text) };
  }

  if (s.phase === "idle" || !s.brief) return { state: startIntake(s, text) };

  if (s.phase === "intake" && s.qid) {
    if (/^\s*(?:just\s+)?build(?:\s+it)?\b|^\s*skip\b/i.test(text)) return { state: askNext(s, settleAll(s.brief)) };
    const r = readAnswer(s.brief, s.qid, text);
    if ("retry" in r) return { state: pushMsg(s, { kind: "bot", text: r.retry }) };
    s = pushMsg({ ...s, brief: r.brief }, { kind: "bot", text: r.echo });
    return { state: askNext(s, r.brief) };
  }

  if (s.phase === "summary") {
    if (/^\s*(?:yes|yep|ok(?:ay)?|go(?: ahead)?|looks good|sounds good|do it|build(?:\s+it)?)\b/i.test(text)) {
      s = pushMsg({ ...s, phase: "build", buildStep: 0, qid: null }, { kind: "bot", text: "Got it. Building your store." });
      s = pushMsg(s, { kind: "build" });
      return { state: s, action: "build" };
    }
    const hit = /\b(change|edit|update|redo)\b/i.test(text) ? REOPEN_WORDS.find(([re]) => re.test(text)) : undefined;
    if (hit) return { state: askNext(s, reopen(s.brief, hit[1])) };
    return {
      state: pushMsg(s, {
        kind: "bot",
        text: "Say “build it” to go ahead, or “change the name”, “change the look”, “change pickup”, “change what I sell”.",
      }),
    };
  }

  return { state: s };
}

/** What the worker writes when a build finishes. */
export function finishBuild(prev: WorkspaceState): WorkspaceState {
  if (!prev.brief) throw new Error("Cannot build without a brief.");
  const { config, lines } = buildFromIdea(briefToIdea(prev.brief));
  let s: WorkspaceState = { ...prev, history: [config], buildStep: BUILD_STEPS.length, phase: "verify" };
  s = pushMsg(s, { kind: "bot", text: lines.join(" ") });
  s = pushMsg(s, { kind: "bot", text: "Running checks." });
  s = pushMsg({ ...s, phase: "iterate" }, { kind: "checks", results: verify(config) });
  return s;
}

export function optionsFor(qid: string | null): string[] {
  return qid ? QUESTIONS.find((q) => q.id === qid)?.options ?? [] : [];
}

/* ---------- Iterate phase: runs in the browser, saved through the state API ---------- */

import { HELP_TEXT, applyInstruction } from "@/lib/builder/interpret";

export function undoState(s: WorkspaceState): WorkspaceState {
  if (s.history.length < 2) return pushMsg(s, { kind: "bot", text: "There's nothing to undo yet." });
  const n = pushMsg(s, { kind: "bot", text: `Back to version ${s.history.length - 1}.` });
  return { ...n, history: s.history.slice(0, -1) };
}

/** One chat instruction after the store exists: rename, recolour, headline, undo and so on. */
export function iterateTurn(prev: WorkspaceState, raw: string): WorkspaceState {
  const text = raw.trim();
  if (!text) return prev;
  const s = pushMsg(prev, { kind: "user", text });
  const cur = s.history[s.history.length - 1];
  if (!cur) return s;
  if (/^\s*undo\b/i.test(text)) return undoState(s);
  const { config, lines } = applyInstruction(cur, text);
  if (!lines.length) return pushMsg(s, { kind: "bot", text: HELP_TEXT });
  const n = { ...s, history: [...s.history, config] };
  return pushMsg(n, { kind: "change", lines, version: s.history.length + 1, results: verify(config) });
}
