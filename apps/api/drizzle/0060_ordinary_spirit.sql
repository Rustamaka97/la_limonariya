CREATE TABLE "table_preps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_key" text NOT NULL,
	"hall_id" uuid,
	"items" jsonb NOT NULL,
	"photo_url" text,
	"note" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "table_preps_day_key_hall_id_unique" UNIQUE("day_key","hall_id")
);
--> statement-breakpoint
ALTER TABLE "table_preps" ADD CONSTRAINT "table_preps_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_preps" ADD CONSTRAINT "table_preps_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;