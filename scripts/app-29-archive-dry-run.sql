-- APP-29 dry run for migration drizzle/0004_project_archive.sql. READ ONLY: the transaction is read-only and rolled back.
-- Run it on production before the migration:  psql "<connection>" -f scripts/app-29-archive-dry-run.sql
-- It prints one of two things:
--   "would archive": each project the migration would archive (the older ones at a shared address whose newest project
--     has the live files). A single "would archive nothing" row means there is no shared address.
--   "would stop the migration": each shared address where the newest project does not have the live files. While any
--     such row exists the migration changes nothing at all; it stops at the first of these addresses.
-- The rule is the same as the app29_shared view in the migration. Keep the two the same.
BEGIN TRANSACTION READ ONLY;

WITH a AS (
  SELECT "id", "title", "created_at", "state",
         substring(lower("state" #>> '{site,build,url}') from '^https?://([^/:?#]+)') AS address
    FROM "projects"
),
shared AS (
  SELECT address FROM a WHERE address IS NOT NULL GROUP BY address HAVING count(*) > 1
),
p AS (
  SELECT a.address, a."id", a."title", a."created_at",
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
),
v AS (
  SELECT r.*,
         bool_or(age_rank = 1 AND last_deploy IS NOT NULL AND last_deploy = top_deploy AND top_count = 1) OVER (PARTITION BY address) AS newest_is_live
    FROM r
),
stops AS (
  SELECT DISTINCT address FROM v WHERE NOT newest_is_live
)
SELECT 'would stop the migration' AS outcome, address, NULL::uuid AS id, NULL::text AS title, NULL::date AS created
  FROM stops
UNION ALL
SELECT 'would archive', address, "id", "title", "created_at"::date
  FROM v
 WHERE age_rank > 1 AND NOT EXISTS (SELECT 1 FROM stops)
UNION ALL
SELECT 'would archive nothing', NULL, NULL, NULL, NULL
 WHERE NOT EXISTS (SELECT 1 FROM v)
 ORDER BY 1 DESC, 2, 5;

ROLLBACK;
