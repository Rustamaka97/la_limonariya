ALTER TABLE "tables" ADD COLUMN "held_by_id" uuid;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "held_note" text;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_held_by_id_users_id_fk" FOREIGN KEY ("held_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;