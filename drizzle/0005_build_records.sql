CREATE TABLE "build_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pack" text NOT NULL,
	"outcome" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "build_records_project_idx" ON "build_records" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "build_records_created_idx" ON "build_records" USING btree ("created_at");