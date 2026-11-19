import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import { addressOf, shortDate } from "@/lib/project-archive";
import BuilderWorkspace from "@/components/builder/BuilderWorkspace";
import type { WorkspaceState } from "@/lib/workspace/types";
import { restoreAction } from "../actions";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) redirect("/signin");
  const project = await loadOwned(id, user.id);
  if (!project) notFound();
  const address = addressOf(project.state);
  return (
    <>
      <BuilderWorkspace projectId={project.id} initial={project.state as WorkspaceState} homeHref="/projects" title={project.title} kind={project.kind === "site" ? "site" : "store"} admin={isAdmin(user)} />
      {project.archivedAt && (
        // Read-only: this bar sits over the chat box. The server refuses changes on its own; this says why and offers Restore.
        <div role="region" aria-label="Archived project" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background px-4 py-4 shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-foreground/88">
              <strong className="font-medium text-foreground">This project is archived</strong> (since {shortDate(project.archivedAt)}). It is read-only.
              {address ? ` Its site at ${address} keeps running.` : ""}
            </p>
            <form action={restoreAction}>
              <input type="hidden" name="id" value={project.id} />
              <input type="hidden" name="from" value="project" />
              <button type="submit" className="rounded-xl bg-foreground px-4 py-2 text-sm text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
                Restore
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
