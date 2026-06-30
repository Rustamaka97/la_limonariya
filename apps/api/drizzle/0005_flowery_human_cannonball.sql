CREATE TYPE "public"."carcass_type" AS ENUM('qoy', 'mol');--> statement-breakpoint
CREATE TABLE "obvalka" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carcass_type" "carcass_type" NOT NULL,
	"weight_g" integer NOT NULL,
	"price_per_kg" integer DEFAULT 0 NOT NULL,
	"supplier" text,
	"note" text,
	"branch_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obvalka_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"obvalka_id" uuid NOT NULL,
	"part_type_id" uuid,
	"name" text NOT NULL,
	"weight_g" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carcass_type" "carcass_type" NOT NULL,
	"name" text NOT NULL,
	"norm_min_pct" integer,
	"norm_max_pct" integer,
	"is_waste" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "part_types_carcass_type_name_unique" UNIQUE("carcass_type","name")
);
--> statement-breakpoint
ALTER TABLE "obvalka" ADD CONSTRAINT "obvalka_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obvalka" ADD CONSTRAINT "obvalka_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obvalka_parts" ADD CONSTRAINT "obvalka_parts_obvalka_id_obvalka_id_fk" FOREIGN KEY ("obvalka_id") REFERENCES "public"."obvalka"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obvalka_parts" ADD CONSTRAINT "obvalka_parts_part_type_id_part_types_id_fk" FOREIGN KEY ("part_type_id") REFERENCES "public"."part_types"("id") ON DELETE no action ON UPDATE no action;