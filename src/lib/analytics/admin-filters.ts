// Фильтры страниц аналитики в админке — из searchParams. Адрес правит кто
// угодно, поэтому каждый параметр проходит zod и при мусоре падает в
// умолчание, а поиск гостя принимает только точный формат: цифры ClientID
// Метрики или UUID браузера. Чтения ищут по нему равенством, без LIKE.

import { z } from "zod";
import { isVisitorId } from "./visitor-cookie";

export const PERIOD_DAYS = [7, 30] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const periodSchema = z.enum(["7", "30"]).catch("7");
const allSchema = z.literal("1").optional().catch(undefined);
// id пользователя — ULID; символы шире, чтобы заведённые иначе id не ломали ссылку.
const userSchema = z.string().regex(/^[0-9A-Za-z_-]{1,64}$/).optional().catch(undefined);
const findSchema = z.string().trim().max(64).optional().catch(undefined);

// Курсор списка гостей — пара (last_seen_at, id) последней строки страницы.
// Время — текстом с микросекундами, как его отдала база: Date их бы срезал,
// и строки внутри одной миллисекунды выпали бы между страницами.
const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const cursorSchema = z.string().regex(CURSOR_RE).optional().catch(undefined);

export interface AnalyticsFilters {
  period: PeriodDays;
  /** Показывать ботов и свои заходы. */
  all: boolean;
}

export type VisitorFind = { kind: "cid"; value: string } | { kind: "vid"; value: string };

export interface ListCursor {
  /** after — страница старше курсора, before — новее. */
  dir: "after" | "before";
  at: string;
  id: string;
}

export interface VisitorListFilters extends AnalyticsFilters {
  find: VisitorFind | null;
  /** Что ввели в поиск, как есть: вернуть в поле. */
  findText: string;
  /** Поиск введён, но не ClientID и не UUID. */
  findInvalid: boolean;
  user: string | null;
  cursor: ListCursor | null;
}

export function parseAnalyticsFilters(sp: RawParams): AnalyticsFilters {
  return {
    period: Number(periodSchema.parse(first(sp.period))) as PeriodDays,
    all: allSchema.parse(first(sp.all)) === "1",
  };
}

/** Точный формат поиска: ClientID — только цифры, id браузера — UUID. */
export function parseFind(text: string): VisitorFind | null {
  if (/^\d{1,32}$/.test(text)) return { kind: "cid", value: text };
  if (isVisitorId(text)) return { kind: "vid", value: text.toLowerCase() };
  return null;
}

export function parseVisitorListFilters(sp: RawParams): VisitorListFilters {
  const findText = findSchema.parse(first(sp.find)) ?? "";
  const find = findText ? parseFind(findText) : null;
  const after = cursorSchema.parse(first(sp.after));
  const before = after ? undefined : cursorSchema.parse(first(sp.before));
  const raw = after ?? before;
  const match = raw ? CURSOR_RE.exec(raw) : null;
  return {
    ...parseAnalyticsFilters(sp),
    find,
    findText,
    findInvalid: findText !== "" && find === null,
    user: userSchema.parse(first(sp.user)) ?? null,
    cursor: match ? { dir: after ? "after" : "before", at: match[1], id: match[2] } : null,
  };
}

export const cursorParam = (at: string, id: string): string => `${at}_${id}`;

/** Адрес страницы с фильтрами: умолчания в адрес не пишутся. */
export function analyticsHref(
  base: string,
  f: Partial<AnalyticsFilters> & { find?: string; user?: string | null; after?: string; before?: string },
): string {
  const params = new URLSearchParams();
  if (f.period && f.period !== PERIOD_DAYS[0]) params.set("period", String(f.period));
  if (f.all) params.set("all", "1");
  if (f.user) params.set("user", f.user);
  if (f.find) params.set("find", f.find);
  if (f.after) params.set("after", f.after);
  if (f.before) params.set("before", f.before);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
