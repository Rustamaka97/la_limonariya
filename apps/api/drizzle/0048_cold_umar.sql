CREATE TYPE "public"."reservation_status" AS ENUM('active', 'seated', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE IF NOT EXISTS 'avans';--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"guests" integer,
	"reserved_for" timestamp with time zone NOT NULL,
	"note" text,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"deposit_amount" integer DEFAULT 0 NOT NULL,
	"deposit_method" "payment_method",
	"deposit_applied_at" timestamp with time zone,
	"deposit_resolution" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"order_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "res_table_time_idx" ON "reservations" USING btree ("table_id","reserved_for");--> statement-breakpoint
CREATE INDEX "res_status_idx" ON "reservations" USING btree ("status","reserved_for");