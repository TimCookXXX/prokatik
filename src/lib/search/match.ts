// Совпадение слова запроса со словами записи поиска «Что». Перенесено из
// sravniprokat (src/lib/compare/search.ts) без изменения поведения; новое —
// синонимы в формах слова, стоп-слова городов вместо зашитого «краснодара» и
// поле `extra` (описание объявления), где совпадение только точное, по началу
// или по основе.
//
// Здесь наивная версия: запись — списки слов, и каждое слово запроса
// сравнивается с каждым словом записи. Индекс города (listing-index.ts) считает
// то же самое через словарь уникальных слов; тест сверяет оба пути.

import { compact, editDistance, fixHomoglyphs, normalize, stem, switchLayout, transliterate } from "./text";
import { SYNONYM_GROUPS } from "./synonyms";

export const CONTEXT_WEIGHT = 0.6;
export const EXTRA_WEIGHT = 0.35;
const CONVERTED_WEIGHT = 0.95;
const SYNONYM_WEIGHT = 0.9;
const FUZZY = 0.8;

/**
 * Насколько слово запроса совпадает со словом записи; 0 — не совпадает.
 * `strict` — для раскладки, транслита и синонимов: опечатка только против слова
 * целиком, иначе «max» → «макс» ≈ «макита», а «бензорез» ≈ «бензогенератор».
 */
export function wordScore(t: string, w: string, strict = false): number {
  return wordScorer(t, strict)(w);
}

/**
 * Тот же wordScore с основой слова запроса, посчитанной один раз: индекс города
 * сравнивает одно слово запроса со всем словарём.
 */
export function wordScorer(t: string, strict = false): (w: string) => number {
  const s = stem(t);
  return (w) => {
    if (w === t) return 3;
    if (w.startsWith(t)) return 2 + 0.5 * (t.length / w.length);
    // Падеж и число: «перфоратора», «перфораторы», «моющего».
    if (s !== t && w.startsWith(s)) return 1.9;
    if (t.length >= 3 && w.includes(t)) return 1;
    if (t.length >= 4) {
      // Опечатки: против слова целиком (±1 буква) — до двух в длинном, одна в коротком;
      // против начала длинного слова (человек ещё печатает) — только одна.
      for (let len = t.length - 1; len <= t.length + 1; len++) {
        if (len > w.length) break;
        const whole = len >= w.length - 1;
        const max = whole ? (!strict && t.length >= 6 ? 2 : 1) : strict ? -1 : 1;
        if (max >= 0 && editDistance(t, w.slice(0, len), max) <= max) return FUZZY;
      }
    }
    return 0;
  };
}

/**
 * Совпадение со словом описания: только точное, по началу или по основе. Без
 * опечаток и подстрок — в длинном тексте они находили бы что угодно.
 */
export function extraWordScore(t: string, w: string): number {
  if (w === t) return 3;
  if (w.startsWith(t)) return 2 + 0.5 * (t.length / w.length);
  const s = stem(t);
  if (s !== t && w.startsWith(s)) return 1.9;
  return 0;
}

const best = (t: string, list: readonly string[], strict: boolean) =>
  list.reduce((m, w) => Math.max(m, wordScore(t, w, strict)), 0);

const bestExtra = (t: string, list: readonly string[]) =>
  list.reduce((m, w) => Math.max(m, extraWordScore(t, w)), 0);

// ------------------------------------------------------------ слова запроса

/** Слова запроса, которые не про вещь: «прокат перфоратора на выходные». */
const BASE_STOP_WORDS = [
  "прокат", "проката", "прокате", "напрокат", "аренда", "аренды", "аренду", "арендовать", "взять", "снять",
  "купить", "недорого", "дешево", "цена", "цены", "стоимость", "сколько", "стоит",
  "в", "во", "на", "для", "до", "с", "со", "от", "и", "по", "за", "без",
  "сутки", "день", "неделю", "выходные",
];

/**
 * Стоп-слова с названиями городов: «дрель в Краснодаре» ищет дрель. Города —
 * живые, в именительном и предложном падежах; составное название («Ростов-на-Дону»)
 * гасится и целиком, и по словам.
 */
export function stopWordSet(cityNames: readonly (string | null | undefined)[]): ReadonlySet<string> {
  const out = new Set(BASE_STOP_WORDS);
  for (const name of cityNames) {
    const n = name ? normalize(name) : "";
    if (!n) continue;
    out.add(n);
    for (const w of n.split(" ")) out.add(w);
  }
  return out;
}

/**
 * Потолок запроса. Заголовок объявления — до 200 знаков, длиннее запрос ничего
 * не найдёт. Слов — шесть: каждое слово сравнивается со всем словарём города
 * синхронно, на общем потоке процесса, и без потолка длинный запрос держал бы
 * его сотни миллисекунд. Слова после шестого не ищутся.
 */
export const MAX_QUERY_LENGTH = 200;
export const MAX_QUERY_WORDS = 6;

const splitQuery = (query: string) => query.split(/\s+/).filter((t) => normalize(t));

/**
 * Слова запроса без служебных; одни служебные — оставляем как есть (подсказка
 * «прокат» найдёт объявления со словом «прокат»). Не больше MAX_QUERY_WORDS.
 */
export function queryTokens(query: string, stopWords: ReadonlySet<string>): string[] {
  const all = splitQuery(query);
  const meaningful = all.filter((t) => !stopWords.has(normalize(t)));
  return (meaningful.length ? meaningful : all).slice(0, MAX_QUERY_WORDS);
}

/** Есть ли в запросе слово кроме служебных: «прокат в Казани» — нет. */
export function hasSearchWords(query: string, stopWords: ReadonlySet<string>): boolean {
  return splitQuery(query).some((t) => !stopWords.has(normalize(t)));
}

export interface TokenForm {
  parts: string[];
  weight: number;
}

/**
 * Группы синонимов по основе каждого однословного варианта. Основа совпадает
 * и у формы слова («болгарку» — «болгарка»), и у недонабранного слова с
 * коротким вариантом («перфо» — «перф»); второе — не синоним, поэтому по
 * основе сравниваются только слова от пяти букв, короче — только целиком.
 */
const SYNONYMS_BY_STEM = (() => {
  const map = new Map<string, { word: string; group: string[] }[]>();
  for (const g of SYNONYM_GROUPS) {
    const group = g.map(normalize).filter(Boolean);
    for (const word of group) {
      if (word.includes(" ")) continue;
      const key = stem(word);
      map.set(key, [...(map.get(key) ?? []), { word, group }]);
    }
  }
  return map;
})();

function synonymGroups(t: string): string[][] {
  return (SYNONYMS_BY_STEM.get(stem(t)) ?? [])
    .filter(({ word }) => word === t || (word.length >= 5 && t.length >= 5))
    .map(({ group }) => group);
}

/**
 * Варианты слова запроса: как есть, похожие буквы, раскладка, транслит,
 * раскладка + транслит, артикул слитно; затем синонимы каждого из них.
 */
export function tokenForms(raw: string): TokenForm[] {
  const seen = new Set<string>();
  const forms: TokenForm[] = [];
  const add = (s: string, weight: number) => {
    const n = normalize(s);
    if (!n || seen.has(n)) return;
    seen.add(n);
    forms.push({ parts: n.split(" "), weight });
  };
  add(raw, 1);
  add(fixHomoglyphs(raw), 1);
  const layout = switchLayout(raw);
  add(layout, CONVERTED_WEIGHT);
  for (const s of [raw, layout]) {
    const n = normalize(s);
    if (n && !n.includes(" ")) add(transliterate(n), CONVERTED_WEIGHT);
  }
  // Артикул слитно: «puzzi8/1» ищем и как «puzzi81».
  const joined = compact(raw);
  if (/\d/.test(joined)) add(joined, 1);
  // Синонимы: «болгарку» → «ушм», «ецм» (раскладка «ушм») → «болгарка».
  for (const f of [...forms]) {
    if (f.parts.length !== 1) continue;
    for (const group of synonymGroups(f.parts[0])) {
      for (const s of group) add(s, f.weight * SYNONYM_WEIGHT);
    }
  }
  return forms;
}

// ------------------------------------------------------------ запись

/** Слова записи поиска по полям; веса полей — CONTEXT_WEIGHT и EXTRA_WEIGHT. */
export interface MatchFields {
  /** Слова самой записи: заголовок объявления, имя раздела. */
  own: readonly string[];
  /** Слова контекста: раздел и корень объявления, корень раздела. */
  context: readonly string[];
  /** Слова описания: только точное совпадение, начало или основа. */
  extra?: readonly string[];
}

export interface TokenMatch {
  score: number;
  /** Слово совпало в самой записи не хуже, чем в контексте и описании. */
  own: boolean;
}

/**
 * Лучшее совпадение слова запроса (всеми его формами) с записью; null — не
 * совпало. Многословная форма совпадает, только если совпали все её части.
 * `withExtra: false` — описание не смотрим вовсе (подсказки).
 */
export function matchToken(forms: readonly TokenForm[], e: MatchFields, withExtra: boolean): TokenMatch | null {
  let result: TokenMatch | null = null;
  for (const f of forms) {
    let sum = 0;
    let own = true;
    let ok = true;
    const strict = f.weight < 1;
    for (const part of f.parts) {
      const o = best(part, e.own, strict);
      const c = best(part, e.context, strict) * CONTEXT_WEIGHT;
      const x = withExtra && e.extra ? bestExtra(part, e.extra) * EXTRA_WEIGHT : 0;
      if (o === 0 && c === 0 && x === 0) { ok = false; break; }
      if (o < Math.max(c, x)) own = false;
      sum += Math.max(o, c, x);
    }
    if (!ok) continue;
    const score = (sum / f.parts.length) * f.weight;
    if (!result || score > result.score) result = { score, own };
  }
  return result;
}

/** Все сочетания по k элементов в исходном порядке. */
export function subsets<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...subsets(rest, k - 1).map((s) => [head, ...s]), ...subsets(rest, k)];
}

/** Куски заголовка с подсветкой начал слов, совпавших с запросом (с учётом раскладки, транслита и синонимов). */
export function highlight(title: string, query: string): { text: string; hit: boolean }[] {
  const tokens = query.split(/\s+/).flatMap((t) => tokenForms(t).flatMap((f) => f.parts)).filter(Boolean);
  if (tokens.length === 0) return [{ text: title, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  const re = /[A-Za-zА-Яа-яЁё0-9]+|[^A-Za-zА-Яа-яЁё0-9]+/g;
  for (const [piece] of title.matchAll(re)) {
    const n = normalize(piece);
    const t = n ? tokens.filter((x) => n.startsWith(x)).sort((a, b) => b.length - a.length)[0] : undefined;
    if (t) {
      out.push({ text: piece.slice(0, t.length), hit: true });
      if (piece.length > t.length) out.push({ text: piece.slice(t.length), hit: false });
    } else {
      out.push({ text: piece, hit: false });
    }
  }
  return out;
}
