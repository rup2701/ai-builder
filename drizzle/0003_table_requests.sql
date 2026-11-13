CREATE TABLE "table_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"guest_name" text NOT NULL,
	"phone" text,
	"email" text,
	"day" text NOT NULL,
	"time" text NOT NULL,
	"party_size" integer NOT NULL,
	"note" text,
	"status" text DEFAULT 'new' NOT NULL,
	"emailed" boolean DEFAULT false NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "table_requests" ADD CONSTRAINT "table_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "table_requests_project_idx" ON "table_requests" USING btree ("project_id","created_at");