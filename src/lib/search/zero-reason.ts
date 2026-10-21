// Почему выдача /search пуста. Чистая функция: её зовёт SearchResults на пустой
// странице, а ответ уходит параметром цели Метрики `search_zero`. Причины
// разные по смыслу: «такого нет в каталоге» — спрос, которого нет, а «отсекли
// даты или фильтры» и «страница за концом списка» — нет.

export const ZERO_REASONS = [
  /** Индекс поиска упал, выдача шла аварийным ILIKE. */
  "index_failed",
  /** В запросе нет слов для поиска (одни стоп-слова) — показан весь город. */
  "stopwords",
  /** Индекс не нашёл ни одного совпадения. */
  "no_match",
  /** Совпадения или город есть, выдачу обнулили даты, раздел или фильтры. */
  "filtered",
  /** Номер страницы за концом списка. */
  "past_end",
  /** Запроса и фильтров нет, а в городе нечего арендовать. */
  "empty_city",
] as const;

export type ZeroReason = (typeof ZERO_REASONS)[number];

export interface ZeroReasonInput {
  /** Запрос выдачи; пусто — смотрят весь город. */
  q: string;
  /**
   * Ответ индекса (rankQuery в SearchResults): null — запроса нет, undefined —
   * индекс недоступен, `ids: null` — в запросе нет слов для поиска.
   */
  ranked: { ids: readonly string[] | null } | null | undefined;
  /** Номер страницы выдачи, с 1. */
  page: number;
  /** Сужена ли выдача чем-нибудь, кроме запроса: даты, раздел, фильтры. */
  narrowed: boolean;
}

/** Причина пустой страницы выдачи. Зовётся, только когда на странице ничего нет. */
export function zeroReason({ q, ranked, page, narrowed }: ZeroReasonInput): ZeroReason {
  // Первой — страница за концом: выдача сама по себе может быть и не пуста.
  if (page > 1) return "past_end";
  if (!q || ranked === null) return narrowed ? "filtered" : "empty_city";
  if (ranked === undefined) return "index_failed";
  if (ranked.ids === null) return "stopwords";
  if (ranked.ids.length === 0) return "no_match";
  return "filtered";
}
