// Выбор диапазона дат кликами по календарю — общий для поля «Когда» в поиске и
// виджета брони. Чистая функция, чтобы оба календаря вели себя одинаково.
//
// Первый клик ставит один день, второй замыкает диапазон в любом порядке
// (26, потом 24 → 24–26); клик по готовому диапазону начинает выбор заново.
// Обе границы включены, поэтому второй клик в тот же день — однодневная аренда.
// Длину не ограничиваем: границу задаёт горизонт календаря, как и в брони.

import { addDaysStr, rangeDaysCount } from "@/lib/catalog/dates";

export interface RangePick {
  from: string;
  /** null — выбран только первый день, ждём второй. */
  to: string | null;
}

/** Пустая строка в полях — то же, что null: так выбор хранит виджет брони. */
export function pickRange(
  sel: { from?: string | null; to?: string | null },
  day: string,
): RangePick {
  if (!sel.from || sel.to) return { from: day, to: null };
  return day < sel.from ? { from: day, to: sel.from } : { from: sel.from, to: day };
}

/* Минимальный срок аренды (ADR 0026). Дни календаря им не отключаются:
 * человек, нажавший «Вернуть» слишком рано, получает диапазон, растянутый до
 * минимума, и видит подсказку — тихий отказ на клик выглядел бы поломкой. */

/** Последний день, с которого ещё помещается минимальный срок до горизонта. */
export function latestStart(maxDate: string, minDays: number): string {
  return addDaysStr(maxDate, -(Math.max(1, minDays) - 1));
}

/**
 * Замкнутый диапазон короче минимума растягивается вперёд, до
 * `from + minDays − 1`, упираясь в горизонт. `extended` — растянули ли.
 * Незамкнутый (`to` пуст) не трогается: «Вернуть» ещё не выбрано.
 */
export function extendToMin(
  pick: RangePick,
  minDays: number,
  maxDate: string,
): RangePick & { extended: boolean } {
  if (!pick.to || minDays <= 1 || rangeDaysCount(pick.from, pick.to) >= minDays) {
    return { ...pick, extended: false };
  }
  const want = addDaysStr(pick.from, minDays - 1);
  return { from: pick.from, to: want > maxDate ? maxDate : want, extended: true };
}

/** Дни, выбор которых концом диапазона растянется до минимума: от «Забрать» до from + min − 2. */
export function isTooShortEnd(from: string, day: string, minDays: number): boolean {
  return minDays > 1 && day >= from && rangeDaysCount(from, day) < minDays;
}
