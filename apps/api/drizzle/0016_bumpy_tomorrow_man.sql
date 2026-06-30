ALTER TABLE "orders" ADD COLUMN "is_comp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "comp_reason" text;