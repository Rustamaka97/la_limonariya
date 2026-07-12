CREATE TYPE "public"."wallet_kind" AS ENUM('cashback', 'bonus', 'redeem', 'adjust');--> statement-breakpoint
CREATE TABLE "customer_wallet_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"kind" "wallet_kind" NOT NULL,
	"order_id" uuid,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_wallet_movements" ADD CONSTRAINT "customer_wallet_movements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_wallet_movements" ADD CONSTRAINT "customer_wallet_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_wallet_movements" ADD CONSTRAINT "customer_wallet_movements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cwm_customer_idx" ON "customer_wallet_movements" USING btree ("customer_id");