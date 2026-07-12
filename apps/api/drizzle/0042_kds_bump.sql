ALTER TABLE "kitchen_tickets" ADD COLUMN "bumped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD COLUMN "bumped_by_id" uuid;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_bumped_by_id_users_id_fk" FOREIGN KEY ("bumped_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;