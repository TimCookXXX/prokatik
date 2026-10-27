// Строка booking_leads и окружение бота для тестов заявок без аккаунта.
// Значения окружения фиктивные: настоящий токен в тесты не попадает.

import type { LeadRow } from "@/server/leads";
import { _resetEnvCacheForTests } from "@/lib/env";

export const LEAD_ID = "01JBQ0000000000000000000AB";
export const OTHER_LEAD_ID = "01JBQ0000000000000000000CD";
export const ADMIN_CHAT = -5000000001;
export const WEBHOOK_SECRET = "s".repeat(32);

export const TELEGRAM_ENV: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "123456:" + "a".repeat(35),
  TELEGRAM_BOT_USERNAME: "test_bot",
  TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
  TELEGRAM_ADMIN_CHAT_ID: String(ADMIN_CHAT),
};

/** Включает бота в process.env; возвращает выключатель. */
export function enableTelegramEnv(): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(TELEGRAM_ENV)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  _resetEnvCacheForTests();
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetEnvCacheForTests();
  };
}

export function leadRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: LEAD_ID,
    channel: "telegram",
    status: "draft",
    startToken: "tok_tok_tok_tok_tok_12",
    code: null,
    invalidReason: null,
    listingId: "01JBQ0000000000000000000L1",
    ownerUserId: "owner",
    listingTitle: "Kugoo Kirin V3 Pro",
    ownerName: "ПикаВел",
    ownerPhone: "+79282218754",
    listingPath: "/krasnodar/velo/kugoo-01JBQ0000000000000000000L1",
    dateFrom: "2026-10-28",
    dateTo: "2026-11-03",
    qty: 1,
    priceDay: 500,
    priceWeek: 2250,
    priceMonth: null,
    depositType: "none",
    depositAmount: null,
    total: 2250,
    utm: null,
    ymClientId: null,
    visitorId: null,
    internal: false,
    customerName: null,
    customerPhone: null,
    tgUserId: null,
    tgUsername: null,
    tgName: null,
    boundAt: null,
    groupMessageId: null,
    cardAttempts: 0,
    cardClaimedAt: null,
    cardNextAt: null,
    statusChangedAt: null,
    statusChangedBy: null,
    createdAt: new Date(),
    sentAt: null,
    ...overrides,
  };
}
