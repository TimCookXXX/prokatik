// Поиск «Что»: подсказки в панели и ранжирование выдачи /search. Оба идут по
// одному индексу (search-index.ts) и одному скорингу (lib/search): подсказка —
// дополненный запрос, и она показывается, только если выдача по ней непуста.

import {
  isBlankQuery, rankListings, rankResults, suggestCategories,
} from "@/lib/search/listing-index";
import { completeQuery, pickCompletions } from "@/lib/search/complete";
import { hasSearchWords, MAX_QUERY_LENGTH } from "@/lib/search/match";
import type { DateRange } from "@/lib/catalog/filters";
import { categoryPath } from "@/lib/catalog/listing-path";
import { getFreeSearchIds, type City } from "@/server/catalog";
import { getSearchIndex, type SearchIndex } from "@/server/search-index";

/** Потолок совпадений выдачи: дальше фильтры, счёт и страницы считает SQL по этим id. */
export const RESULTS_LIMIT = 1000;
export const SUGGEST_QUERIES = 6;
export const SUGGEST_CATEGORIES = 4;

export interface RankedIds {
  /**
   * id совпадений по релевантности, не больше RESULTS_LIMIT. null — в запросе
   * нет слов для поиска (одна буква, одни стоп-слова вроде «прокат в Казани»):
   * выдача без условия запроса, как /search без `q`: искать «прокат»
   * буквально дало бы пустую страницу. Подсказки такую фразу не предлагают.
   */
  ids: string[] | null;
  /** Запрос, по которому найдено: весь или его часть. */
  usedQuery: string;
  /** Слова, отброшенные ради непустой выдачи; пусто — нашлось по всему запросу. */
  dropped: string[];
}

/**
 * Выдача /search по набору городов: весь запрос, а при нуле — лучшая его часть
 * (подмножества слов). Совпадения только по описанию идут в хвосте.
 */
export async function rankListingIds(cityIds: readonly string[], q: string): Promise<RankedIds> {
  // Тот же потолок, что у роута подсказок: страница выдачи без лимитера.
  const query = q.trim().slice(0, MAX_QUERY_LENGTH);
  const { ix } = await getSearchIndex(cityIds);
  if (isBlankQuery(query) || !hasSearchWords(query, ix.stopWords)) {
    return { ids: null, usedQuery: query, dropped: [] };
  }
  const { hits, usedQuery, dropped } = rankResults(ix, query, RESULTS_LIMIT);
  return { ids: hits.map((h) => h.row.id), usedQuery, dropped };
}

export interface SuggestQuery {
  /** Дополненный запрос — его подставляют в поле. */
  text: string;
  /** `/search?q=…&city=…` без дат и «Где»: переносимые параметры дописывает клиент. */
  href: string;
}

export interface SuggestCategory {
  name: string;
  /** Канонический путь раздела: `/{city}/{root}` или `/{city}/{root}/{sub}`. */
  href: string;
}

export interface SuggestResult {
  queries: SuggestQuery[];
  categories: SuggestCategory[];
}

/**
 * Подсказки панели «Что» в городе: дополнения запроса и разделы, без
 * объявлений и без чисел. Пустой или односимвольный запрос — ничего.
 * `cityIds` — набор городов индекса, тот же, что у выдачи (getCityScope): с
 * точкой «Где» это весь регион; по умолчанию — сам город. Ссылки и запросов,
 * и разделов ведут в город страницы. `dates` — уже разобранный диапазон
 * (parseDateRange): с ним фраза остаётся, только если выдача на эти даты
 * непуста — SQL тех же условий, что у searchListings, одним запросом на все
 * фразы.
 */
export async function suggestForCity(
  city: Pick<City, "id" | "slug">,
  q: string,
  { cityIds, dates }: { cityIds?: readonly string[]; dates?: DateRange } = {},
): Promise<SuggestResult> {
  if (isBlankQuery(q)) return { queries: [], categories: [] };
  const scope = cityIds ?? [city.id];
  const { ix } = await getSearchIndex(scope);

  const completions = completeQuery(ix, q, { resultsLimit: RESULTS_LIMIT });
  let free: Set<string> | undefined;
  if (dates && completions.length > 0) {
    const ids = [...new Set(completions.flatMap((c) => c.ids))];
    free = await getFreeSearchIds(scope, ids, dates.from, dates.to);
  }
  const queries = pickCompletions(completions, SUGGEST_QUERIES, free).map(({ text }) => ({
    text,
    href: `/search?${new URLSearchParams({ q: text, city: city.slug })}`,
  }));

  const categories = suggestCategories(ix, q, SUGGEST_CATEGORIES).map((c) => ({
    name: c.category.name,
    href: categoryPath(city.slug, c.category, c.root),
  }));

  return { queries, categories };
}

/** Сколько чипов популярных запросов показывает главная. */
export const POPULAR_QUERIES_MAX = 8;

// Подсчёт чипов — при индексе, на котором он сделан: пока версия набора не
// сменилась, getSearchIndex отдаёт тот же объект, и главная берёт готовый
// список, а не прогоняет кандидатов через скоринг на каждый рендер. Новый
// индекс (правка, сверка версии, инвалидация) — новый ключ; старый подсчёт
// уходит вместе со старым индексом.
const popularMemo = new WeakMap<SearchIndex, { candidates: readonly string[]; list: string[] }>();

/**
 * Чипы «Часто ищут» под поиском hero: кандидаты из `candidates` (по порядку,
 * не больше POPULAR_QUERIES_MAX), по которым в городе есть хотя бы одно
 * объявление в режиме подсказок — чип не обещает пустую выдачу. Индекс тот же,
 * что у подсказок и выдачи. Любая ошибка — пустой список: чипы просто не
 * показываются, главная из-за них не падает.
 */
export async function getPopularQueries(cityId: string, candidates: readonly string[]): Promise<string[]> {
  try {
    const index = await getSearchIndex([cityId]);
    const memo = popularMemo.get(index);
    if (memo?.candidates === candidates) return memo.list;
    const list: string[] = [];
    for (const q of candidates) {
      if (list.length >= POPULAR_QUERIES_MAX) break;
      if (rankListings(index.ix, q, { mode: "suggest", limit: 1 }).length > 0) list.push(q);
    }
    popularMemo.set(index, { candidates, list });
    return list;
  } catch (e) {
    console.error("[search] popular queries failed:", (e as Error).message);
    return [];
  }
}
