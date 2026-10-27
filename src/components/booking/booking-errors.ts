// Коды ошибок заявки → текст для человека. Общие у диалога заявки из кабинета
// (createBookingRequest) и запасной формы без аккаунта (submitLeadForm): обе
// проверяет одна checkBookingSelection, и коды у них те же. Тексты —
// content.booking.errors.

import { content } from "@theme/content";
import { daysLabel } from "@/lib/catalog/tariff";

const e = content.booking.errors;

export function humanError(code: string): string {
  if (code.startsWith("rate_limited:")) return e.rateLimited(code.split(":")[1]);
  if (code.startsWith("dates_taken:")) return e.datesTaken;
  if (code === "duplicate_request") return e.duplicate;
  if (code === "qty_stale") return e.qtyStale;
  if (code === "price_stale") return e.priceStale;
  if (code.startsWith("min_days:")) {
    const n = Number(code.split(":")[1]);
    if (Number.isInteger(n) && n > 1) return content.booking.minDaysError(daysLabel(n));
  }
  if (code === "dates_stale") return e.datesStale;
  if (code === "listing_not_found") return e.listingNotFound;
  // Из интерфейса недостижимо — владельцу виджет брони не предлагает. Текст
  // нужен для прямого вызова экшена: по сети он доступен мимо UI.
  if (code === "own_listing") return e.ownListing;
  if (code === "banned") return e.banned;
  if (code === "auth_required") return e.authRequired;
  /* Наружу выносим только то, что писали для человека. Сообщения зода на
   * английском («Expected number, received nan») сюда доезжали дословно:
   * экшен отдаёт текст первой непройденной проверки, и среди них есть как
   * наши русские, так и служебные. Кириллица — признак «это писали людям». */
  return /[а-яё]/i.test(code) ? code : e.generic;
}
