// Разбор GET-параметров фильтров листинга. Отдельно от компонента,
// чтобы тестировать без рендера.

import type { ListingFilters } from "@/server/catalog";

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
  { value: "free", label: "Сначала свободные" },
  { value: "new", label: "Сначала новые" },
  { value: "price_asc", label: "Дешевле" },
  { value: "price_desc", label: "Дороже" },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]["value"];

/**
 * Контекст выдачи, от которого зависят сортировки. `q` — поисковый запрос
 * /search; страницы разделов его не передают, и «Подходящие» там нет.
 */
export interface SortContext {
  q?: string;
}

/** Сортировка, когда в адресе её нет: при запросе — по релевантности, иначе новые. */
export function defaultSort(ctx: SortContext = {}): SortValue {
  return ctx.q ? "relevance" : "new";
}

/** Сортировки, которые имеют смысл в этом контексте, — для меню и разбора адреса. */
export function sortOptionsFor(ctx: SortContext = {}) {
  return SORT_OPTIONS.filter((o) => o.value !== "relevance" || Boolean(ctx.q));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Диапазон дат из адреса. Обе границы обязаны быть валидными и упорядоченными,
// иначе фильтра нет: половинчатый диапазон молча сужал бы выдачу непонятно как.
function parseDateRange(sp: { from?: string; to?: string }): { from: string; to: string } | undefined {
  const { from, to } = sp;
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) return undefined;
  if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) return undefined;
  return from <= to ? { from, to } : undefined;
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
export function parseFilters(sp: CategorySearchParams, ctx: SortContext = {}): ListingFilters {
  const sort = sortOptionsFor(ctx).find((o) => o.value === sp.sort)?.value ?? defaultSort(ctx);
  const page = num(sp.page);
  const range = parseDateRange(sp);
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
    sort,
    page: page && page > 0 ? page : 1,
  };
}

// Параметры фильтров для ссылок (пагинация, сброс) — без page и без контекста
// поиска. Пустые значения не попадают: адрес не должен обрастать `deposit=`.
export function filterParams(sp: CategorySearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of [
    "price_min", "price_max", "deposit", "handover", "verified", "category",
    "from", "to", "view", "sort",
  ] as const) {
    const v = sp[key];
    if (v !== undefined && v !== "") out.set(key, v);
  }
  return out;
}
