CREATE TABLE "marinade_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carcass_type" "carcass_type" NOT NULL,
	"raw_g" integer NOT NULL,
	"growth_pct" integer NOT NULL,
	"marinated_g" integer NOT NULL,
	"note" text,
	"branch_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gram_norm" integer;--> statement-breakpoint
ALTER TABLE "marinade_batches" ADD CONSTRAINT "marinade_batches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marinade_batches" ADD CONSTRAINT "marinade_batches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;