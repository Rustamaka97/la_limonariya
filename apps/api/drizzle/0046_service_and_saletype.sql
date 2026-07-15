CREATE TYPE "public"."sale_type" AS ENUM('dine_in', 'delivery', 'takeaway');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "service_waived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "sale_type" "sale_type" DEFAULT 'dine_in' NOT NULL;