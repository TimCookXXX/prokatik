CREATE TABLE IF NOT EXISTS "geo_houses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "geo_houses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"region" varchar(40) NOT NULL,
	"street_id" text,
	"place_id" text,
	"number" varchar(40) NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"precision" varchar(12) NOT NULL,
	"source" varchar(10) NOT NULL,
	"postcode" varchar(6)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"region" varchar(40) NOT NULL,
	"version" varchar(64) NOT NULL,
	"built_at" timestamp with time zone NOT NULL,
	"counts" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_places" (
	"id" text NOT NULL,
	"region" varchar(40) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"name" varchar(160) NOT NULL,
	"aliases" text[] NOT NULL,
	"parent_id" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	CONSTRAINT "geo_places_region_id_pk" PRIMARY KEY("region","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_pois" (
	"id" text NOT NULL,
	"region" varchar(40) NOT NULL,
	"name" varchar(200) NOT NULL,
	"kind" varchar(30) NOT NULL,
	"aliases" text[] NOT NULL,
	"place_id" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"address" varchar(200),
	CONSTRAINT "geo_pois_region_id_pk" PRIMARY KEY("region","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_streets" (
	"id" text NOT NULL,
	"region" varchar(40) NOT NULL,
	"place_id" text,
	"name" varchar(200) NOT NULL,
	"type" varchar(30) NOT NULL,
	"aliases" text[] NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"houses" integer NOT NULL,
	"line" jsonb,
	CONSTRAINT "geo_streets_region_id_pk" PRIMARY KEY("region","id")
);
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "geo_region" varchar(40);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_houses_region_idx" ON "geo_houses" USING btree ("region","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_imports_region_idx" ON "geo_imports" USING btree ("region","id");