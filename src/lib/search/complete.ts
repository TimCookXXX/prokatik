// Подсказки панели «Что» — дополнение запроса, как в поиске маркетплейса:
// «перф» → «перфоратор», «перфоратор мак» → «перфоратор makita». Объявлений и
// чисел подсказка не показывает: она ведёт в выдачу `/search` со всеми
// подходящими объявлениями, а не к одному продавцу (docs/decisions/0023).
//
// Как дополняется:
// 1. Дописывается последнее набранное слово; слова перед ним остаются как
//    набраны. После пробела в конце дописывать нечего: подсказка — сам
//    запрос, если по нему что-то есть.
// 2. Кандидаты — объявления, которые выдача (тот же движок, режим `results`,
//    без подмножеств) находит по словам перед последним; без них — все.
// 3. Слова для дописывания — только из заголовков кандидатов: по началу (с
//    раскладкой, транслитом, похожими буквами и синонимами), затем по основе,
//    опечатки — только если по началу ничего; подстрок нет никогда.
//    Опечатка в панели — только в слове, набранном целиком, и с теми же двумя
//    первыми буквами (SUGGEST_RULES): «перфаратор» → «перфоратор», но «палат»
//    — не «платье». Это же правило — у слов перед последним.
// 4. Мусор отсеивается (числа, единицы, предлоги, стоп-слова и города, редкая
//    латиница), формы одного слова сводятся по основе, показывается самое
//    частое написание из заголовков — с «ё», если так пишут продавцы.
// 5. Фраза попадает в подсказки, только если выдача по ней непуста — тем же
//    движком, что у `/search`; с датами сервер ещё сверяет свободу SQL-ом.
//    Выдача мягче панели (опечатки и против начала слова), поэтому набранная
//    фраза без дописывания ещё должна найтись и по правилам панели.

import { SYNONYM_GROUPS } from "./synonyms";
import { normalize, stem } from "./text";
import {
  CLEAR_MATCH, MAX_QUERY_WORDS, SUGGEST_RULES, hasSearchWords, queryTokens, tokenForms, wordScorer,
} from "./match";
import {
  Scorer, isBlankQuery, lowerBound, rankEntries, type IndexListing, type ListingIndex,
} from "./listing-index";

/** Сколько лучших кандидатов проверяется движком выдачи. */
export const MAX_EVALUATED = 8;
/** Ответов в кэше на один снимок индекса. */
const CACHE_SIZE = 500;

export interface Completion {
  /** Фраза для поля и для `q` выдачи: набранные слова и дописанное. */
  text: string;
  /** id объявлений, которые выдача нашла бы по фразе (не больше resultsLimit). */
  ids: string[];
  /** 0 — дописанное слово начинает заголовок или это латинское имя (бренд); 1 — прочие. */
  tier: number;
}

// ------------------------------------------------------------ мусор

/** Единицы измерения: «125 мм», «3 кВт», «2 Ач». */
const UNITS = new Set(["мм", "см", "м", "км", "кг", "г", "л", "вт", "квт", "ач", "в", "дюймов", "футов"]);

/** Служебные слова, которых нет в стоп-словах поиска. */
const FUNCTION_WORDS = new Set([
  "под", "над", "при", "или", "про", "для", "без", "как", "так", "что", "это", "его", "все", "всё",
  "через", "около", "возле", "перед", "после", "между", "либо", "тот", "эти",
]);

/** Однословные варианты синонимов: короткие («vr», «ps5») и латиница из них — не мусор. */
const SYNONYM_WORDS = new Set(
  SYNONYM_GROUPS.flat().map(normalize).filter((w) => w && !w.includes(" ")),
);

/**
 * Годится ли слово заголовка в дописанное. `afterTyped` — перед ним уже есть
 * набранные слова: артикул («hr2470») и редкий бренд уместны после «перфоратор
 * makita», но не первым словом. `freq` — в скольких заголовках индекса слово.
 */
function usable(word: string, freq: number, afterTyped: boolean, stopWords: ReadonlySet<string>): boolean {
  if (/^\d+$/.test(word) || UNITS.has(word) || stopWords.has(word) || FUNCTION_WORDS.has(word)) return false;
  if (SYNONYM_WORDS.has(word)) return true;
  if (word.length < 3) return false;
  if (/\d/.test(word)) return afterTyped;
  if (/^[a-z]+$/.test(word)) return freq >= 2 || afterTyped;
  return true;
}

// ------------------------------------------------------------ словарь заголовков

interface Lexicon {
  /** id слов заголовков (main.words) в порядке слов — для поиска по началу. */
  ids: number[];
  /** Сами слова в том же порядке. */
  words: string[];
  /** Нормализованное слово → самое частое написание в заголовках (нижний регистр, «ё» как есть). */
  spelling: Map<string, string>;
  /** Первое слово заголовка каждой записи. */
  first: string[];
  cache: Map<string, Completion[]>;
}

const lexicons = new WeakMap<ListingIndex<IndexListing>, Lexicon>();

/** Словарь заголовков снимка индекса — лениво, один раз на снимок. */
function lexicon(ix: ListingIndex<IndexListing>): Lexicon {
  let lex = lexicons.get(ix);
  if (lex) return lex;
  const { words: dict, own } = ix.main;
  const ids: number[] = [];
  for (let id = 0; id < dict.length; id++) if (own[id].length) ids.push(id);
  ids.sort((a, b) => (dict[a] < dict[b] ? -1 : dict[a] > dict[b] ? 1 : 0));

  // Те же куски, что даёт normalize: всё кроме букв и цифр — разделитель.
  const counts = new Map<string, Map<string, number>>();
  const first: string[] = [];
  for (const row of ix.listings) {
    const pieces = row.title.toLowerCase().split(/[^a-zа-яё0-9]+/).filter(Boolean);
    first.push(pieces.length ? pieces[0].replace(/ё/g, "е") : "");
    for (const piece of pieces) {
      const key = piece.replace(/ё/g, "е");
      let m = counts.get(key);
      if (!m) counts.set(key, (m = new Map()));
      m.set(piece, (m.get(piece) ?? 0) + 1);
    }
  }
  const spelling = new Map<string, string>();
  for (const [key, m] of counts) {
    // Чаще всего; при равенстве — с «ё» (её пишут осознанно), затем по алфавиту.
    const [best] = [...m].sort((a, b) =>
      b[1] - a[1] || Number(b[0] !== key) - Number(a[0] !== key) || (a[0] < b[0] ? -1 : 1));
    spelling.set(key, best[0]);
  }

  lex = { ids, words: ids.map((id) => dict[id]), spelling, first, cache: new Map() };
  lexicons.set(ix, lex);
  return lex;
}

// ------------------------------------------------------------ дополнение

/** Запрос как ключ: регистр и лишние пробелы не важны, пробел в конце — важен. */
function completionKey(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trimStart();
}

/** Ключ группы форм одного слова: «дрель» и «дрели», «перфоратор» и «перфоратора». */
const groupKey = (w: string) => stem(w).replace(/[ьй]$/, "");

/**
 * Дополнения запроса: фразы, по которым выдача непуста, лучшие первыми, не
 * больше MAX_EVALUATED. С `ids` каждой — чтобы сервер мог сверить свободу на
 * даты одним запросом. Кэш — на снимок индекса: новый индекс — новый кэш.
 */
export function completeQuery(
  ix: ListingIndex<IndexListing>, q: string, { resultsLimit }: { resultsLimit: number },
): Completion[] {
  const key = completionKey(q);
  if (isBlankQuery(key)) return [];
  const lex = lexicon(ix);
  const cacheKey = `${resultsLimit}|${key}`;
  const hit = lex.cache.get(cacheKey);
  if (hit) {
    // LRU: свежий — в конец.
    lex.cache.delete(cacheKey);
    lex.cache.set(cacheKey, hit);
    return hit;
  }
  const out = compute(ix, lex, key, resultsLimit);
  lex.cache.set(cacheKey, out);
  if (lex.cache.size > CACHE_SIZE) lex.cache.delete(lex.cache.keys().next().value!);
  return out;
}

function compute(ix: ListingIndex<IndexListing>, lex: Lexicon, key: string, resultsLimit: number): Completion[] {
  // Один Scorer на запрос и на правила: слова перед последним и все фразы
  // делят его кэш. `results` — выдача `/search`, `panel` — правила панели.
  const scorer = new Scorer(ix);
  const panelScorer = new Scorer(ix, SUGGEST_RULES);
  const results = (tokens: readonly string[]) =>
    rankEntries(ix, scorer, tokens, { mode: "results", limit: resultsLimit });
  const panel = (tokens: readonly string[]) =>
    rankEntries(ix, panelScorer, tokens, { mode: "results", limit: resultsLimit });
  // Фраза годится, только если выдача по ней непуста и в ней есть слова для
  // поиска: «прокат» выдача не ищет, а показывает весь город.
  const evaluate = (text: string): string[] =>
    hasSearchWords(text, ix.stopWords)
      ? results(queryTokens(text, ix.stopWords)).map(({ e }) => ix.listings[e].id)
      : [];

  // Дописывается последний кусок ввода — даже стоп-слово: «палатка по» ещё
  // может стать «палатка походная».
  const last = key.slice(key.lastIndexOf(" ") + 1);
  const typed = key.slice(0, key.length - last.length);
  const prev = hasSearchWords(typed, ix.stopWords) ? queryTokens(typed, ix.stopWords) : [];
  // После пробела (и после куска без букв и цифр: «дрель -») дописывать
  // нечего; а если слов уже MAX_QUERY_WORDS, выдача следующее не ищет, и
  // дописывать его бессмысленно. Подсказка тогда — сам набранный запрос.
  if (!normalize(last) || prev.length >= MAX_QUERY_WORDS) {
    const text = (normalize(last) ? key : typed).trim();
    if (!hasSearchWords(text, ix.stopWords) || panel(queryTokens(text, ix.stopWords)).length === 0) return [];
    const ids = evaluate(text);
    return ids.length ? [{ text, ids, tier: 0 }] : [];
  }

  // Кандидаты — то, что слова перед последним находят и в выдаче, и по
  // правилам панели: «палат » опечаткой не сужается до платьев.
  let candidates: Set<number> | null = null;
  if (prev.length) {
    const inResults = new Set(results(prev).map(({ e }) => e));
    candidates = new Set(panel(prev).map(({ e }) => e).filter((e) => inResults.has(e)));
    if (candidates.size === 0) return [];
  }

  const { words: dict, own } = ix.main;
  const accept = (id: number) =>
    (!candidates || own[id].some((e) => candidates.has(e)))
    && usable(dict[id], own[id].length, prev.length > 0, ix.stopWords);

  // Формы последнего слова одним куском: как набрано, раскладка, транслит,
  // похожие буквы, синонимы.
  const forms = tokenForms(last).filter((f) => f.parts.length === 1);
  const found = new Set<number>();
  const byPrefix = (prefixes: Iterable<string>) => {
    for (const p of prefixes) {
      for (let i = lowerBound(lex.words, p); i < lex.words.length && lex.words[i].startsWith(p); i++) {
        if (accept(lex.ids[i])) found.add(lex.ids[i]);
      }
    }
  };
  byPrefix(new Set(forms.map((f) => f.parts[0])));
  if (found.size === 0) {
    // Форма слова: «перфоратора» → «перфоратор».
    const stems = forms.map((f) => stem(f.parts[0])).filter((s, i) => s !== forms[i].parts[0]);
    byPrefix(new Set(stems));
  }
  if (found.size === 0) {
    // Опечатки — только когда яснее ничего нет (как withoutTypoNoise), и по
    // правилам панели: слово набрано целиком, первые две буквы те же. Оценка
    // ниже CLEAR_MATCH — это и есть опечатка; подстрока (ровно CLEAR_MATCH) — нет.
    const scorers = forms.map((f) => wordScorer(f.parts[0], f.weight < 1, SUGGEST_RULES));
    for (const id of lex.ids) {
      const typo = scorers.some((score) => {
        const s = score(dict[id]);
        return s > 0 && s < CLEAR_MATCH;
      });
      if (typo && accept(id)) found.add(id);
    }
  }
  if (found.size === 0) return [];

  // Формы одного слова — одна подсказка; показывается самая частая форма.
  const groups = new Map<string, { word: number; entries: Set<number>; starts: boolean }>();
  for (const id of found) {
    const g = groupKey(dict[id]);
    let group = groups.get(g);
    if (!group) groups.set(g, (group = { word: id, entries: new Set(), starts: false }));
    if (own[id].length > own[group.word].length) group.word = id;
    for (const e of own[id]) {
      if (candidates && !candidates.has(e)) continue;
      group.entries.add(e);
      if (lex.first[e] === dict[id]) group.starts = true;
    }
  }

  const ranked = [...groups.values()].map((g) => {
    const word = dict[g.word];
    return {
      text: `${typed}${lex.spelling.get(word) ?? word}`,
      tier: g.starts || /^[a-z]/.test(word) ? 0 : 1,
      count: g.entries.size,
    };
  });
  ranked.sort(byRank);

  const out: Completion[] = [];
  const seen = new Set<string>();
  for (const { text, tier } of ranked.slice(0, MAX_EVALUATED)) {
    const norm = normalize(text);
    if (seen.has(norm)) continue;
    seen.add(norm);
    const ids = evaluate(text);
    if (ids.length) out.push({ text, ids, tier });
  }
  return out.sort((a, b) => byRank(rankOf(a, a.ids), rankOf(b, b.ids)));
}

interface Rank {
  text: string;
  tier: number;
  /** Сколько объявлений найдёт фраза — только для порядка, наружу не уходит. */
  count: number;
}

const rankOf = (c: Completion, ids: readonly string[]): Rank => ({ text: c.text, tier: c.tier, count: ids.length });

const collator = new Intl.Collator("ru");

/** Слово, начинающее заголовок, или бренд — раньше; затем больше найденного; затем по алфавиту. */
function byRank(a: Rank, b: Rank): number {
  return a.tier - b.tier || b.count - a.count || collator.compare(a.text, b.text);
}

/**
 * Итог подсказок: с `free` (id, свободные на выбранные даты) — только фразы,
 * у которых есть свободные, и порядок по их числу. Число наружу не уходит.
 */
export function pickCompletions(
  list: readonly Completion[], limit: number, free?: ReadonlySet<string>,
): Completion[] {
  return list
    .map((c) => ({ ...c, ids: free ? c.ids.filter((id) => free.has(id)) : c.ids }))
    .filter((c) => c.ids.length > 0)
    .sort((a, b) => byRank(rankOf(a, a.ids), rankOf(b, b.ids)))
    .slice(0, limit);
}
