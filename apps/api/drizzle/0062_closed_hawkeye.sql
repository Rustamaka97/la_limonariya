CREATE TABLE IF NOT EXISTS "device_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"user_name" text,
	"role" text,
	"kind" text DEFAULT 'browser' NOT NULL,
	"platform" text,
	"ip" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_heartbeats" ADD CONSTRAINT "device_heartbeats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
