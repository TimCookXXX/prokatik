-- Заявки без аккаунта — через Telegram-бота и запасную форму «Имя + телефон»,
-- см. ADR 0028. Отдельная таблица, а не booking_requests: там
-- customer_user_id NOT NULL, а у лида человека в базе нет. Даты лид не держит,
-- availability миграция не трогает. Таблица новая — бэкфила нет.
CREATE TYPE "public"."lead_channel" AS ENUM('telegram', 'form');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('draft', 'sent', 'handed', 'taken', 'declined');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" "lead_channel" NOT NULL,
	"status" "lead_status" DEFAULT 'draft' NOT NULL,
	"start_token" varchar(32),
	"code" varchar(10),
	"invalid_reason" varchar(40),
	"listing_id" text,
	"owner_user_id" text,
	"listing_title" varchar(200),
	"owner_name" varchar(100),
	"owner_phone" varchar(20),
	"listing_path" varchar(300),
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"price_day" integer,
	"price_week" integer,
	"price_month" integer,
	"deposit_type" "deposit_type" DEFAULT 'none' NOT NULL,
	"deposit_amount" integer,
	"total" integer,
	"utm" jsonb,
	"ym_client_id" varchar(32),
	"visitor_id" uuid,
	"internal" boolean DEFAULT false NOT NULL,
	"customer_name" varchar(100),
	"customer_phone" varchar(20),
	"tg_user_id" bigint,
	"tg_username" varchar(32),
	"tg_name" varchar(130),
	"bound_at" timestamp,
	"group_message_id" bigint,
	"card_attempts" integer DEFAULT 0 NOT NULL,
	"card_claimed_at" timestamp,
	"card_next_at" timestamp,
	"status_changed_at" timestamp,
	"status_changed_by" varchar(130),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	CONSTRAINT "booking_leads_start_token_unique" UNIQUE("start_token"),
	CONSTRAINT "booking_leads_code_unique" UNIQUE("code"),
	CONSTRAINT "booking_leads_dates_order" CHECK ("booking_leads"."date_from" <= "booking_leads"."date_to"),
	CONSTRAINT "booking_leads_price_present" CHECK ("booking_leads"."invalid_reason" is not null
    or coalesce("booking_leads"."price_day", "booking_leads"."price_week", "booking_leads"."price_month") is not null),
	CONSTRAINT "booking_leads_code_on_send" CHECK (("booking_leads"."status" = 'draft') = ("booking_leads"."code" is null)),
	CONSTRAINT "booking_leads_token_on_telegram" CHECK (("booking_leads"."channel" = 'telegram') = ("booking_leads"."start_token" is not null))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_leads" ADD CONSTRAINT "booking_leads_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_leads" ADD CONSTRAINT "booking_leads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_leads_status_created_idx" ON "booking_leads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_leads_tg_user_idx" ON "booking_leads" USING btree ("tg_user_id","bound_at") WHERE "booking_leads"."tg_user_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_leads_sent_idx" ON "booking_leads" USING btree ("sent_at") WHERE "booking_leads"."sent_at" is not null;