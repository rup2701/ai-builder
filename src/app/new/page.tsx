import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { initialState, pushMsg } from "@/lib/workspace/state";
import { getSiteInterviewer } from "@/lib/agents/interviewer";
import { SITE_OPENER } from "@/lib/agents/site-interviewer";
import { logUsage } from "@/lib/usage";
import { statusFor, titleFor } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** Creates a project (from the idea, if there is one) and opens it. */
export default async function New({ searchParams }: { searchParams: Promise<{ idea?: string; kind?: string }> }) {
  const { idea: raw, kind: rawKind } = await searchParams;
  const kind = rawKind === "site" ? "site" : "store";
  const idea = (raw ?? "").trim().slice(0, 1000);
  const user = await getUser();
  if (!user) redirect(`/signin?${new URLSearchParams({ ...(idea ? { idea } : {}), ...(kind === "site" ? { kind } : {}) })}`);

  let state = kind === "site" ? siteStart() : initialState(idea || undefined);
  let usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number } | undefined;
  if (kind === "site" && idea) {
    // The idea from the home page is the first answer.
    const ai = getSiteInterviewer();
    if (ai) {
      const r = await ai.turn(state, idea);
      state = { ...r.state, firstIdea: idea };
      usage = r.usage;
    }
  }
  const [row] = await db
    .insert(schema.projects)
    .values({ ownerId: user.id, kind, idea, title: titleFor(state, idea), status: statusFor(state), state })
    .returning({ id: schema.projects.id });
  if (usage) await logUsage({ projectId: row.id, step: "intake", ...usage });
  redirect(`/projects/${row.id}`);
}

function siteStart() {
  const s = initialState();
  return { ...pushMsg({ ...s, msgs: [], nextId: 1, phase: "intake" as const }, { kind: "bot", text: SITE_OPENER }) };
}
