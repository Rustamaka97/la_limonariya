CREATE TABLE "norm_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_type_id" uuid,
	"old_min_pct" integer,
	"old_max_pct" integer,
	"new_min_pct" integer,
	"new_max_pct" integer,
	"source" text NOT NULL,
	"changed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "norm_changes" ADD CONSTRAINT "norm_changes_part_type_id_part_types_id_fk" FOREIGN KEY ("part_type_id") REFERENCES "public"."part_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "norm_changes" ADD CONSTRAINT "norm_changes_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nc_created_idx" ON "norm_changes" USING btree ("created_at");