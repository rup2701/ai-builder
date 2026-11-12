import { redirect } from "next/navigation";
import { and, desc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { initialState, pushMsg } from "@/lib/workspace/state";
import { getSiteInterviewer } from "@/lib/agents/interviewer";
import { LOCAL_OPENER, SHOWCASE_OPENER, SITE_OPENER } from "@/lib/agents/site-interviewer";
import { normalizePack } from "@/lib/builder/site-brief";
import { logUsage } from "@/lib/usage";
import { statusFor, titleFor } from "@/lib/projects";

export const dynamic = "force-dynamic";

const MIN_SITE_IDEA = 15;

/** Creates a project (from the idea, if there is one) and opens it. */
export default async function New({ searchParams }: { searchParams: Promise<{ idea?: string; kind?: string; pack?: string }> }) {
  const { idea: raw, kind: rawKind, pack: rawPack } = await searchParams;
  const kind = rawKind === "site" ? "site" : "store";
  // The product showcase pack is behind a switch until it has been tested; without it, ?pack=showcase is ignored.
  // ?pack=product-showcase and the old ?pack=saas open the same pack. ENABLE_SAAS_PACK is the old name of the switch.
  const switchOn = process.env.ENABLE_SHOWCASE_PACK === "1" || process.env.ENABLE_SAAS_PACK === "1";
  // The local business (restaurant) pack has its own switch. Without ENABLE_LOCAL_PACK=1, ?pack=local is ignored too.
  const localOn = process.env.ENABLE_LOCAL_PACK === "1";
  const asked = normalizePack(rawPack);
  const pack: "waitlist" | "showcase" | "local" = kind !== "site" ? "waitlist" : asked === "showcase" && switchOn ? "showcase" : asked === "local" && localOn ? "local" : "waitlist";
  const trimmed = (raw ?? "").trim().slice(0, 1000);
  // A website idea shorter than this is not enough to start from: Scout opens with its usual first question instead.
  const idea = kind === "site" && trimmed.length < MIN_SITE_IDEA ? "" : trimmed;
  const user = await getUser();
  if (!user) redirect(`/signin?${new URLSearchParams({ ...(idea ? { idea } : {}), ...(kind === "site" ? { kind } : {}), ...(pack !== "waitlist" ? { pack } : {}) })}`);

  // A refresh or a double click on "Let's go" reopens the project just made from this idea, not a second one.
  if (idea) {
    const [recent] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.ownerId, user.id), eq(schema.projects.kind, kind), eq(schema.projects.idea, idea), gt(schema.projects.createdAt, new Date(Date.now() - 2 * 60_000))))
      .orderBy(desc(schema.projects.createdAt))
      .limit(1);
    if (recent) redirect(`/projects/${recent.id}`);
  }

  let state = kind === "site" ? siteStart(pack) : initialState(idea || undefined);
  let usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number } | undefined;
  if (kind === "site" && idea) {
    // The idea from the home page is the first answer.
    const ai = getSiteInterviewer();
    if (ai) {
      const r = await ai.turn(state, idea, { userEmail: user.email ?? undefined });
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

function siteStart(pack: "waitlist" | "showcase" | "local") {
  const s = initialState();
  return { ...pushMsg({ ...s, msgs: [], nextId: 1, phase: "intake" as const, sitePack: pack }, { kind: "bot", text: pack === "showcase" ? SHOWCASE_OPENER : pack === "local" ? LOCAL_OPENER : SITE_OPENER }) };
}
