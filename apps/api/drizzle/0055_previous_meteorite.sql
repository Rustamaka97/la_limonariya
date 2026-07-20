CREATE TABLE IF NOT EXISTS "modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price_delta" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_item_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_delta" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oim_item_idx" ON "order_item_modifiers" USING btree ("order_item_id");--> statement-breakpoint
-- Оддий модификаторлар seed (жадвал бўш бўлса) — директор кейин қўшади/ўзгартиради
INSERT INTO "modifiers" ("name", "price_delta", "sort")
SELECT v.name, v.pd, v.s FROM (VALUES
  ('Пиёзсиз', 0, 1), ('Аччиқ эмас', 0, 2), ('Аччиқ қилинг', 0, 3),
  ('Соус алоҳида', 0, 4), ('Яхши пишган', 0, 5), ('Кам пишган', 0, 6),
  ('Музсиз', 0, 7), ('Қўшимча сир', 5000, 8), ('Қўшимча гўшт', 15000, 9)
) AS v(name, pd, s)
WHERE NOT EXISTS (SELECT 1 FROM "modifiers");