// Тарифы объявления: цена за сутки, за неделю и за месяц и минимальный срок.
// Чистый модуль — им считают сумму виджет брони, форма заявки, сервер, лента
// заявок и карточка в переписке, и разойтись им нельзя (ADR 0026).
//
// Бронь посуточная: диапазон дат, обе границы включительно. Неделя и месяц —
// не другие единицы занятости, а ступени цены за длинный срок: от 7 дней
// действует недельная (её доля на день), от 30 — месячная.

import { content } from "@theme/content";
import { formatPrice } from "@/lib/catalog/format";
import { ruPlural } from "@/lib/plural";

export type PriceUnit = "day" | "week" | "month";

/** Цены за срок, NULL — за этот срок не сдаётся. Хоть одна задана всегда. */
export interface Tariff {
  priceDay: number | null;
  priceWeek: number | null;
  priceMonth: number | null;
}

export interface ListingTerms extends Tariff {
  minDays: number;
}

/** Длина ступени в днях: с неё начинает действовать её цена. */
export const UNIT_DAYS: Record<PriceUnit, number> = { day: 1, week: 7, month: 30 };
const UNITS: readonly PriceUnit[] = ["day", "week", "month"];

export const MIN_DAYS_MAX = 90;

function priceOf(t: Tariff, unit: PriceUnit): number | null {
  const v = unit === "day" ? t.priceDay : unit === "week" ? t.priceWeek : t.priceMonth;
  return typeof v === "number" && v > 0 ? v : null;
}

export interface UnitPrice {
  amount: number;
  unit: PriceUnit;
}

/** Все заданные цены по возрастанию срока — плитки на странице объявления. */
export function priceTiers(t: Tariff): UnitPrice[] {
  return UNITS.flatMap((unit) => {
    const amount = priceOf(t, unit);
    return amount === null ? [] : [{ amount, unit }];
  });
}

/**
 * Главная цена — та, что видна на карточке и в заголовке: суточная, если есть,
 * иначе недельная, иначе месячная. null — цен нет вовсе (в базе такого не
 * бывает: CHECK listings_price_present).
 */
export function primaryPrice(t: Tariff): UnitPrice | null {
  return priceTiers(t)[0] ?? null;
}

/**
 * Цена, приведённая к суткам, — только для сортировки и фильтра цены, нигде
 * не показывается как «₽/сутки». То же выражение в SQL — effectivePriceSql в
 * src/server/catalog.ts.
 */
export function effectiveDayPrice(t: Tariff): number | null {
  const day = priceOf(t, "day");
  if (day !== null) return day;
  const week = priceOf(t, "week");
  if (week !== null) return Math.ceil(week / 7);
  const month = priceOf(t, "month");
  return month === null ? null : Math.ceil(month / 30);
}

/**
 * Наименьший минимальный срок, при котором у объявления есть чем посчитать
 * сумму: без суточной — неделя, без суточной и недельной — месяц.
 */
export function requiredMinDays(t: Tariff): number {
  if (priceOf(t, "day") !== null) return 1;
  if (priceOf(t, "week") !== null) return UNIT_DAYS.week;
  return UNIT_DAYS.month;
}

export type Quote =
  | {
    ok: true;
    /** Сумма за срок и количество, целые рубли. */
    total: number;
    /** Ступень, по которой считали: её цена — rate. */
    unit: PriceUnit;
    rate: number;
    /**
     * Сумма упёрлась в цену следующей ступени: 6 суток по 500 ₽ дороже
     * недели за 2 250 ₽ — берётся неделя. unit и rate тогда — той ступени.
     */
    capped: boolean;
  }
  | { ok: false; error: "min_days"; minDays: number }
  | { ok: false; error: "no_price" };

/**
 * Сумма за `days` суток (обе границы включительно) и `qty` единиц.
 *
 * Лестница: от 30 дней при месячной цене — месячная/30 за день, от 7 при
 * недельной — недельная/7, иначе суточная. Срок короче самой короткой заданной
 * ступени считается её долей: без суточной это возможно, только если
 * минимальный срок нарушен, а он проверяется раньше.
 *
 * Без скачков вниз: сумма не больше цены любой более длинной ступени — 6 суток
 * не дороже недели, 29 дней не дороже месяца. Иначе удлинить аренду было бы
 * дешевле, чем взять её короче.
 *
 * Округление одно, до рубля, на сумму за одну единицу; потом × qty.
 * `minDays` не передан — срок не проверяется: так считаются заявки, у которых
 * минимального срока в снимке нет.
 */
export function quote(t: Tariff & { minDays?: number }, days: number, qty = 1): Quote {
  if (t.minDays !== undefined && days < t.minDays) {
    return { ok: false, error: "min_days", minDays: t.minDays };
  }
  const tiers = priceTiers(t);
  if (tiers.length === 0 || days < 1) return { ok: false, error: "no_price" };

  const base = [...tiers].reverse().find((p) => UNIT_DAYS[p.unit] <= days) ?? tiers[0];
  let unit = base.unit;
  let rate = base.amount;
  let exact = (base.amount * days) / UNIT_DAYS[base.unit];
  let capped = false;
  for (const next of tiers) {
    if (UNIT_DAYS[next.unit] > days && next.amount < exact) {
      exact = next.amount;
      unit = next.unit;
      rate = next.amount;
      capped = true;
    }
  }
  return { ok: true, total: Math.round(exact) * qty, unit, rate, capped };
}

/** «от 7 дней», «от 3 дней», «от 21 дня» — после «от» родительный падеж. */
export function minDaysLabel(n: number): string {
  return `от ${n} ${ruPlural(n, "дня", "дней", "дней")}`;
}

/** Без «от»: «7 дней», «3 дня» — значение к подписи «Минимальный срок». */
export function daysLabel(n: number): string {
  return `${n} ${ruPlural(n, "день", "дня", "дней")}`;
}

/** Короткая метка для карточки: «от 7 дн.». */
export function minDaysShort(n: number): string {
  return `от ${n} дн.`;
}

/** «2 250 ₽ в неделю». */
export function formatUnitPrice(p: UnitPrice): string {
  return `${formatPrice(p.amount)} ${content.tariff.per[p.unit]}`;
}

/** «2 250 ₽/неделя» — для строк заголовка, чипа переписки, админки. */
export function formatUnitPriceSlash(p: UnitPrice): string {
  return `${formatPrice(p.amount)}${content.tariff.slash[p.unit]}`;
}

/**
 * Цены раздела для заголовков и вводного блока. Суточные — по сырой
 * min/max(price_day); если суточных в разделе нет вовсе, — по главной цене с её
 * единицей. Приведённая к суткам цена (effectiveDayPrice) сюда не идёт:
 * «от 322 ₽/сутки» у вещи, которую меньше чем на неделю не сдают, — выдумка.
 */
export interface PriceSummary {
  unit: PriceUnit;
  min: number;
  max: number;
}

export interface PriceAggregates {
  dayMin: number | null;
  dayMax: number | null;
  /** Среди объявлений без суточной. */
  weekMin: number | null;
  weekMax: number | null;
  /** Среди объявлений без суточной и недельной. */
  monthMin: number | null;
  monthMax: number | null;
}

export function priceSummary(a: PriceAggregates): PriceSummary | null {
  if (a.dayMin !== null && a.dayMax !== null) return { unit: "day", min: a.dayMin, max: a.dayMax };
  if (a.weekMin !== null && a.weekMax !== null) return { unit: "week", min: a.weekMin, max: a.weekMax };
  if (a.monthMin !== null && a.monthMax !== null) return { unit: "month", min: a.monthMin, max: a.monthMax };
  return null;
}
