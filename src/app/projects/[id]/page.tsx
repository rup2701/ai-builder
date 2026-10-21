import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import BuilderWorkspace from "@/components/builder/BuilderWorkspace";
import type { WorkspaceState } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) redirect("/signin");
  const project = await loadOwned(id, user.id);
  if (!project) notFound();
  return <BuilderWorkspace projectId={project.id} initial={project.state as WorkspaceState} homeHref="/projects" />;
}
