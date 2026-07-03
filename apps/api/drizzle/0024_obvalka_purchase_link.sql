ALTER TABLE "obvalka" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "obvalka" ADD COLUMN "short_reason" text;--> statement-breakpoint
ALTER TABLE "obvalka" ADD CONSTRAINT "obvalka_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;