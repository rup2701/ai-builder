import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, pool, schema } from "@/db";
import { getUser } from "@/lib/session";
import AppShell from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PROGRESS_STEPS, siteProgress } from "@/lib/builder/project-progress";
import { addressClaim, addressOf, addressTakenText, archiveResultText, shortDate } from "@/lib/project-archive";
import type { WorkspaceState } from "@/lib/workspace/types";
import { archiveAction, restoreAction } from "./actions";

export const dynamic = "force-dynamic";

type Row = typeof schema.projects.$inferSelect;

/** The label on a project row: where a website stands, or the status of a store. */
function stateLabel(p: Row): { text: string; warn: boolean } {
  if (p.kind !== "site") return { text: p.status, warn: false };
  const pr = siteProgress(p.state as WorkspaceState);
  if (pr.live) return { text: "Live", warn: false };
  return { text: pr.failed ? `${PROGRESS_STEPS[pr.active]}: needs attention` : PROGRESS_STEPS[pr.active], warn: pr.failed };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The line at the top after Archive or Restore. Built from a code and the owner's own rows, never from text in the address. */
async function noticeText(notice: string, projectId: string, rows: Row[]): Promise<{ text: string; warn: boolean } | null> {
  if (notice === "archived") return { text: "Archived. It is read-only now, and its site keeps running. You can find it under Archived.", warn: false };
  if (notice === "restored") return { text: "Restored. You can change it again.", warn: false };
  if (notice === "busy" || notice === "not_found") return { text: archiveResultText({ ok: false, reason: notice }), warn: true };
  if (notice === "taken") {
    const p = rows.find((r) => r.id === projectId);
    const address = p ? addressOf(p.state) : null;
    if (!p || !address) return null;
    return { text: `Not restored. ${addressTakenText(address, await addressClaim(pool, address, p.id))}`, warn: true };
  }
  return null;
}

const button = "rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/85 transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export default async function Projects({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getUser();
  if (!user) redirect("/signin");
  const sp = await searchParams;
  const showArchived = one(sp.show) === "archived";
  const all = await db.select().from(schema.projects).where(eq(schema.projects.ownerId, user.id)).orderBy(desc(schema.projects.updatedAt));
  const archivedCount = all.filter((p) => p.archivedAt).length;
  const rows = all.filter((p) => Boolean(p.archivedAt) === showArchived);
  const notice = await noticeText(one(sp.notice), one(sp.project), all);

  return (
    <AppShell active="projects" email={user.email ?? null}>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-4xl">{showArchived ? "Archived projects" : "Projects"}</h1>
          <Link
            href="/"
            className="rounded-xl bg-foreground px-4 py-2 text-sm text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            New project
          </Link>
        </div>

        <nav aria-label="Show projects" className="mt-6 flex gap-2 text-sm">
          <Link href="/projects" aria-current={showArchived ? undefined : "page"} className={`rounded-full px-3 py-1 ${showArchived ? "text-foreground/75 hover:text-foreground" : "bg-foreground/[0.06] text-foreground"}`}>
            Active
          </Link>
          <Link href="/projects?show=archived" aria-current={showArchived ? "page" : undefined} className={`rounded-full px-3 py-1 ${showArchived ? "bg-foreground/[0.06] text-foreground" : "text-foreground/75 hover:text-foreground"}`}>
            Archived{archivedCount ? ` (${archivedCount})` : ""}
          </Link>
        </nav>

        {notice && (
          <p role="status" className={`mt-5 rounded-2xl px-4 py-3 text-sm ${notice.warn ? "bg-destructive/[0.07] text-destructive" : "bg-foreground/[0.05] text-foreground/88"}`}>
            {notice.text}
          </p>
        )}

        {showArchived && rows.length > 0 && (
          <p className="mt-5 text-sm text-foreground/75">
            Archived projects are read-only. Their sites keep running and keep their address. Restore one to change it again.
          </p>
        )}

        {rows.length === 0 ? (
          <p className="mt-10 text-foreground/80">
            {showArchived ? (
              "No archived projects."
            ) : (
              <>
                Nothing here yet. <Link href="/" className="underline underline-offset-4">Start a project</Link> and describe what you want to launch.
              </>
            )}
          </p>
        ) : (
          <ul className="mt-6 space-y-3" aria-label={showArchived ? "Archived projects" : "Projects"}>
            {rows.map((p) => {
              const s = stateLabel(p);
              const address = addressOf(p.state);
              return (
                <li key={p.id}>
                  <Card className="transition-colors hover:border-foreground/30">
                    <CardContent className="flex items-center justify-between gap-4">
                      <Link href={`/projects/${p.id}`} className="min-w-0 flex-1 rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                        <p className="truncate text-base font-semibold">{p.title}</p>
                        {/* Two projects can share a name: the address and the date tell them apart. */}
                        <p className="mt-0.5 truncate text-xs text-foreground/65">
                          {p.kind === "site" ? "Website" : "Store"}
                          {address ? ` · ${address}` : ""} · Created {shortDate(p.createdAt)}
                        </p>
                      </Link>
                      <div className="flex shrink-0 items-center gap-2">
                        {p.isSample && <Badge variant="outline">Sample</Badge>}
                        {p.archivedAt ? (
                          <Badge variant="outline">Archived</Badge>
                        ) : (
                          <Badge variant={s.warn ? "outline" : undefined} className={s.warn ? "border-destructive/40 text-destructive" : undefined}>
                            {s.text}
                          </Badge>
                        )}
                        <form action={p.archivedAt ? restoreAction : archiveAction}>
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" className={button} aria-label={`${p.archivedAt ? "Restore" : "Archive"} ${p.title}${address ? `, ${address}` : ""}`}>
                            {p.archivedAt ? "Restore" : "Archive"}
                          </button>
                        </form>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
