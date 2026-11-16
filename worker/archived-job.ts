/**
 * The worker's check before it runs a job: a project that was archived after the job was queued does not run it.
 * The web routes already refuse new work for an archived project; this covers a job that was waiting when the owner archived it.
 * The job fails with a plain message, and the chat is put back so nothing looks stuck.
 */
import { ARCHIVED_JOB_ERROR, isArchived, type Db } from "../src/lib/project-archive";
import { pushMsg } from "../src/lib/workspace/state";
import type { WorkspaceState } from "../src/lib/workspace/types";
import { adminFailed } from "./site-build";
import { failSiteChangeMsg } from "./site-change";

export type ClaimedJob = { id: string; project_id: string; type: string };

/** A build or a publish retry was waiting: leave the build screen, keep what was built, and say why in the chat. */
async function releaseBuild(db: Db, job: ClaimedJob) {
  const { rows } = await db.query(`SELECT state FROM projects WHERE id = $1`, [job.project_id]);
  const s = rows[0]?.state as WorkspaceState | undefined;
  if (!s) return;
  const b = s.site?.build;
  const next: WorkspaceState = {
    ...pushMsg(s, { kind: "bot", text: ARCHIVED_JOB_ERROR }),
    phase: "summary",
    jobId: null,
    buildStep: 0,
    // The failed stage keeps the right button for later: a publish retry stays a publish retry after Restore.
    ...(s.site && b ? { site: { ...s.site, build: { ...b, failedStage: b.stage, error: ARCHIVED_JOB_ERROR } } } : {}),
  };
  await db.query(
    `UPDATE projects SET state = $2, status = CASE WHEN kind = 'site' THEN 'ready' ELSE 'draft' END, updated_at = now() WHERE id = $1`,
    [job.project_id, JSON.stringify(next)],
  );
}

/** True when the project is archived: the job was refused and marked failed, so the caller must not run it. */
export async function refuseIfArchived(db: Db, job: ClaimedJob): Promise<boolean> {
  if (!(await isArchived(db, job.project_id))) return false;
  if (job.type === "site_change") await failSiteChangeMsg(db, job, ARCHIVED_JOB_ERROR);
  else if (job.type === "site_admin") await adminFailed(db, job.project_id, "the project was archived before it could run");
  else await releaseBuild(db, job).catch(() => {});
  await db.query(`UPDATE jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [job.id, ARCHIVED_JOB_ERROR]);
  return true;
}
