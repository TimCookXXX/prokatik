// Очистка того, что браузер прислал в роут сбора, до записи в базу: адрес
// страницы, текст поиска, метки кампании, referrer.
//
// Правило — список разрешённых параметров, а не запретов: параметр, о котором
// этот модуль не знает, не пишется. Поэтому «Где» (`loc`, `la`, `src`, `lp` —
// точка и подпись адреса), токен сброса пароля, `from` у входа и любые новые
// параметры отпадают сами, без правки здесь. Текст, который пишет человек, —
// запрос и метки кампании — маскируется: телефон, почта, ник и ссылка в
// статистику не попадают.
//
// Личные разделы сворачиваются до названия раздела без id, адреса админки не
// пишутся вовсе.

import { safeCallback } from "@/lib/auth/safe-callback";
import { SORT_OPTIONS } from "@/lib/catalog/filters";

/** Длина колонки visitor_events.path. */
export const MAX_PATH_LENGTH = 300;
/** Длина колонки visitor_events.q. */
export const MAX_Q_LENGTH = 100;
const MAX_UTM_LENGTH = 50;
const MAX_HOST_LENGTH = 100;

const MASK = "***";

// utm_term — ключевая фраза Директа ({keyword} в шаблоне ссылок), utm_content —
// объявление кампании. Маскируются, как и остальные метки.
export const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export type UtmKey = (typeof UTM_PARAMS)[number];

/** Клик по рекламе: id клика не хранится, только чья реклама. */
const AD_CLICK_PARAMS: Record<string, string> = { yclid: "yandex", gclid: "google", fbclid: "facebook" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/i;
// Сегмент пути: слаг до 80 символов, у вещи — ещё `-{ULID}`.
const SEGMENT_RE = /^[a-z0-9][a-z0-9-]{0,119}$/i;
const PAGE_RE = /^\d{1,4}$/;

type ParamRule = (value: string) => string | null;
const asDate: ParamRule = (v) => (DATE_RE.test(v) ? v : null);
const asSlug: ParamRule = (v) => (SLUG_RE.test(v) ? v : null);
const asPage: ParamRule = (v) => (PAGE_RE.test(v) ? v : null);
const asSort: ParamRule = (v) => (SORT_OPTIONS.some((o) => o.value === v) ? v : null);
const asQuery: ParamRule = (v) => sanitizeQuery(v) || null;

// Что разрешено на каком виде страницы. Значения проверяются форматом: в
// `city=` или `sort=` можно вписать что угодно, а пишется только похожее на
// слаг, дату или номер, а сортировка — из её списка.
const SEARCH_PARAMS: Record<string, ParamRule> = {
  q: asQuery, city: asSlug, category: asSlug, from: asDate, to: asDate, sort: asSort, page: asPage,
};
const CATALOG_PARAMS: Record<string, ParamRule> = {
  from: asDate, to: asDate, sort: asSort, page: asPage,
};

// Личные разделы: адрес сводится к разделу. Внутри — id переписки, вещи,
// заявки, а в чужие руки (статистика читается в админке) им незачем.
const PRIVATE_SECTIONS = new Set(["chat", "cabinet", "profile"]);
// Не пишутся вовсе: админка (P5 — ни нашей статистикой, ни Метрикой) и служебное.
const NEVER = new Set(["admin", "api", "_next"]);
// Страницы без параметров: вход (`from`), сброс пароля (`token`), профиль
// человека, бан, политика. Пишется только путь.
const PLAIN = new Set(["login", "reset", "banned", "privacy", "sources", "u"]);

// Ссылка без схемы и www: «t.me/ivan», «vk.com/id1», «wa.me/7918…». Домен
// узнаётся по зоне из списка — так «1.5 м» и «hr2470» ссылками не становятся.
const BARE_LINK = new RegExp(
  "(?<![\\p{L}\\p{N}_@.-])(?:[\\p{L}\\p{N}-]+\\.)+"
    + "(?:ru|рф|su|com|net|org|me|io|info|biz|pro|online|site|store|shop|by|kz|ua|cc|ly|gl|link|tv|app|dev)"
    + "(?![\\p{L}\\p{N}-])(?:\\/\\S*)?",
  "giu",
);

/**
 * Маскирует в тексте то, что может назвать человека: почту, ссылку (и без
 * схемы — «t.me/ivan»), `@ник`, телефон — с +7 и 8 и без них, с пробелами,
 * дефисами и скобками, — и любые 5+ цифр подряд (номер договора, карты).
 * Модели вещей («HR2470», «18 В») короче и остаются.
 */
export function maskText(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, MASK)
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, MASK)
    .replace(BARE_LINK, MASK)
    .replace(/@[\p{L}\p{N}_.]{2,}/gu, MASK)
    .replace(/(?:\+7|\b8)[\s\-()]*\d(?:[\s\-()]*\d){9}\b/g, MASK)
    // Десять и больше цифр вперемешку с разделителями: телефон без +7 и 8.
    .replace(/\(?(?:\d[\s\-()]*){9}\d/g, MASK)
    .replace(/\d{5,}/g, MASK);
}

/** Текст поиска для колонки `q`: маска, пробелы, длина. */
export function sanitizeQuery(q: string): string {
  return maskText(q.replace(/\s+/g, " ").trim()).slice(0, MAX_Q_LENGTH).trim();
}

/** Сегмент пути, как его можно записать: слаг или `*`. */
function cleanSegment(segment: string): string {
  if (!SEGMENT_RE.test(segment) || /^\d{5,}$/.test(segment)) return "*";
  return segment;
}

/** Путь из прислали браузером → URL на заглушке или null, если путь не свой. */
function ownUrl(raw: string): URL | null {
  const safe = safeCallback(raw);
  // safeCallback на чужой и битый адрес отвечает "/": отличаем это от
  // настоящей главной по самому входу.
  if (safe === "/" && raw.split(/[?#]/, 1)[0] !== "/") return null;
  try {
    return new URL(safe, "http://path.invalid");
  } catch {
    return null;
  }
}

function pickParams(params: URLSearchParams, rules: Record<string, ParamRule>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, rule] of Object.entries(rules)) {
    const value = params.get(key);
    if (value === null) continue;
    const clean = rule(value);
    if (clean !== null) out.set(key, clean);
  }
  return out;
}

// Query в читаемом виде: кириллица запроса остаётся буквами, а не %D0%BF —
// так путь короче вшестеро и читается в админке как есть. Кодируются только
// символы, ломающие разбор; URLSearchParams читает такую строку обратно.
const encodeValue = (v: string) => v.replace(/[%&=#+]/g, (c) => encodeURIComponent(c)).replace(/ /g, "+");

function formatQuery(entries: [string, string][]): string {
  return entries.map(([k, v]) => `${k}=${encodeValue(v)}`).join("&");
}

/** Путь с параметрами в пределах колонки: лишнее срезается с хвоста параметров. */
function fit(pathname: string, params: URLSearchParams): string {
  const cut = pathname.slice(0, MAX_PATH_LENGTH);
  const entries = [...params];
  while (entries.length > 0) {
    const full = `${cut}?${formatQuery(entries)}`;
    if (full.length <= MAX_PATH_LENGTH) return full;
    entries.pop();
  }
  return cut;
}

/**
 * Адрес страницы для колонки `path`: только свой путь, параметры — из списка
 * разрешённых для этого вида страницы. null — не писать (админка, чужой или
 * битый адрес).
 */
export function sanitizePath(raw: string): string | null {
  const url = ownUrl(raw);
  if (!url) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const [first] = segments;
  if (NEVER.has(first)) return null;
  if (PRIVATE_SECTIONS.has(first)) return `/${first}`;
  const pathname = `/${segments.map(cleanSegment).join("/")}`;
  if (first === "search") return fit(pathname, pickParams(url.searchParams, SEARCH_PARAMS));
  if (PLAIN.has(first) || segments.length > 3) return fit(pathname, new URLSearchParams());
  // Город, раздел, подраздел или вещь.
  return fit(pathname, pickParams(url.searchParams, CATALOG_PARAMS));
}

/** С чем пришёл человек: хост referrer, разрешённые метки кампании, рекламный клик. */
export interface Entry {
  /** Хост без `www.`; у приложения Android — имя пакета. null — referrer нет. */
  ref: string | null;
  utm: Partial<Record<UtmKey, string>>;
  /** Чья реклама дала клик (по yclid/gclid/fbclid); сам id клика не хранится. */
  ad: string | null;
}

/** Хост referrer'а: http(s) и `android-app://пакет`; прочее — нет referrer'а. */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (!["http:", "https:", "android-app:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host ? host.slice(0, MAX_HOST_LENGTH) : null;
  } catch {
    return null;
  }
}

/** Вход первой загрузки документа: метки — из адреса страницы, хост — из referrer'а. */
export function entryOf(rawPath: string, referrer: string | null | undefined): Entry {
  const url = ownUrl(rawPath);
  const utm: Entry["utm"] = {};
  let ad: string | null = null;
  if (url) {
    for (const key of UTM_PARAMS) {
      const value = url.searchParams.get(key);
      const clean = value === null ? "" : maskText(value.trim()).slice(0, MAX_UTM_LENGTH).trim();
      if (clean) utm[key] = clean;
    }
    for (const [key, owner] of Object.entries(AD_CLICK_PARAMS)) {
      if (url.searchParams.has(key)) {
        ad = owner;
        break;
      }
    }
  }
  return { ref: referrerHost(referrer), utm, ad };
}
