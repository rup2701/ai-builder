import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import AppShell from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PROGRESS_STEPS, siteProgress } from "@/lib/builder/project-progress";
import type { WorkspaceState } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";

/** The label on a project row: where a website stands, or the status of a store. */
function stateLabel(p: typeof schema.projects.$inferSelect): { text: string; warn: boolean } {
  if (p.kind !== "site") return { text: p.status, warn: false };
  const pr = siteProgress(p.state as WorkspaceState);
  if (pr.live) return { text: "Live", warn: false };
  return { text: pr.failed ? `${PROGRESS_STEPS[pr.active]}: needs attention` : PROGRESS_STEPS[pr.active], warn: pr.failed };
}

export default async function Projects() {
  const user = await getUser();
  if (!user) redirect("/signin");
  const rows = await db.select().from(schema.projects).where(eq(schema.projects.ownerId, user.id)).orderBy(desc(schema.projects.updatedAt));

  return (
    <AppShell active="projects" email={user.email ?? null}>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-4xl">Projects</h1>
          <Link
            href="/"
            className="rounded-xl bg-foreground px-4 py-2 text-sm text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            New project
          </Link>
        </div>

        {rows.length === 0 ? (
          <p className="mt-10 text-foreground/70">
            Nothing here yet. <Link href="/" className="underline underline-offset-4">Start a project</Link> and describe what you want to launch.
          </p>
        ) : (
          <ul className="mt-8 space-y-3" aria-label="Projects">
            {rows.map((p) => {
              const s = stateLabel(p);
              return (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="block rounded-3xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    <Card className="transition-colors hover:border-foreground/30">
                      <CardContent className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="truncate text-base">{p.title}</p>
                          <p className="mt-0.5 text-xs text-foreground/55">
                            {p.kind === "site" ? "Website · " : "Store · "}Updated {p.updatedAt.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {p.isSample && <Badge variant="outline">Sample</Badge>}
                          <Badge variant={s.warn ? "outline" : undefined} className={s.warn ? "border-destructive/40 text-destructive" : undefined}>
                            {s.text}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
