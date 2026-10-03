import { ruPlural } from "@/lib/plural";
// Дата-хелперы каталога. Календарный день — строка "YYYY-MM-DD" без зоны:
// занятость считается по дням, а не по часам. Хелперы строка→строка парсят
// вход как T00:00:00Z и читают UTC-компоненты — инстанта в цепочке нет, зоне
// взяться неоткуда, и это должно таким остаться (единообразие с eachDate()
// из availability.ts).
//
// Зона нужна ровно там, где день выводят ИЗ момента времени: todayStr и
// formatMonthYearGen. Берётся деловая зона сервиса, а не зона процесса:
// у TZ есть дефолт, и доменный ответ не должен от неё зависеть.

const DAY_MS = 24 * 60 * 60 * 1000;

// Одна зона на весь сервис, включая города восточнее Москвы —
// docs/decisions/0013-single-business-timezone.md.
const APP_TIME_ZONE = "Europe/Moscow";

// Форматтер ленивый: модуль тянут и клиентские компоненты (BookingWidget,
// DateRangeFilter) — ради строковых хелперов, а конструктор на верхнем уровне
// они бы всё равно исполнили при загрузке чанка.
//
// Локаль, календарь и система счисления прибиты явно: на дефолтной локали
// процесса fa-IR дал бы персидский календарь и не-латинские цифры.
let zonedFormat: Intl.DateTimeFormat | undefined;

function zonedParts(date: Date): { year: number; month: number; day: number } {
  zonedFormat ??= new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = zonedFormat.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

export function todayStr(now: Date = new Date()): string {
  const { year, month, day } = zonedParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDaysStr(dateStr: string, days: number): string {
  const t = Date.parse(`${dateStr}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* Календарный день "YYYY-MM-DD", который существует. Одного регэкспа мало, и
 * Date.parse не спасает: "2026-02-30" он молча переносит на 2 марта. Поэтому
 * обратный ход — день, собранный из разобранного момента, обязан совпасть со
 * входом. */
export function isDateStr(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/* Дней в диапазоне, обе границы включены: аренда посуточная, день возврата
 * тоже занят (docs/domain.md). Один и тот же день — одни сутки. */
export function rangeDaysCount(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
}

const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;

/* «сб» */
export function weekdayShort(dateStr: string): string {
  return WEEKDAYS_SHORT[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;

const MONTHS_SHORT = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
] as const;

/* «28 авг» — для кнопок и чипов, где полное название распирает контрол. */
export function formatDayMonthShort(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/* «08.09» — для колонок и узких строк, где даже «8 сен» в диапазоне не
 * помещается: период стоит парой, и словесный месяц удваивается. Ноль ведущий
 * нарочно — в колонке даты выравниваются, а «8.09 — 14.09» рвёт ряд. */
export function formatDayMonthNum(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}`;
}

/* Диапазон для поля «Когда»: «сб 12 — пн 14 окт». Месяц пишется один раз,
 * если он общий; разные месяцы — у обеих границ: «ср 30 сен — пт 2 окт».
 * Один день — «сб 12 окт». */
export function dateRangeLabel(from: string, to: string): string {
  const day = (s: string) => `${weekdayShort(s)} ${new Date(`${s}T00:00:00Z`).getUTCDate()}`;
  const month = (s: string) => MONTHS_SHORT[new Date(`${s}T00:00:00Z`).getUTCMonth()];
  const right = `${day(to)} ${month(to)}`;
  if (from === to) return right;
  return month(from) === month(to) && from.slice(0, 4) === to.slice(0, 4)
    ? `${day(from)} — ${right}`
    : `${day(from)} ${month(from)} — ${right}`;
}

/* Короткий диапазон для чипа на узком экране: «10–12 окт», «30 сен – 2 окт»,
 * один день — «10 окт». Без дней недели: чип делит строку с сортировкой и
 * видом, и полная подпись на телефоне переносилась в три строки. */
export function shortRangeLabel(from: string, to: string): string {
  if (from === to) return formatDayMonthShort(to);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return sameMonth
    ? `${new Date(`${from}T00:00:00Z`).getUTCDate()}–${formatDayMonthShort(to)}`
    : `${formatDayMonthShort(from)} – ${formatDayMonthShort(to)}`;
}

/* «3 дня» — длина диапазона с обеими границами: 12–14 — это три дня аренды. */
export function daysLabel(from: string, to: string): string {
  const n = rangeDaysCount(from, to);
  return `${n} ${ruPlural(n, "день", "дня", "дней")}`;
}

export function formatDayMonth(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`;
}

/* «августа 2026» — для оборотов вида «на сайте с …». Родительный падеж:
 * Intl без числа дня даёт именительный («август 2026»), и получается
 * «с август». Месяц берётся в деловой зоне: регистрация 1 сентября в 01:00
 * МСК по UTC-компонентам показывалась как «на сайте с августа». */
export function formatMonthYearGen(date: Date): string {
  const { year, month } = zonedParts(date);
  return `${MONTHS_GEN[month - 1]} ${year}`;
}

/* Сколько осталось до срока, словами: «2 ч 40 мин», «6 ч», «завтра».
 * Возвращает null, когда срок уже прошёл — вызывающий решает, что показать. */
export function formatTimeLeft(
  until: Date,
  now: Date = new Date(),
  /* Только старшая единица: «23 ч» вместо «23 ч 51 мин». Для метки, стоящей
   * вплотную к названию, точность до минуты не нужна и вредна — она отнимает
   * ширину у самого названия. Решение принимают по порядку величины: сутки
   * впереди или последний час. */
  coarse = false,
): string | null {
  const minutes = Math.floor((until.getTime() - now.getTime()) / 60000);
  if (minutes <= 0) return null;
  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest && !coarse ? `${hours} ч ${rest} мин` : `${hours} ч`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${ruPlural(days, "день", "дня", "дней")}`;
}
