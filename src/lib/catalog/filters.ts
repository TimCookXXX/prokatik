// Разбор GET-параметров фильтров листинга. Отдельно от компонента,
// чтобы тестировать без рендера.

import type { ListingFilters } from "@/server/catalog";
import { BOOKING_HORIZON_DAYS } from "@/lib/booking/params";
import { addDaysStr, isDateStr, todayStr } from "@/lib/catalog/dates";
import { locationQuery, parseLocation } from "@/lib/geo/location";

export interface CategorySearchParams {
  price_min?: string;
  price_max?: string;
  deposit?: string;
  /** Способ получения: `pickup` | `delivery`. Пусто — оба подходят. */
  handover?: string;
  verified?: string;
  /** Слаг корневого раздела — сужает поиск, не теряя запрос. */
  category?: string;
  /** Диапазон дат: показываем только свободное на все эти дни. */
  from?: string;
  to?: string;
  /** «Где»: точка, подпись, источник, точность (lib/geo/location.ts). */
  loc?: string;
  la?: string;
  src?: string;
  lp?: string;
  view?: string;
  sort?: string;
  page?: string;
  q?: string;
  city?: string;
}

// Варианты сортировки. Живут здесь, а не в компоненте меню: меню клиентское, а
// адреса для него собирает сервер — общий список нужен обеим сторонам.
// Умолчание (defaultSort) в адрес не пишется; какое оно — зависит от контекста.
export const SORT_OPTIONS = [
  { value: "relevance", label: "Сначала подходящие" },
  { value: "near", label: "Ближе" },
  { value: "free", label: "Сначала свободные" },
  { value: "new", label: "Сначала новые" },
  { value: "price_asc", label: "Дешевле" },
  { value: "price_desc", label: "Дороже" },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]["value"];

/**
 * Контекст выдачи, от которого зависят сортировки. `q` — поисковый запрос
 * /search; страницы разделов его не передают, и «Подходящие» там нет.
 * `near` — в адресе действующая точка «Где» (filters.near): без неё «Ближе»
 * не от чего считать.
 */
export interface SortContext {
  q?: string;
  near?: boolean;
}

/**
 * Сортировка, когда в адресе её нет: при запросе — по релевантности, без
 * запроса с точкой «Где» — ближе, иначе новые.
 */
export function defaultSort(ctx: SortContext = {}): SortValue {
  return ctx.q ? "relevance" : ctx.near ? "near" : "new";
}

/** Сортировки, которые имеют смысл в этом контексте, — для меню и разбора адреса. */
export function sortOptionsFor(ctx: SortContext = {}) {
  return SORT_OPTIONS.filter((o) =>
    (o.value !== "relevance" || Boolean(ctx.q)) && (o.value !== "near" || Boolean(ctx.near)));
}

/** Контекст сортировок для готовых фильтров: «Ближе» — только с действующей точкой. */
export function sortContextOf(filters: Pick<ListingFilters, "near">, q?: string): SortContext {
  return { q, near: Boolean(filters.near) };
}

/** Контекст разбора адреса: запрос, геоданные города и «сегодня», от которого меряются даты. */
export interface FilterContext {
  q?: string;
  /**
   * У города есть геоданные (регион с импортом и центр). Без них точка «Где»
   * не действует: у объявлений нет точек, расстояний и «Ближе» нет.
   */
  region?: boolean;
  /** Сегодня "YYYY-MM-DD" в деловой зоне; по умолчанию — todayStr(). */
  today?: string;
}

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Диапазон дат из адреса — строго, по правилам брони (docs/domain.md):
 * - обе границы — существующие дни и from ≤ to, иначе фильтра нет: половинчатый
 *   диапазон молча сужал бы выдачу непонятно как;
 * - диапазон целиком в прошлом или хоть одной границей за горизонтом брони —
 *   фильтра нет: таких дат пикер не даёт, а забронировать их нельзя;
 * - from в прошлом подтягивается к сегодня. Прошедшие дни забронировать нельзя,
 *   смысл фильтра от этого не меняется — это единственный кламп;
 * - длина не ограничена, как и у брони.
 * Результат — нормализованный диапазон: его же видит UI и несут ссылки.
 */
export function parseDateRange(
  sp: { from?: string; to?: string },
  today: string = todayStr(),
): DateRange | undefined {
  const { from, to } = sp;
  if (!isDateStr(from) || !isDateStr(to) || from > to) return undefined;
  if (to < today) return undefined;
  const horizon = addDaysStr(today, BOOKING_HORIZON_DAYS);
  if (from > horizon || to > horizon) return undefined;
  return { from: from < today ? today : from, to };
}

const DEPOSITS = ["money", "document", "none"] as const;
type DepositFilter = (typeof DEPOSITS)[number];

function deposit(s: string | undefined): DepositFilter | undefined {
  return DEPOSITS.find((d) => d === s);
}

const HANDOVERS = ["pickup", "delivery"] as const;
type HandoverFilter = (typeof HANDOVERS)[number];

function handover(s: string | undefined): HandoverFilter | undefined {
  return HANDOVERS.find((h) => h === s);
}

// Поисковый запрос из GET-параметров. Отдельно от parseFilters, т.к. категорийные
// страницы его не используют, а /search — да.
export function parseQuery(sp: { q?: string }): string {
  return (sp.q ?? "").trim();
}

// NB: пустая строка — НЕ ноль. Браузер отправляет незаполненные поля формы
// как `price_max=`, а Number("") === 0 превращал бы это в фильтр «до 0 ₽».
function num(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

// Сортировка — уже действующая: из адреса, если она здесь допустима, иначе
// умолчание контекста. Меню подсвечивает именно её, а не сырой `sort`: при
// пустом параметре оно иначе показывало бы первый пункт, а порядок был другим.
// Явное `sort=new` допустимо: при запросе новизна не умолчание.
//
// Точка «Где» действует только в городе с геоданными (ctx.region); `sort=near`
// без неё молча отбрасывается к умолчанию, как и «Подходящие» без запроса.
export function parseFilters(sp: CategorySearchParams, ctx: FilterContext = {}): ListingFilters {
  const near = ctx.region ? parseLocation(sp) ?? undefined : undefined;
  const sortCtx: SortContext = { q: ctx.q, near: Boolean(near) };
  const sort = sortOptionsFor(sortCtx).find((o) => o.value === sp.sort)?.value ?? defaultSort(sortCtx);
  const page = num(sp.page);
  const range = parseDateRange(sp, ctx.today);
  return {
    availableFrom: range?.from,
    availableTo: range?.to,
    priceMin: num(sp.price_min),
    priceMax: num(sp.price_max),
    deposit: deposit(sp.deposit),
    handover: handover(sp.handover),
    // Тумблер: присутствие «1» включает, всё остальное — выключено. Значение
    // не булево из формы, потому что незажатый checkbox браузер не отправляет.
    verifiedOnly: sp.verified === "1" ? true : undefined,
    near,
    sort,
    page: page && page > 0 ? page : 1,
  };
}

/**
 * Параметры, которые едут за человеком по каталогу: из выдачи в раздел, из
 * раздела в карточку, через отправку фильтров. Это даты «Когда» и точка «Где»
 * (`loc`, `la`, `src`, `lp`) — обе уже нормализованные: даты parseDateRange,
 * точка кодеком (три знака, мусор отброшен), чтобы ссылка несла то же, что
 * применено. О городе функция не знает: точка едет всегда, а действует ли
 * она в этом городе — решает parseFilters.
 * Пустое не попадает: адрес не должен обрастать `from=`.
 */
export function carryParams(
  sp: Pick<CategorySearchParams, "from" | "to" | "loc" | "la" | "src" | "lp">,
  ctx: Pick<FilterContext, "today"> = {},
): URLSearchParams {
  const out = new URLSearchParams();
  const range = parseDateRange(sp, ctx.today);
  if (range) {
    out.set("from", range.from);
    out.set("to", range.to);
  }
  const point = parseLocation(sp);
  if (point) {
    for (const [key, value] of Object.entries(locationQuery(point))) out.set(key, value);
  }
  return out;
}

// Параметры фильтров для ссылок (пагинация, сброс) — без page и без контекста
// поиска, зато с переносимыми (carryParams). Пустые значения не попадают:
// адрес не должен обрастать `deposit=`.
export function filterParams(
  sp: CategorySearchParams,
  ctx: Pick<FilterContext, "today"> = {},
): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of [
    "price_min", "price_max", "deposit", "handover", "verified", "category", "view", "sort",
  ] as const) {
    const v = sp[key];
    if (v !== undefined && v !== "") out.set(key, v);
  }
  for (const [key, value] of carryParams(sp, ctx)) out.set(key, value);
  return out;
}
