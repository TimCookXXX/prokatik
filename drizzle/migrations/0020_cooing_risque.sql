CREATE TYPE "public"."listing_geo_precision" AS ENUM('house', 'street', 'place', 'city');--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "address" varchar(200);--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "lon" double precision;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "geo_precision" "listing_geo_precision" DEFAULT 'city' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_point_pair" CHECK (("listings"."lat" is null) = ("listings"."lon" is null));