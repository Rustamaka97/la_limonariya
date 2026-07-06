CREATE TABLE "skewer_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"meat_g" integer NOT NULL,
	"skewer_count" integer NOT NULL,
	"norm_g" integer,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vitrina_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_key" text NOT NULL,
	"product_id" uuid NOT NULL,
	"counted_qty" integer NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vitrina_counts_day_key_product_id_unique" UNIQUE("day_key","product_id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "shelf_life_days" integer;--> statement-breakpoint
ALTER TABLE "skewer_batches" ADD CONSTRAINT "skewer_batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skewer_batches" ADD CONSTRAINT "skewer_batches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vitrina_counts" ADD CONSTRAINT "vitrina_counts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vitrina_counts" ADD CONSTRAINT "vitrina_counts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sb_created_idx" ON "skewer_batches" USING btree ("created_at");