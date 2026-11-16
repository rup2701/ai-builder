/**
 * Archived projects (APP-29, level 1). An archived project is frozen in Builder: Scout cannot change it, and it cannot
 * build, change, publish or redeploy, so it can never overwrite a live site again. Its history stays, and it can be restored.
 * Its site keeps running and its address stays claimed; only taking the site down (not built yet) frees the address.
 *
 * One active project per site address: the database refuses a second project that is not archived with the same address
 * (the unique index projects_active_address_uq, on the host of state.site.build.url). This file reads the address the same way.
 *
 * No "server-only" here: the web routes, the worker and the tests all use it, each with its own pg pool or stand-in.
 */

/** The part of pg's Pool this file uses, so tests can pass a stand-in. */
export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** The SQL for a project's site address: the lowercase host of state.site.build.url. Must match the unique index in schema.ts. */
export const ADDRESS_SQL = `substring(lower(state #>> '{site,build,url}') from '^https?://([^/:?#]+)')`;
export const ADDRESS_INDEX = "projects_active_address_uq";

/** What an owner sees when they try to change an archived project. */
export const ARCHIVED_ERROR = "This project is archived, so it is read-only. Restore it from Projects to make changes.";
/** What an owner sees when a job was waiting when the project was archived. */
export const ARCHIVED_JOB_ERROR = "This project was archived before this could run, so nothing was changed. Restore it from Projects to try again.";

/** The site address of a project, as the unique index reads it: "curryleaf.appnomics.live". Null before the first deploy. */
export function siteAddress(url: unknown): string | null {
  if (typeof url !== "string") return null;
  return /^https?:\/\/([^/:?#]+)/.exec(url.trim().toLowerCase())?.[1] ?? null;
}

/** The address a project claims, from its saved state. */
export const addressOf = (state: unknown): string | null =>
  siteAddress((state as { site?: { build?: { url?: unknown } } } | null)?.site?.build?.url);

/** True when Postgres refused a write because another active project has this address. */
export function isAddressTaken(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string } | null;
  return err?.code === "23505" && err.constraint === ADDRESS_INDEX;
}

export async function isArchived(db: Db, projectId: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT archived_at FROM projects WHERE id = $1`, [projectId]);
  return Boolean(rows[0]?.archived_at);
}

/**
 * Another project that uses an address. sameOwner: it is the same person's, so its name can be shown; another person's
 * project is never named. archived: it is archived, and its site is still online at that address.
 */
export type Claim = { id: string; title: string; createdAt: Date; sameOwner: boolean; archived: boolean };

/**
 * The project, other than this one, that already uses this address; an active one first.
 * includeArchived: an archived project's site keeps running, so it still claims its address until its site is taken down
 * (not built yet). Deploying a new name counts it; Restore and the unique index only count active projects.
 */
export async function addressClaim(db: Db, address: string, exceptProjectId: string, opts: { includeArchived?: boolean } = {}): Promise<Claim | null> {
  const { rows } = await db.query(
    `SELECT id, title, created_at, archived_at IS NOT NULL AS archived, owner_id = (SELECT owner_id FROM projects WHERE id = $2) AS same_owner
       FROM projects WHERE ${opts.includeArchived ? "" : "archived_at IS NULL AND "}id <> $2 AND ${ADDRESS_SQL} = $1
      ORDER BY archived_at NULLS FIRST LIMIT 1`,
    [address.toLowerCase(), exceptProjectId],
  );
  const r = rows[0];
  return r ? { id: String(r.id), title: String(r.title), createdAt: new Date(r.created_at), sameOwner: r.same_owner === true, archived: r.archived === true } : null;
}

export const shortDate = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "UTC", dateStyle: "medium" });

/** Plain words for an address that is in use. */
export function addressTakenText(address: string, claim?: Pick<Claim, "title" | "createdAt" | "sameOwner" | "archived"> | null): string {
  if (claim?.sameOwner && claim.archived) return `${address} is still used by your archived project "${claim.title}" (created ${shortDate(claim.createdAt)}). Its site is still online there, so this project gets a different address.`;
  if (claim?.sameOwner) return `${address} is already used by your project "${claim.title}" (created ${shortDate(claim.createdAt)}). Archive that project first, then try again.`;
  if (claim) return `${address} is already used by another project. Email us and we will sort it out.`;
  return `${address} is already used by another project. If it is yours, archive it first and try again; if not, email us.`;
}

export type ArchiveResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "busy" }
  | { ok: false; reason: "taken"; address: string; claim: Claim | null };

/** Plain words for a refused archive or restore. */
export function archiveResultText(r: Exclude<ArchiveResult, { ok: true }>): string {
  if (r.reason === "not_found") return "That project was not found.";
  if (r.reason === "busy") return "Something is running on this project right now. Wait for it to finish, then archive it.";
  return addressTakenText(r.address, r.claim);
}

/**
 * Archive: owner only. Refused while a job is running, because a deploy in progress would still publish.
 * A job that is only queued is allowed: the worker refuses it when its turn comes (see worker/archived-job.ts).
 * Archiving twice is fine.
 */
export async function archiveProject(db: Db, projectId: string, ownerId: string): Promise<ArchiveResult> {
  const { rows } = await db.query(
    `UPDATE projects SET archived_at = now(), updated_at = now()
      WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM jobs WHERE project_id = $1 AND status = 'running')
      RETURNING id`,
    [projectId, ownerId],
  );
  if (rows.length) return { ok: true };
  const { rows: found } = await db.query(`SELECT archived_at FROM projects WHERE id = $1 AND owner_id = $2`, [projectId, ownerId]);
  if (!found[0]) return { ok: false, reason: "not_found" };
  return found[0].archived_at ? { ok: true } : { ok: false, reason: "busy" };
}

/** Restore: owner only. Refused when another active project now uses this project's address. */
export async function restoreProject(db: Db, projectId: string, ownerId: string): Promise<ArchiveResult> {
  const { rows } = await db.query(`SELECT state, archived_at FROM projects WHERE id = $1 AND owner_id = $2`, [projectId, ownerId]);
  if (!rows[0]) return { ok: false, reason: "not_found" };
  if (!rows[0].archived_at) return { ok: true };
  const address = addressOf(rows[0].state);
  if (address) {
    const claim = await addressClaim(db, address, projectId);
    if (claim) return { ok: false, reason: "taken", address, claim };
  }
  try {
    await db.query(`UPDATE projects SET archived_at = NULL, updated_at = now() WHERE id = $1 AND owner_id = $2`, [projectId, ownerId]);
  } catch (e) {
    // Another project took the address between the check and the write: the database has the last word.
    if (address && isAddressTaken(e)) return { ok: false, reason: "taken", address, claim: null };
    throw e;
  }
  return { ok: true };
}
