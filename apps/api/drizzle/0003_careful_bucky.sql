CREATE TYPE "public"."product_type" AS ENUM('ingredient', 'part', 'semi', 'dish', 'goods');--> statement-breakpoint
CREATE TYPE "public"."product_unit" AS ENUM('dona', 'kg', 'g', 'l', 'ml');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clopos_id" integer,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "categories_clopos_id_unique" UNIQUE("clopos_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clopos_id" integer,
	"name" text NOT NULL,
	"type" "product_type" NOT NULL,
	"unit" "product_unit" NOT NULL,
	"category_id" uuid,
	"station_id" uuid,
	"price" integer DEFAULT 0 NOT NULL,
	"cost_price" integer,
	"sold_by_weight" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"branch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_clopos_id_unique" UNIQUE("clopos_id")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clopos_id" integer,
	"name" text NOT NULL,
	"printable" boolean DEFAULT true NOT NULL,
	CONSTRAINT "stations_clopos_id_unique" UNIQUE("clopos_id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;