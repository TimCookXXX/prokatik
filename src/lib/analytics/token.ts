// Подписанные данные страницы. Что нашлось по запросу и какое объявление
// открыто, сервер считает при рендере сам — а пишет событие роут сбора по
// маяку браузера, уже после показа. Чтобы браузер не мог прислать «искал Х,
// нашлось 0» от себя, сервер подписывает посчитанное HMAC'ом, и роут без
// валидной подписи событие отбрасывает.
//
// Ключ — HKDF от NEXTAUTH_SECRET со своей меткой: новой переменной окружения
// нет, а подпись токена не годится ни для чего другого, где этот секрет
// работает. К id браузера подпись не привязана: после входа id меняется, а
// «Забронировать» на той же странице должно засчитаться. Повтор токена с
// чужих id ограничивает лимит заведения гостей (track_new).
//
// Содержимое не секрет (base64 JSON, его видно в HTML), и ничего, чего нет в
// адресе страницы, в нём нет. Текст запроса — уже маскированный.

import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { ZERO_REASONS } from "@/lib/search/zero-reason";
import { TRACK_TOKEN_TTL_HOURS } from "./limits";

/** Выдача /search: условия и что нашлось. */
const searchData = z.object({
  k: z.literal("search"),
  /** Запрос, маскированный (sanitizeQuery). Пусто — смотрел весь каталог. */
  q: z.string().max(200),
  /** По какой части запроса нашлось, если не по всему (маскированная). */
  usedQuery: z.string().max(200).nullable(),
  /** Сколько нашлось после фильтров. */
  total: z.number().int().nonnegative(),
  /** Совпадения индекса до фильтров; null — индекс не спрашивали или он упал. */
  matched: z.number().int().nonnegative().nullable(),
  /** Почему страница пуста; null — не пуста. */
  reason: z.enum(ZERO_REASONS).nullable(),
  /** Нашлось только по части слов запроса. */
  partial: z.boolean(),
  cityIds: z.array(z.string().max(40)).max(50),
  dates: z.boolean(),
  where: z.boolean(),
  /** Слаг корневого раздела, если выдача сужена им. */
  category: z.string().max(80).nullable(),
  /** Цена, залог, получение, «проверенные». */
  filters: z.boolean(),
  sort: z.string().max(20),
  page: z.number().int().positive(),
});

/** Страница объявления. */
const listingData = z.object({
  k: z.literal("listing"),
  listingId: z.string().min(1).max(40),
  dates: z.boolean(),
  where: z.boolean(),
});

// Время подписи — секундами. Лишние поля отклоняются: токен чужого формата
// (другой версии) не засчитывается.
const ts = { ts: z.number().int() };
const signedData = z.discriminatedUnion("k", [searchData.extend(ts).strict(), listingData.extend(ts).strict()]);

export type SearchPageData = z.infer<typeof searchData>;
export type ListingPageData = z.infer<typeof listingData>;
export type PageData = SearchPageData | ListingPageData;
export type SignedPageData = PageData & { ts: number };

/** Сколько секунд подпись может опережать часы сервера (рестарт, NTP). */
const CLOCK_SKEW_SEC = 5 * 60;

let key: Buffer | null = null;
function signingKey(): Buffer {
  key ??= Buffer.from(hkdfSync("sha256", getEnv().NEXTAUTH_SECRET, "", "inrenta analytics page token v1", 32));
  return key;
}

const mac = (body: string) => createHmac("sha256", signingKey()).update(body).digest();

/** Токен для TrackOnMount: `base64url(JSON).base64url(HMAC)`, время — секундами. */
export function signPageData(data: PageData, now: number = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...data, ts: Math.floor(now / 1000) })).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

/** Данные из токена; null — подпись не сходится, формат чужой или срок вышел. */
export function verifyPageData(token: string, now: number = Date.now()): SignedPageData | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const given = Buffer.from(signature, "base64url");
  const expected = mac(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const result = signedData.safeParse(parsed);
  if (!result.success) return null;
  const nowSec = Math.floor(now / 1000);
  const { ts } = result.data;
  if (ts > nowSec + CLOCK_SKEW_SEC || nowSec - ts > TRACK_TOKEN_TTL_HOURS * 60 * 60) return null;
  return result.data as SignedPageData;
}

/**
 * Ключ показа для TrackOnMount — данные без времени, коротким хэшем: тот же
 * ключ после router.refresh или Server Action — тот же показ, событие не
 * уходит второй раз.
 */
export function showKeyOf(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("base64url").slice(0, 16);
}

/** Только для тестов: ключ пересчитается из текущего окружения. */
export function _resetTokenKeyForTests(): void {
  key = null;
}
