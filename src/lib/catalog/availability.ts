// Чистая логика занятости позиции по дням. Хранение — таблица availability:
// по строке на (listing, date), отсутствие строки = день полностью свободен.
// Свободно в день = quantity - bookedQty - blockedQty.
//
// Даты везде — строки "YYYY-MM-DD" (как их отдаёт pg `date`).
// Диапазон брони [dateFrom, dateTo] включает обе границы: аренда посуточная,
// день возврата тоже занят.

export interface DayLoad {
  bookedQty: number;
  blockedQty: number;
}

export type AvailabilityMap = Map<string, DayLoad>; // date -> load

import { isDateStr } from "@/lib/catalog/dates";

const DAY_MS = 24 * 60 * 60 * 1000;

// Несуществующий день ("2026-02-30") — тоже мусор: Date.parse перенёс бы его
// на март, и бронь ушла бы не на те даты, что в запросе.
export function assertDateString(s: string): void {
  if (!isDateStr(s)) throw new Error(`invalid date string: ${s}`);
}

// Все даты диапазона включительно. Бросает на некорректном диапазоне —
// вызывающий обязан валидировать ввод раньше (zod в форме заявки).
export function eachDate(dateFrom: string, dateTo: string): string[] {
  assertDateString(dateFrom);
  assertDateString(dateTo);
  const from = Date.parse(`${dateFrom}T00:00:00Z`);
  const to = Date.parse(`${dateTo}T00:00:00Z`);
  if (to < from) throw new Error("date_range_inverted");
  const out: string[] = [];
  for (let t = from; t <= to; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// Строки availability (по одной на listing+date) → карта listingId → AvailabilityMap.
// Общий для страниц каталога/поиска и провайдера, чтобы не дублировать цикл.
export function buildAvailabilityByListing(
  rows: Array<{ listingId: string; date: string; bookedQty: number; blockedQty: number }>,
): Map<string, AvailabilityMap> {
  const out = new Map<string, AvailabilityMap>();
  for (const r of rows) {
    const m = out.get(r.listingId) ?? new Map();
    m.set(r.date, { bookedQty: r.bookedQty, blockedQty: r.blockedQty });
    out.set(r.listingId, m);
  }
  return out;
}

export function freeQty(quantity: number, load: DayLoad | undefined): number {
  const used = (load?.bookedQty ?? 0) + (load?.blockedQty ?? 0);
  return Math.max(0, quantity - used);
}

// Можно ли подтвердить бронь qty единиц на весь диапазон.
export function canBook(
  quantity: number,
  map: AvailabilityMap,
  dateFrom: string,
  dateTo: string,
  qty: number,
): boolean {
  if (qty < 1) return false;
  return eachDate(dateFrom, dateTo).every((d) => freeQty(quantity, map.get(d)) >= qty);
}

// Дни диапазона, в которые qty единиц не набирается. Пустой массив = бронь возможна.
// Используется виджетом брони для подсветки конфликта и сервером при создании заявки.
export function unavailableDates(
  quantity: number,
  map: AvailabilityMap,
  dateFrom: string,
  dateTo: string,
  qty: number,
): string[] {
  return eachDate(dateFrom, dateTo).filter((d) => freeQty(quantity, map.get(d)) < qty);
}

export interface OccupancySummary {
  /** Дней в окне, где свободно меньше, чем единиц всего. */
  busyDays: number;
  /** Первая занятая череда окна. null, если окно свободно целиком. */
  nextBusyFrom: string | null;
  nextBusyTo: string | null;
}

/* Занятость окна одной строкой — над календарём. Владельцу почти всегда нужен
 * ответ «свободна ли вещь и когда ближайшая занятость», а не разбор сетки по
 * цветам; сетка остаётся для случая, когда нужен именно обзор месяца.
 *
 * Кто именно занял дни, здесь не считается: заявки лежат отдельным блоком выше,
 * и дублировать имена значило бы держать их в двух местах. */
export function occupancySummary(
  quantity: number,
  map: AvailabilityMap,
  dateFrom: string,
  dateTo: string,
): OccupancySummary {
  let busyDays = 0;
  let nextBusyFrom: string | null = null;
  let nextBusyTo: string | null = null;
  let streakOpen = false;

  for (const date of eachDate(dateFrom, dateTo)) {
    const busy = freeQty(quantity, map.get(date)) < quantity;
    if (busy) busyDays += 1;

    // Череду закрываем первым же свободным днём: дальше по окну могут быть
    // другие занятые дни, но «ближайшая занятость» — только первая.
    if (busy && nextBusyFrom === null) {
      nextBusyFrom = date;
      nextBusyTo = date;
      streakOpen = true;
    } else if (busy && streakOpen) {
      nextBusyTo = date;
    } else if (!busy) {
      streakOpen = false;
    }
  }

  return { busyDays, nextBusyFrom, nextBusyTo };
}

// Дельта бронирования на диапазон: +qty при подтверждении, -qty при освобождении.
// Возвращает новую карту (вход не мутирует); bookedQty не уходит ниже нуля —
// защита от двойного release.
export function applyBookingDelta(
  map: AvailabilityMap,
  dateFrom: string,
  dateTo: string,
  qtyDelta: number,
): AvailabilityMap {
  const next: AvailabilityMap = new Map(map);
  for (const d of eachDate(dateFrom, dateTo)) {
    const cur = next.get(d) ?? { bookedQty: 0, blockedQty: 0 };
    next.set(d, { ...cur, bookedQty: Math.max(0, cur.bookedQty + qtyDelta) });
  }
  return next;
}
