"use server";

import { redirect } from "next/navigation";
import { pool } from "@/db";
import { getUser } from "@/lib/session";
import { archiveProject, restoreProject } from "@/lib/project-archive";
import { noteOnBuildRecords } from "@/lib/build-records";

/**
 * Archive and Restore (APP-29). Owner only: both helpers match the project on its owner, so a post for someone else's
 * project changes nothing. The page shows the result from a short notice code, never from text in the address.
 */
const projectId = (f: FormData) => {
  const id = String(f.get("id") ?? "");
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
};

export async function archiveAction(formData: FormData) {
  const user = await getUser();
  if (!user) redirect("/signin");
  const id = projectId(formData);
  const r = id ? await archiveProject(pool, id, user.id) : ({ ok: false, reason: "not_found" } as const);
  // Learning data (APP-15): a raw fact for working out later whether the site was kept. Never fails the archive.
  if (r.ok && id) await noteOnBuildRecords(pool, id, "archived");
  redirect(r.ok ? "/projects?notice=archived" : `/projects?notice=${r.reason}${id ? `&project=${id}` : ""}`);
}

export async function restoreAction(formData: FormData) {
  const user = await getUser();
  if (!user) redirect("/signin");
  const id = projectId(formData);
  const r = id ? await restoreProject(pool, id, user.id) : ({ ok: false, reason: "not_found" } as const);
  if (r.ok && id) await noteOnBuildRecords(pool, id, "restored");
  // From the project page, a restored project opens again where the owner was.
  if (r.ok) redirect(formData.get("from") === "project" ? `/projects/${id}` : "/projects?notice=restored");
  redirect(`/projects?show=archived&notice=${r.reason}${id ? `&project=${id}` : ""}`);
}
