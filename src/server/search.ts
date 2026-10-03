// Поиск «Что»: подсказки в панели и ранжирование выдачи /search. Оба идут по
// одному индексу (search-index.ts) и одному скорингу (lib/search), поэтому верх
// выдачи без фасетов совпадает с подсказками.

import { listingPath } from "@/lib/catalog/listing-path";
import {
  isBlankQuery, rankListings, rankResults, suggestCategories,
} from "@/lib/search/listing-index";
import { hasSearchWords, MAX_QUERY_LENGTH } from "@/lib/search/match";
import type { DateRange } from "@/lib/catalog/filters";
import { getCityBySlug, getFreeListingIds } from "@/server/catalog";
import { getSearchIndex } from "@/server/search-index";

/** Потолок совпадений выдачи: дальше фильтры, счёт и страницы считает SQL по этим id. */
export const RESULTS_LIMIT = 1000;
export const SUGGEST_LISTINGS = 6;
export const SUGGEST_CATEGORIES = 4;
/**
 * Сколько лучших кандидатов проверять на свободу, когда выбраны даты. Занятые
 * отсеиваются, в ответ идут первые SUGGEST_LISTINGS свободных; если свободных
 * среди них меньше — подсказок меньше, а не хуже по тексту.
 */
export const SUGGEST_DATE_CANDIDATES = 50;

export interface RankedIds {
  /**
   * id совпадений по релевантности, не больше RESULTS_LIMIT. null — в запросе
   * нет слов для поиска (одна буква, одни стоп-слова вроде «прокат в Казани»):
   * выдача без условия запроса, как /search без `q`. Подсказки такой запрос
   * ищут буквально (queryTokens), выдаче это дало бы пустую страницу.
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

export interface SuggestItem {
  id: string;
  title: string;
  priceDay: number;
  /** Канонический путь карточки без query: переносимые параметры дописывает клиент. */
  href: string;
  categoryName: string;
  photoUrl: string | null;
}

export interface SuggestCategory {
  name: string;
  /** Канонический путь раздела: `/{city}/{root}` или `/{city}/{root}/{sub}`. */
  href: string;
  count: number;
}

export interface SuggestResult {
  items: SuggestItem[];
  categories: SuggestCategory[];
}

/**
 * Подсказки панели «Что» в городе. Пустой или односимвольный запрос —
 * популярные разделы без объявлений. null — города нет или он отключён.
 * `cityIds` — набор городов индекса, когда он шире города (регион при точке
 * «Где»); по умолчанию — сам город. `dates` — уже разобранный диапазон
 * (parseDateRange): с ним в подсказки идут только свободные на все эти дни,
 * как и в выдаче с теми же датами. Счётчики разделов даты не учитывают.
 */
export async function suggestForCity(
  citySlug: string,
  q: string,
  { cityIds, dates }: { cityIds?: readonly string[]; dates?: DateRange } = {},
): Promise<SuggestResult | null> {
  const city = await getCityBySlug(citySlug);
  if (!city) return null;
  const { ix, categories, citySlugs } = await getSearchIndex(cityIds ?? [city.id]);

  let hits = rankListings(ix, q, {
    mode: "suggest", limit: dates ? SUGGEST_DATE_CANDIDATES : SUGGEST_LISTINGS,
  });
  if (dates && hits.length > 0) {
    const free = await getFreeListingIds(hits.map((h) => h.row.id), dates.from, dates.to);
    hits = hits.filter((h) => free.has(h.row.id)).slice(0, SUGGEST_LISTINGS);
  }

  const items: SuggestItem[] = [];
  for (const { row } of hits) {
    const category = categories.get(row.categoryId);
    const rowCity = citySlugs.get(row.cityId);
    // Строки без раздела или города не бывает (FK и join сборки); проверка —
    // чтобы подсказка не повела на битый путь, если справочник разошёлся.
    if (!category || !rowCity) continue;
    items.push({
      id: row.id,
      title: row.title,
      priceDay: row.priceDay,
      href: listingPath(rowCity, category.slug, row.slug, row.id),
      categoryName: category.name,
      photoUrl: row.photoUrl,
    });
  }

  const cats = suggestCategories(ix, q, SUGGEST_CATEGORIES).map((c) => ({
    name: c.category.name,
    href: `/${city.slug}/${c.slugs.join("/")}`,
    count: c.count,
  }));

  return { items, categories: cats };
}
