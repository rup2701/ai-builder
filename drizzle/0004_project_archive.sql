ALTER TABLE "projects" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- Two active projects can already share a site address (the old and the new CurryLeaf). The unique index below would refuse
-- that, so for each shared address the older projects are archived first and the newest one stays active. Archiving keeps
-- everything and can be undone with Restore.
UPDATE "projects" AS p SET "archived_at" = now()
  FROM (
    SELECT "id", row_number() OVER (
             PARTITION BY substring(lower("state" #>> '{site,build,url}') from '^https?://([^/:?#]+)')
             ORDER BY "created_at" DESC, "id" DESC
           ) AS n
      FROM "projects"
     WHERE substring(lower("state" #>> '{site,build,url}') from '^https?://([^/:?#]+)') IS NOT NULL
  ) AS d
 WHERE p."id" = d."id" AND d.n > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_active_address_uq" ON "projects" USING btree (substring(lower("state" #>> '{site,build,url}') from '^https?://([^/:?#]+)')) WHERE "projects"."archived_at" IS NULL;
