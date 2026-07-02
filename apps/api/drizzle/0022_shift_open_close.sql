ALTER TABLE "till_counts" ALTER COLUMN "counted_cash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "till_counts" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "till_counts" ADD COLUMN "opened_by_id" uuid;--> statement-breakpoint
ALTER TABLE "till_counts" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "till_counts" ADD CONSTRAINT "till_counts_opened_by_id_users_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;