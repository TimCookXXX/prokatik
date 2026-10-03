// Индекс поиска «Что» одного города: объявления и разделы. Строится сервером из
// активных объявлений (src/server/search-index.ts) и живёт в памяти процесса;
// здесь — чистая часть без БД.
//
// Запись объявления: `own` — слова заголовка, `context` — раздел, корень и
// keywords раздела (вес CONTEXT_WEIGHT), `extra` — первые слова описания (вес
// EXTRA_WEIGHT, только точное совпадение, начало или основа). Каждое слово
// запроса обязано совпасть. В подсказки объявление идёт, только если все слова
// совпали в заголовке или разделе; выдаче `/search` хватает и описания, но такие
// совпадения стоят после всех остальных. Поэтому верх выдачи без фасетов — это
// ровно подсказки.
//
// Скорость. Наивный перебор (match.ts) сравнивал бы каждое слово запроса с
// каждым словом каждой записи. Здесь слова записей сведены в словарь
// уникальных слов города с постингами: слово запроса сравнивается с каждым
// уникальным словом один раз, оценка расходится по записям. Результат тот же
// до бита — тест сверяет с наивным перебором.

import { categoryKeywords } from "@/lib/seed/categories";
import { compact, stem, words } from "./text";
import {
  CONTEXT_WEIGHT, EXTRA_WEIGHT, extraWordScore, queryTokens, stopWordSet, subsets, tokenForms, wordScorer,
  matchToken, type MatchFields, type TokenForm,
} from "./match";

/** Сколько слов описания попадает в индекс. */
export const DESCRIPTION_WORDS = 50;
const CATEGORY_BONUS = 0.2;

export interface IndexListing {
  id: string;
  title: string;
  description: string | null;
  categoryId: string;
  createdAt: Date;
}

export interface IndexCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
}

export interface ListingHit<T extends IndexListing> {
  row: T;
  score: number;
  /** Совпало только с описанием: в подсказки не идёт, в выдаче — в хвосте. */
  byDescription: boolean;
}

export interface CategoryHit {
  category: IndexCategory;
  /** Корень подраздела; у корня — null. */
  root: IndexCategory | null;
  /** Слаги пути от корня: `[root]` или `[root, sub]`. */
  slugs: string[];
  /** Активных объявлений в разделе (у корня — вместе с подразделами). */
  count: number;
  score: number;
}

interface CategoryEntry extends Omit<CategoryHit, "score"> {
  fields: MatchFields;
}

/** Слова одного поля всех записей: словарь уникальных слов и записи на каждое слово. */
interface Postings {
  words: string[];
  entries: number[][];
}

export interface ListingIndex<T extends IndexListing = IndexListing> {
  stopWords: ReadonlySet<string>;
  listings: readonly T[];
  /** createdAt в мс — сортировка не создаёт Date на каждое сравнение. */
  created: Float64Array;
  /** Заголовок и раздел: один словарь, у каждого слова — два списка записей. */
  main: { words: string[]; own: number[][]; context: number[][] };
  /** Описание: словарь отсортирован — совпадение только по началу, ищется двоичным поиском. */
  extra: Postings;
  categories: CategoryEntry[];
}

/** Поля записи объявления — и для индекса, и для наивной сверки в тестах. */
export function listingFields(
  row: Pick<IndexListing, "title" | "description">,
  category: IndexCategory | undefined,
  root: IndexCategory | undefined,
): Required<MatchFields> {
  return {
    own: uniq(words(row.title)),
    context: uniq(words(category?.name, root?.name, ...(category ? categoryKeywords(category.slug) : []))),
    extra: uniq(words(row.description).slice(0, DESCRIPTION_WORDS)),
  };
}

const uniq = (list: string[]) => [...new Set(list)];

/**
 * Индекс города. `rows` — активные объявления, `categories` — всё дерево,
 * `counts` — активных объявлений по id раздела, `cityNames` — названия активных
 * городов в обоих падежах (стоп-слова, снимаются в момент сборки).
 */
export function buildListingIndex<T extends IndexListing>(
  rows: readonly T[],
  categories: readonly IndexCategory[],
  counts: ReadonlyMap<string, number>,
  cityNames: readonly (string | null | undefined)[],
): ListingIndex<T> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const rootOf = (c: IndexCategory) => (c.parentId ? byId.get(c.parentId) : undefined);

  const mainIds = new Map<string, number>();
  const main = { words: [] as string[], own: [] as number[][], context: [] as number[][] };
  const mainId = (w: string) => {
    let id = mainIds.get(w);
    if (id === undefined) {
      id = main.words.length;
      mainIds.set(w, id);
      main.words.push(w);
      main.own.push([]);
      main.context.push([]);
    }
    return id;
  };
  const extraMap = new Map<string, number[]>();
  const created = new Float64Array(rows.length);

  rows.forEach((row, i) => {
    const category = byId.get(row.categoryId);
    const f = listingFields(row, category, category && rootOf(category));
    for (const w of f.own) main.own[mainId(w)].push(i);
    for (const w of f.context) main.context[mainId(w)].push(i);
    for (const w of f.extra) {
      const list = extraMap.get(w);
      if (list) list.push(i); else extraMap.set(w, [i]);
    }
    created[i] = row.createdAt.getTime();
  });

  // Порядок строк — кодовые единицы UTF-16, как у сравнения `<` в поиске диапазона.
  const extraWords = [...extraMap.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // Корень считает и свои объявления, и подразделов.
  const total = new Map<string, number>();
  for (const c of categories) {
    const n = counts.get(c.id) ?? 0;
    if (!n) continue;
    total.set(c.id, (total.get(c.id) ?? 0) + n);
    const root = rootOf(c);
    if (root) total.set(root.id, (total.get(root.id) ?? 0) + n);
  }
  const categoryEntries: CategoryEntry[] = [];
  for (const c of categories) {
    const count = total.get(c.id) ?? 0;
    if (!count) continue;
    const root = rootOf(c) ?? null;
    categoryEntries.push({
      category: c,
      root,
      slugs: root ? [root.slug, c.slug] : [c.slug],
      count,
      fields: { own: uniq(words(c.name, ...categoryKeywords(c.slug))), context: uniq(words(root?.name)) },
    });
  }

  return {
    stopWords: stopWordSet(cityNames),
    listings: rows,
    created,
    main,
    extra: { words: extraWords, entries: extraWords.map((w) => extraMap.get(w)!) },
    categories: categoryEntries,
  };
}

// ------------------------------------------------------------------ поиск

/** Слишком короткий запрос — не запрос: одна буква «находит» случайное слово. */
export function isBlankQuery(q: string): boolean {
  return compact(q).length < 2;
}

/** Лучшая оценка слова запроса по каждой записи, отдельно по полям. */
interface PartHits {
  own: Map<number, number>;
  context: Map<number, number>;
  extra: Map<number, number> | null;
}

const maxInto = (map: Map<number, number>, entries: readonly number[], s: number) => {
  for (const e of entries) {
    const prev = map.get(e);
    if (prev === undefined || s > prev) map.set(e, s);
  }
};

function lowerBound(sorted: readonly string[], key: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < key) lo = mid + 1; else hi = mid;
  }
  return lo;
}

class Scorer {
  private cache = new Map<string, PartHits>();

  constructor(private ix: ListingIndex<IndexListing>) {}

  hits(part: string, strict: boolean, withExtra: boolean): PartHits {
    const key = `${strict ? 1 : 0}${part}`;
    let h = this.cache.get(key);
    if (!h) {
      h = { own: new Map(), context: new Map(), extra: null };
      const score = wordScorer(part, strict);
      const { words: dict, own, context } = this.ix.main;
      for (let id = 0; id < dict.length; id++) {
        const s = score(dict[id]);
        if (s === 0) continue;
        maxInto(h.own, own[id], s);
        maxInto(h.context, context[id], s);
      }
      this.cache.set(key, h);
    }
    if (withExtra && !h.extra) {
      // Совпадение с описанием — только по началу слова (самого или его основы),
      // а основа — начало самого слова: достаточно слов, начинающихся с основы.
      h.extra = new Map();
      const { words: dict, entries } = this.ix.extra;
      const prefix = stem(part);
      for (let id = lowerBound(dict, prefix); id < dict.length && dict[id].startsWith(prefix); id++) {
        const s = extraWordScore(part, dict[id]);
        if (s > 0) maxInto(h.extra, entries[id], s);
      }
    }
    return h;
  }
}

/**
 * Записи, где совпали все слова запроса, с суммой оценок слов — то же, что
 * matchToken по каждой записи (match.ts), только через словарь.
 */
function scoreListings(
  scorer: Scorer, forms: readonly TokenForm[][], withExtra: boolean,
): Map<number, number> {
  let acc: Map<number, number> | null = null;
  for (const tokenForms of forms) {
    const tokenBest = new Map<number, number>();
    for (const f of tokenForms) {
      const strict = f.weight < 1;
      const parts = f.parts.map((p) => scorer.hits(p, strict, withExtra));
      const first = parts[0];
      const candidates = new Set<number>(first.own.keys());
      for (const e of first.context.keys()) candidates.add(e);
      if (withExtra) for (const e of first.extra!.keys()) candidates.add(e);
      for (const e of candidates) {
        if (acc && !acc.has(e)) continue;
        let sum = 0;
        let ok = true;
        for (const h of parts) {
          const o = h.own.get(e) ?? 0;
          const c = (h.context.get(e) ?? 0) * CONTEXT_WEIGHT;
          const x = withExtra ? (h.extra!.get(e) ?? 0) * EXTRA_WEIGHT : 0;
          if (o === 0 && c === 0 && x === 0) { ok = false; break; }
          sum += Math.max(o, c, x);
        }
        if (!ok) continue;
        const score = (sum / f.parts.length) * f.weight;
        const prev = tokenBest.get(e);
        if (prev === undefined || score > prev) tokenBest.set(e, score);
      }
    }
    const next = new Map<number, number>();
    for (const [e, m] of tokenBest) {
      const prev = acc?.get(e);
      if (!acc) next.set(e, m);
      else if (prev !== undefined) next.set(e, prev + m);
    }
    acc = next;
    if (acc.size === 0) break;
  }
  return acc ?? new Map();
}

export interface RankOptions {
  /** `suggest` — только заголовок и раздел; `results` — ещё и описание, в хвосте. */
  mode: "suggest" | "results";
  limit: number;
}

/** Объявления по запросу: оценка по убыванию, затем новые раньше. */
export function rankListings<T extends IndexListing>(
  ix: ListingIndex<T>, q: string, options: RankOptions,
): ListingHit<T>[] {
  if (isBlankQuery(q)) return [];
  return rankTokens(ix, new Scorer(ix), queryTokens(q, ix.stopWords), options);
}

/**
 * rankListings по готовым словам запроса. Scorer передаётся снаружи: подмножества
 * запроса в rankResults делят его кэш, и словарь по каждому слову
 * просматривается один раз на запрос, а не на каждое подмножество.
 */
function rankTokens<T extends IndexListing>(
  ix: ListingIndex<T>, scorer: Scorer, tokens: readonly string[], { mode, limit }: RankOptions,
): ListingHit<T>[] {
  if (tokens.length === 0) return [];
  const forms = tokens.map(tokenForms);
  const order = (scores: Map<number, number>, skip?: ReadonlySet<number>) =>
    [...scores]
      .filter(([e]) => !skip?.has(e))
      .map(([e, sum]) => ({ e, score: sum / tokens.length }))
      .sort((a, b) => b.score - a.score || ix.created[b.e] - ix.created[a.e] || a.e - b.e);

  const main = order(scoreListings(scorer, forms, false));
  const out: ListingHit<T>[] = main.slice(0, limit).map(({ e, score }) => ({ row: ix.listings[e], score, byDescription: false }));
  if (mode === "results" && out.length < limit) {
    const matched = new Set(main.map(({ e }) => e));
    for (const { e, score } of order(scoreListings(scorer, forms, true), matched).slice(0, limit - out.length)) {
      out.push({ row: ix.listings[e], score, byDescription: true });
    }
  }
  return out;
}

export interface RankedResults<T extends IndexListing> {
  hits: ListingHit<T>[];
  /** Запрос, по которому найдено: весь или его часть. */
  usedQuery: string;
  /** Слова запроса, отброшенные ради непустой выдачи. */
  dropped: string[];
}

/**
 * Выдача `/search`: весь запрос, а если он из двух и больше слов ничего не
 * нашёл — лучшая часть запроса, от n−1 слов до одного. Лучшая — с самым сильным
 * первым совпадением (совпадение по заголовку сильнее любого по описанию).
 * Слов не больше MAX_QUERY_WORDS, поэтому подмножеств не больше 62.
 */
export function rankResults<T extends IndexListing>(
  ix: ListingIndex<T>, q: string, limit: number,
): RankedResults<T> {
  const query = q.trim();
  if (isBlankQuery(query)) return { hits: [], usedQuery: query, dropped: [] };
  const options: RankOptions = { mode: "results", limit };
  const scorer = new Scorer(ix);
  const tokens = queryTokens(query, ix.stopWords);
  const full = rankTokens(ix, scorer, tokens, options);
  if (full.length || tokens.length < 2) return { hits: full, usedQuery: query, dropped: [] };

  const indices = tokens.map((_, i) => i);
  for (let k = tokens.length - 1; k >= 1; k--) {
    let best: { part: number[]; hits: ListingHit<T>[] } | null = null;
    for (const part of subsets(indices, k)) {
      const sub = part.map((i) => tokens[i]);
      // Часть из одной буквы — не запрос, как и весь запрос из одной буквы.
      if (isBlankQuery(sub.join(" "))) continue;
      const hits = rankTokens(ix, scorer, sub, options);
      if (hits.length && (!best || stronger(hits[0], best.hits[0]))) best = { part, hits };
    }
    if (best) {
      const kept = new Set(best.part);
      return {
        hits: best.hits,
        usedQuery: best.part.map((i) => tokens[i]).join(" "),
        dropped: tokens.filter((_, i) => !kept.has(i)),
      };
    }
  }
  return { hits: [], usedQuery: query, dropped: [] };
}

const stronger = (a: ListingHit<IndexListing>, b: ListingHit<IndexListing>) =>
  a.byDescription !== b.byDescription ? !a.byDescription : a.score > b.score;

// ------------------------------------------------------------------ разделы

/**
 * Разделы по запросу: хотя бы одно слово должно попасть в имя или keywords
 * раздела, а не только в его корень. Бонус — как у прокатов в sravniprokat:
 * за то, что раздел вообще есть в городе, и за число объявлений в нём.
 * Пустой или односимвольный запрос — популярные подразделы.
 */
export function suggestCategories(ix: ListingIndex, q: string, limit = 4): CategoryHit[] {
  if (isBlankQuery(q)) return popularCategories(ix, limit);
  const tokens = queryTokens(q, ix.stopWords);
  if (tokens.length === 0) return [];
  const forms = tokens.map(tokenForms);
  const scored: CategoryHit[] = [];
  for (const entry of ix.categories) {
    let sum = 0;
    let anyOwn = false;
    let ok = true;
    for (const f of forms) {
      const m = matchToken(f, entry.fields, false);
      if (!m) { ok = false; break; }
      sum += m.score;
      anyOwn ||= m.own;
    }
    if (!ok || !anyOwn) continue;
    const { fields: _fields, ...hit } = entry;
    scored.push({ ...hit, score: sum / forms.length + CATEGORY_BONUS + Math.min(entry.count, 20) * 0.01 });
  }
  // Сортировка устойчивая: при равенстве — порядок дерева.
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Подразделы с наибольшим числом объявлений в городе. */
export function popularCategories(ix: ListingIndex, limit = 4): CategoryHit[] {
  return ix.categories
    .filter((c) => c.root)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ fields: _fields, ...hit }) => ({ ...hit, score: 0 }));
}
