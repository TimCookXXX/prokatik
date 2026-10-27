// Входы заявки без аккаунта: маяк черновика для бота (/api/leads/draft) и
// запасная форма «Имя + телефон» (submitLeadForm). Общая часть — выбор на
// странице вещи (bookingSelectionSchema), его проверяет checkBookingSelection.
//
// Метки кампании и ClientID Метрики — необязательные довески: мусор в них не
// роняет заявку, а отбрасывается (cleanUtm, cleanYmClientId). Заявка дороже
// своей атрибуции.

import { z } from "zod";
import { bookingSelectionSchema, normalizePhone } from "@/lib/booking/validation";
import { entryOf, UTM_PARAMS } from "@/lib/analytics/sanitize";
import { content } from "@theme/content";

/** Потолок тела маяка: выбор, токен, метки и ClientID с большим запасом. */
export const LEAD_DRAFT_BODY_MAX = 4 * 1024;

/**
 * Токен `/start`: 16 случайных байт в base64url без `=` — 22 символа. Входит в
 * правило Bot API на параметр deep link и не перебирается.
 */
export const START_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

// Сырые метки: ключи и значения приводятся к правилу статистики в cleanUtm.
const rawUtm = z.record(z.string().max(500)).optional().catch(undefined);
const rawCid = z.string().max(64).optional().catch(undefined);

export const leadDraftSchema = bookingSelectionSchema.extend({
  token: z.string().regex(START_TOKEN_RE),
  utm: rawUtm,
  ymClientId: rawCid,
});
export type LeadDraftInput = z.input<typeof leadDraftSchema>;

const f = content.booking.leadForm;

export const leadFormSchema = bookingSelectionSchema.extend({
  name: z.string().trim().min(1, f.nameRequired).max(100, f.nameRequired),
  phone: z.string().transform(normalizePhone).refine((p) => p.length > 0, { message: f.phoneInvalid }),
  // Honeypot: скрытое поле, люди его не заполняют. Непустое значение — бот.
  website: z.string().optional().default(""),
  utm: rawUtm,
  ymClientId: rawCid,
});
export type LeadFormInput = z.input<typeof leadFormSchema>;

/**
 * Метки из тела запроса — тем же правилом, что метки входа в статистике:
 * только utm_* из списка, текст маскируется и обрезается. null — меток нет.
 */
export function cleanUtm(raw: Record<string, string> | undefined | null): Record<string, string> | null {
  if (!raw) return null;
  const params = new URLSearchParams();
  for (const key of UTM_PARAMS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim() !== "") params.set(key, value);
  }
  if ([...params.keys()].length === 0) return null;
  const { utm } = entryOf(`/?${params.toString()}`, null);
  return Object.keys(utm).length > 0 ? (utm as Record<string, string>) : null;
}

/** ClientID Метрики — только цифры, до 32. Остальное — null. */
export function cleanYmClientId(raw: string | undefined | null): string | null {
  return typeof raw === "string" && /^\d{1,32}$/.test(raw) ? raw : null;
}
