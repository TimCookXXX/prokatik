// Клиент подсказок «Что»: GET /api/search/suggest с кэшем ответов и защитой
// порядка. Индекс живёт на сервере (docs/decisions/0022), здесь только доставка.
//
// Запрос в полёте не отменяется (AbortController): отмена отклоняет промис
// fetch, и обёртки fetch из расширений браузера выдают это необработанной
// ошибкой. Вместо отмены ответ сверяется — shouldApply ниже.

import type { SuggestResult } from "@/server/search";
import type { DateRange } from "@/lib/catalog/filters";

export type { SuggestCategory, SuggestItem, SuggestResult } from "@/server/search";

export const SUGGEST_DEBOUNCE_MS = 100;
const CACHE_SIZE = 50;
/**
 * Срок ответа в кэше — как `max-age` роута. Кэш живёт, пока жива вкладка, а
 * индекс на сервере меняется: без срока скрытое в кабинете объявление
 * подсказывалось бы по прежнему запросу до перезагрузки.
 */
const CACHE_TTL_MS = 30_000;

export const EMPTY_SUGGEST: SuggestResult = { items: [], categories: [] };

/** Запрос как ключ: регистр и лишние пробелы на ответ сервера не влияют. */
export function suggestQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

// LRU на Map: порядок вставки — порядок давности, свежий переезжает в конец.
const cache = new Map<string, { value: SuggestResult; at: number }>();
const inflight = new Map<string, Promise<SuggestResult | null>>();

// Даты — часть ключа: с ними сервер отсеивает занятые на эти дни.
const keyOf = (city: string, q: string, dates?: DateRange | null) =>
  `${city}|${q}|${dates?.from ?? ""}|${dates?.to ?? ""}`;

function remember(key: string, value: SuggestResult, at = Date.now()) {
  cache.delete(key);
  cache.set(key, { value, at });
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Ответ из кэша без сети — чтобы стирание и повторный набор не ждали дебаунса. */
export function cachedSuggest(city: string, q: string, dates?: DateRange | null): SuggestResult | undefined {
  const key = keyOf(city, suggestQuery(q), dates);
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  remember(key, hit.value, hit.at);
  return hit.value;
}

/**
 * Подсказки города по запросу; пустой запрос — популярные разделы. С датами в
 * подсказки идут только вещи, свободные на эти дни. null — ответа нет (429,
 * сеть, 5xx): поле показывает «подсказок нет», а строка «Показать все»
 * работает и так. Неудачи не кэшируются.
 */
export function fetchSuggest(city: string, q: string, dates?: DateRange | null): Promise<SuggestResult | null> {
  const query = suggestQuery(q);
  const key = keyOf(city, query, dates);
  const hit = cachedSuggest(city, query, dates);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;

  const params = new URLSearchParams({ city, q: query });
  if (dates) {
    params.set("from", dates.from);
    params.set("to", dates.to);
  }
  const request = fetch(`/api/search/suggest?${params}`)
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as SuggestResult;
      const value = { items: body.items ?? [], categories: body.categories ?? [] };
      remember(key, value);
      return value;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** Для тестов: кэш общий на модуль и иначе протекал бы между кейсами. */
export function _resetSuggestCache() {
  cache.clear();
  inflight.clear();
}

const extendsText = (prefix: string, text: string) => suggestQuery(text).startsWith(suggestQuery(prefix));

/**
 * Показывать ли пришедший ответ (перенос из sravniprokat). Ответы приходят не
 * по порядку: более старый, чем уже показанный, отбрасываем — список не
 * откатывается назад; ответ на текст, от которого человек ушёл (стёр или
 * исправил), — тоже. Ответ на начало набираемого текста показываем: он ближе к
 * вводу, чем прошлый список, а точный догонит.
 */
export function shouldApply(reply: { seq: number; q: string }, shownSeq: number, current: string): boolean {
  if (reply.seq <= shownSeq) return false;
  return extendsText(reply.q, current);
}

/**
 * Прошлый ответ ещё про этот ввод: текст дописан или стёрт с конца. Поле
 * очистили и набирают другое — прошлый список под новым началом не
 * показываем, даже на миг.
 */
export function sameTyping(replyQ: string, current: string): boolean {
  return extendsText(replyQ, current) || extendsText(current, replyQ);
}
