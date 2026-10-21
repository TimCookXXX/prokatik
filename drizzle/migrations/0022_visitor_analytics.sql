CREATE TABLE IF NOT EXISTS "visitor_events" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" uuid NOT NULL,
	"user_id" text,
	"type" varchar(30) NOT NULL,
	"path" varchar(300),
	"listing_id" text,
	"q" varchar(100),
	"total" integer,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visitors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text,
	"first_source" jsonb,
	"device" varchar(10),
	"ym_client_id" varchar(32),
	"is_bot" boolean DEFAULT false NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visitor_events" ADD CONSTRAINT "visitor_events_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visitor_events" ADD CONSTRAINT "visitor_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visitor_events" ADD CONSTRAINT "visitor_events_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visitors" ADD CONSTRAINT "visitors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitor_events_visitor_idx" ON "visitor_events" USING btree ("visitor_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitor_events_type_idx" ON "visitor_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitor_events_listing_idx" ON "visitor_events" USING btree ("listing_id","created_at") WHERE "visitor_events"."listing_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitor_events_created_idx" ON "visitor_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitor_events_ym_client_idx" ON "visitor_events" USING btree (("props"->>'cid')) WHERE "visitor_events"."type" = 'ym_client';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitor_events_user_idx" ON "visitor_events" USING btree ("user_id","created_at") WHERE "visitor_events"."user_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitors_last_seen_idx" ON "visitors" USING btree ("last_seen_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitors_user_idx" ON "visitors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitors_ym_client_idx" ON "visitors" USING btree ("ym_client_id") WHERE "visitors"."ym_client_id" is not null;