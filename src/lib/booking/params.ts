// Выбор дат/количества живёт в URL query (?from&to&qty): переживает
// OAuth-redirect на чужой origin и восстанавливается после входа без
// sessionStorage. Здесь — чистый разбор и сборка этих параметров.

import { addDaysStr, isDateStr, rangeDaysCount } from "@/lib/catalog/dates";

export interface BookingSelection {
  from: string;
  to: string;
  qty: number;
}

export const BOOKING_HORIZON_DAYS = 180;

// Мусор на входе не ломает страницу — сводится к дефолтам и клампам:
// from ∈ [today, today+horizon], to ∈ [from, today+horizon], qty ∈ [1, maxQty].
export function parseBookingParams(
  sp: { from?: string; to?: string; qty?: string },
  opts: { today: string; maxQty: number; horizonDays?: number },
): BookingSelection {
  const horizon = addDaysStr(opts.today, opts.horizonDays ?? BOOKING_HORIZON_DAYS);

  let from = isDateStr(sp.from) ? sp.from : opts.today;
  if (from < opts.today) from = opts.today;
  if (from > horizon) from = horizon;

  let to = isDateStr(sp.to) ? sp.to : from;
  if (to < from) to = from;
  if (to > horizon) to = horizon;

  const qtyNum = Number(sp.qty);
  const qty = Number.isInteger(qtyNum) ? Math.min(Math.max(qtyNum, 1), opts.maxQty) : 1;

  return { from, to, qty };
}

// Query string для URL страницы позиции. Дефолты (сегодня/сегодня/1) опускаются,
// чтобы canonical-страница без выбора оставалась чистой.
export function buildBookingQuery(sel: BookingSelection, today: string): string {
  const q = new URLSearchParams();
  if (sel.from !== today || sel.to !== sel.from) {
    q.set("from", sel.from);
    q.set("to", sel.to);
  }
  if (sel.qty > 1) q.set("qty", String(sel.qty));
  return q.toString();
}

// Сдвинул ли кламп присланные даты. На странице сдвиг уместен — мусор в URL не
// должен ронять выдачу; в мутации нет: форма, пролежавшая открытой через
// полночь, отправила бы владельцу не те даты, которые человек видел на экране,
// а диалог показывает только «готово».
export function isSelectionShifted(
  requested: { from: string; to: string },
  clamped: BookingSelection,
): boolean {
  return clamped.from !== requested.from || clamped.to !== requested.to;
}

export function rentalDaysCount(sel: BookingSelection): number {
  return rangeDaysCount(sel.from, sel.to);
}

const BOOKING_KEYS = ["from", "to", "qty"] as const;

/* Query страницы позиции после выбора в виджете: в текущем адресе заменяются
 * только from/to/qty, остальное остаётся как есть. Виджет пишет адрес через
 * replaceState, и сборка query с нуля стирала бы чужие параметры — «Где» с
 * расстоянием, метки переходов — из перезагрузки, «поделиться» и callbackUrl
 * входа. sel = null — выбор не закончен: from/to/qty убираются. Дефолты
 * опускаются так же, как в buildBookingQuery. Возвращает query без «?». */
export function mergeBookingQuery(
  current: string | URLSearchParams,
  sel: BookingSelection | null,
  today: string,
): string {
  const out = new URLSearchParams(current);
  for (const key of BOOKING_KEYS) out.delete(key);
  if (sel) {
    for (const [key, value] of new URLSearchParams(buildBookingQuery(sel, today))) out.set(key, value);
  }
  return out.toString();
}
