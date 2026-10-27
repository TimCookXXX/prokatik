// Сверка заголовка X-Telegram-Bot-Api-Secret-Token с TELEGRAM_WEBHOOK_SECRET.
// Сравнение за постоянное время, длина — до него, как в analytics/token.ts:
// timingSafeEqual на буферах разной длины бросает. Длина секрета не тайна —
// правило на неё одно для всех (32–256 символов).

import { timingSafeEqual } from "node:crypto";

export function isWebhookSecretValid(given: string | null | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
