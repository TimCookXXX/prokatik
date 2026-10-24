-- Цены за неделю и месяц и минимальный срок аренды — см. ADR 0026.
--
-- Суточная цена становится необязательной и у объявления, и в снимке заявки:
-- вещь может сдаваться только неделями. Бэкфила нет: у всех существующих строк
-- суточная задана, неделя и месяц пусты, минимальный срок — один день, то есть
-- ровно прежнее поведение. CHECK'и проверяют существующие строки при
-- создании; суточная ≥ 1 держится формой с 2026-09-05, так что падать нечему.
ALTER TABLE "booking_requests" ALTER COLUMN "price_day" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "price_day" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "price_week" integer;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "price_month" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "price_week" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "price_month" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "min_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_price_present" CHECK (coalesce("booking_requests"."price_day", "booking_requests"."price_week", "booking_requests"."price_month") is not null);--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_price_present" CHECK (coalesce("listings"."price_day", "listings"."price_week", "listings"."price_month") is not null);--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_price_positive" CHECK (coalesce("listings"."price_day", 1) > 0
    and coalesce("listings"."price_week", 1) > 0 and coalesce("listings"."price_month", 1) > 0);--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_min_days_range" CHECK ("listings"."min_days" between 1 and 90);--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_min_days_priced" CHECK ("listings"."price_day" is not null
    or ("listings"."min_days" >= 7 and ("listings"."price_week" is not null or "listings"."min_days" >= 30)));