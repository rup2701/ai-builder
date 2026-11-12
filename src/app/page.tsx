import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import AppShell from "@/components/app/AppShell";
import { packParam } from "@/lib/builder/site-brief";
import NewProject from "@/components/app/NewProject";
import { PROGRESS_STEPS, siteProgress } from "@/lib/builder/project-progress";
import type { WorkspaceState } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";

/**
 * Home: the prompt and starter cards. The Appnomics site links here as /?kind=site&idea=…, and that still goes
 * straight to /new (or to sign-in first) with the idea kept.
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ idea?: string; kind?: string; pack?: string }> }) {
  const { idea, kind, pack } = await searchParams;
  const params = new URLSearchParams({ ...(idea?.trim() ? { idea: idea.trim().slice(0, 1000) } : {}), ...(kind === "site" ? { kind } : {}), ...(kind === "site" && packParam(pack) ? { pack: packParam(pack) as string } : {}) }).toString();
  const user = await getUser();
  if (params) redirect(user ? `/new?${params}` : `/signin?${params}`);
  if (!user) redirect("/signin");

  // A site that is being built right now, so a person who left the tab can get back to it in one click.
  const [building] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.ownerId, user.id), eq(schema.projects.kind, "site"), eq(schema.projects.status, "building")))
    .orderBy(desc(schema.projects.updatedAt))
    .limit(1);
  const step = building ? PROGRESS_STEPS[siteProgress(building.state as WorkspaceState).active] : null;

  return (
    <AppShell active="home" email={user.email ?? null}>
      {building && (
        <div className="mx-auto mt-6 w-full max-w-3xl px-4">
          <Link
            href={`/projects/${building.id}`}
            className="flex items-center justify-between gap-3 rounded-2xl border border-foreground/10 bg-white px-4 py-3 text-sm transition-colors hover:border-foreground/30"
          >
            <span className="min-w-0 truncate">
              <span className="font-medium">{building.title}</span> is building · {step}
            </span>
            <span className="shrink-0 text-foreground/60">Open →</span>
          </Link>
        </div>
      )}
      <NewProject />
    </AppShell>
  );
}
