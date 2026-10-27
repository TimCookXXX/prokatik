// Браузерная часть заявки без аккаунта (BOOKING_FLOW=telegram, ADR 0028):
// токен ссылки на бота, маяк черновика и общие поля заявки — выбор, метки
// кампании и ClientID Метрики. Серверная схема — src/lib/leads/payload.ts.

import type { BookingSelection } from "@/lib/booking/params";
import type { Tariff } from "@/lib/catalog/tariff";
import { UTM_PARAMS } from "@/lib/analytics/sanitize";
import { ymClientIdNow } from "@/components/analytics/ym-client";

export const LEAD_DRAFT_ENDPOINT = "/api/leads/draft";

/**
 * Токен `/start`: 16 случайных байт, base64url без `=` — 22 символа. Входит в
 * правило Bot API на параметр deep link (`[A-Za-z0-9_-]{1,64}`) и не
 * перебирается.
 */
export function newStartToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Ссылка на бота; без токена (до гидратации) — просто бот, он попросит выбрать на сайте. */
export function botHref(username: string, token: string): string {
  return token ? `https://t.me/${username}?start=${token}` : `https://t.me/${username}`;
}

/**
 * Выбор на странице вещи в форме bookingSelectionSchema. Пустая строка цены —
 * «этой цены нет»: сервер сверит и её отсутствие.
 */
export function selectionFields(listingId: string, sel: BookingSelection, tariff: Tariff) {
  return {
    listingId,
    from: sel.from,
    to: sel.to,
    qty: String(sel.qty),
    priceDay: tariff.priceDay?.toString() ?? "",
    priceWeek: tariff.priceWeek?.toString() ?? "",
    priceMonth: tariff.priceMonth?.toString() ?? "",
  };
}

/**
 * Метки кампании из адреса и ClientID, если они есть. На странице вещи метки
 * в адресе бывают редко (сюда приходят клиентским переходом) — тогда сервер
 * возьмёт последнюю рекламную метку браузера из своей статистики.
 */
export function attribution(): { utm?: Record<string, string>; ymClientId?: string } {
  const out: { utm?: Record<string, string>; ymClientId?: string } = {};
  const query = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of UTM_PARAMS) {
    const value = query.get(key);
    if (value) utm[key] = value.slice(0, 500);
  }
  if (Object.keys(utm).length > 0) out.utm = utm;
  const cid = ymClientIdNow();
  if (cid) out.ymClientId = cid;
  return out;
}

/**
 * Маяк черновика: переживает уход со страницы, ответа не ждёт. Без
 * sendBeacon — fetch с keepalive. Сбой маяка не мешает переходу: бот без
 * черновика скажет «заявка устарела» и вернёт на сайт.
 */
export function sendLeadDraft(body: Record<string, unknown>): void {
  const json = JSON.stringify(body);
  try {
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(LEAD_DRAFT_ENDPOINT, json)) return;
  } catch {
    // Ниже — запасной путь.
  }
  try {
    fetch(LEAD_DRAFT_ENDPOINT, {
      method: "POST",
      body: json,
      keepalive: true,
      credentials: "same-origin",
      headers: { "content-type": "text/plain;charset=UTF-8" },
    }).catch(() => {});
  } catch {
    // Маяк — не повод ломать ссылку.
  }
}
