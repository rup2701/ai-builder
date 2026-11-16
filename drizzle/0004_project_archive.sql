ALTER TABLE "projects" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- Two projects can already share a site address (the old and the new CurryLeaf). The unique index below would refuse that,
-- so first: at each shared address, the older projects are archived, but only when the newest one has the live files.
-- "Live files" means the most recent successful deploy at that address: its first build, a publish retry, or a published
-- change. If the newest project there does not have them (an older project published last, or nobody has a deploy on
-- record), the migration stops with an error naming the address. Drizzle runs a migration in one transaction, so nothing
-- is changed, not even the new column. Decide that address by hand, then run the migration again.
-- A project with no address (never deployed) is not part of any shared address and is never archived here.
-- The read-only dry run in scripts/app-29-archive-dry-run.sql uses the same rule. Keep the two the same.
CREATE TEMP VIEW "app29_shared" AS
WITH a AS (
  SELECT "id", "created_at", "state",
         substring(lower("state" #>> '{site,build,url}') from '^https?://([^/:?#]+)') AS address
    FROM "projects"
),
shared AS (
  SELECT address FROM a WHERE address IS NOT NULL GROUP BY address HAVING count(*) > 1
),
p AS (
  SELECT a.address, a."id", a."created_at",
         greatest(
           CASE WHEN a."state" #>> '{site,build,finishedAt}' ~ '^\d{4}-\d\d-\d\dT' THEN (a."state" #>> '{site,build,finishedAt}')::timestamptz END,
           (SELECT max(j."finished_at") FROM "jobs" j
             WHERE j."project_id" = a."id" AND j."status" = 'done' AND j."type" = 'site_publish'),
           (SELECT max(j."finished_at") FROM "jobs" j
             WHERE j."project_id" = a."id" AND j."status" = 'done' AND j."type" = 'site_change'
               AND j."id"::text IN (SELECT m->>'jobId' FROM jsonb_array_elements(COALESCE(a."state"->'msgs', '[]'::jsonb)) AS m
                                     WHERE m->>'kind' = 'site_change' AND m->>'published' = 'true'))
         ) AS last_deploy
    FROM a JOIN shared USING (address)
),
q AS (
  SELECT p.*,
         row_number() OVER (PARTITION BY address ORDER BY "created_at" DESC, "id" DESC) AS age_rank,
         max(last_deploy) OVER (PARTITION BY address) AS top_deploy
    FROM p
),
r AS (
  SELECT q.*, count(*) FILTER (WHERE last_deploy = top_deploy) OVER (PARTITION BY address) AS top_count FROM q
)
SELECT address, "id", "created_at", last_deploy,
       age_rank = 1 AS is_newest,
       -- The newest project has the live files: it alone has the most recent deploy at the address.
       bool_or(age_rank = 1 AND last_deploy IS NOT NULL AND last_deploy = top_deploy AND top_count = 1) OVER (PARTITION BY address) AS newest_is_live
  FROM r;--> statement-breakpoint
DO $$
DECLARE
  stop_at text;
BEGIN
  SELECT address INTO stop_at FROM app29_shared WHERE NOT newest_is_live ORDER BY address LIMIT 1;
  IF stop_at IS NOT NULL THEN
    RAISE EXCEPTION 'APP-29 migration stopped, nothing was changed: at % the newest project does not have the live files. Run scripts/app-29-archive-dry-run.sql, decide that address by hand, then migrate again.', stop_at;
  END IF;
END $$;--> statement-breakpoint
UPDATE "projects" SET "archived_at" = now() WHERE "id" IN (SELECT "id" FROM app29_shared WHERE NOT is_newest);--> statement-breakpoint
DROP VIEW app29_shared;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_active_address_uq" ON "projects" USING btree (substring(lower("state" #>> '{site,build,url}') from '^https?://([^/:?#]+)')) WHERE "projects"."archived_at" IS NULL;
