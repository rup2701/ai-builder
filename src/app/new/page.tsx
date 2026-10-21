import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { initialState } from "@/lib/workspace/state";
import { statusFor, titleFor } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** Creates a project (from the idea, if there is one) and opens it. */
export default async function New({ searchParams }: { searchParams: Promise<{ idea?: string }> }) {
  const { idea: raw } = await searchParams;
  const idea = (raw ?? "").trim().slice(0, 1000);
  const user = await getUser();
  if (!user) redirect(`/signin${idea ? `?idea=${encodeURIComponent(idea)}` : ""}`);

  const state = initialState(idea || undefined);
  const [row] = await db
    .insert(schema.projects)
    .values({ ownerId: user.id, idea, title: titleFor(state, idea), status: statusFor(state), state })
    .returning({ id: schema.projects.id });
  redirect(`/projects/${row.id}`);
}
