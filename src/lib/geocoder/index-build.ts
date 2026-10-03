// Поисковый индекс в памяти из GeoIndexData: словарь слов названий (точно / основа / фонетика /
// опечатки / начало слова), формы названий улиц, пунктов и POI, дома по улицам в типизированных массивах.

import { haversineKm } from "@/lib/geo/point";
import { houseKey, houseParts } from "./house-number";
import { letterMask } from "./fuzzy";
import {
  fold, functionKind, GIVEN_NAMES, joinHyphens, latinNameToRu, nameWords, phoneticKey, PLACE_TYPES, POI_KIND_WORDS, POI_TYPES,
  stemWord, STREET_TYPES, TITLES, translitToRu,
} from "./text";
import type { AddrPrecision, GeoIndexData, IndexPlace, PlaceKind } from "./types";

export const ENT_STREET = 0;
export const ENT_PLACE = 1;
export const ENT_POI = 2;

export interface PlaceRec {
  id: string;
  name: string;
  kind: PlaceKind;
  parent: number;
  /** Населённый пункт, к которому относится (для микрорайона — город); сам себе для пунктов. */
  settlement: number;
  lat: number;
  lon: number;
  /** Радиус застройки, км: расстояние до пункта считается от края, а не от центра. */
  radiusKm: number;
  houses: number;
}

export interface StreetRec {
  idx: number;
  id: string;
  name: string;
  /** Пункт, где больше всего домов улицы (СНТ внутри города), иначе пункт улицы. */
  area: number;
  /** Ядро названия без типа: «красная», «40 лет победы». */
  core: string;
  type: string;
  place: number;
  lat: number;
  lon: number;
  houses: number;
  /** Дома улицы — отрезок [start, end) в `order`. */
  start: number;
  end: number;
  /** Род порядкового числа в названии: «1-я Заречная» — f, «1-й Заречный проезд» — m; нет числа — "". */
  ordGender: "" | "f" | "m" | "n";
  /**
   * Та же улица под другим именем в том же месте (тип и ядро без имён и званий совпадают: «улица Митрофана Седина»
   * из ГАР и «улица Седина» из OSM) — у двойника можно взять точку дома, если у своей только точка улицы.
   */
  twins: number[];
  /** В том же пункте есть улица с тем же ядром другого типа («улица Есенина» и «переулок Есенина»). */
  typeSibling: boolean;
}

export interface PoiRec {
  id: string;
  name: string;
  kind: string;
  place: number;
  lat: number;
  lon: number;
  address: string | null;
}

export interface FormRec {
  /** entity = индекс × 4 + вид (ENT_*). */
  ent: number;
  words: Int32Array;
  weights: Float32Array;
  total: number;
  /** Необязательные слова (битовая маска позиций): звания, имена, инициалы — «Покрышкина» = «Александра Покрышкина». */
  optional: number;
  /** Форма — синоним (не основное название): при равенстве основное название выше. */
  alias: boolean;
  /**
   * Составная форма объекта — одно слово, которого нет в его названиях из нескольких слов: сокращение («ккб»,
   * «кубгту», «стадц») или название слитно («озмолл»). Её начало при наборе — не начало названия: «стад» ≠ «Стационар…».
   */
  compound: boolean;
}

/**
 * Слово названия, без которого улицу тоже ищут: личное имя («Александра Покрышкина» = «Покрышкина»), инициал
 * («Посадского В.А.» = «Посадского»).
 */
export function optionalWord(w: string): boolean {
  return GIVEN_NAMES.has(w) || /^[а-я]$/.test(w);
}

/**
 * Мусор ГАР в названии улицы: «улица Сливовая улица( СНТ Кубаночка)», «Заречная (кст Надежда)» — скобки и
 * повтор типа прочь: «улица Сливовая», «Заречная».
 */
export function cleanStreetName(name: string, type: string): string {
  if (!/[()]/.test(name)) return name;
  let s = name.replace(/\s*\([^)]*\)?/g, " ").replace(/\s+/g, " ").trim();
  const t = fold(type);
  if (t) {
    const words = s.split(" ");
    // тип дважды: «улица Сливовая улица» → «улица Сливовая»
    if (words.length > 2 && fold(words[0]) === t && fold(words[words.length - 1]) === t) s = words.slice(0, -1).join(" ");
  }
  return s || name;
}

export interface Vocab {
  words: string[];
  ids: Map<string, number>;
  stems: string[];
  stemIds: Map<string, number>;
  /** Слова с той же основой. */
  stemWords: number[][];
  wordStem: Int32Array;
  byPhon: Map<string, number[]>;
  /** Индексы слов по алфавиту — для поиска по началу слова. */
  sorted: Int32Array;
  /** Слова и основы по длине — для опечаток. */
  wordsByLen: number[][];
  stemsByLen: number[][];
  wordMask: Uint32Array;
  stemMask: Uint32Array;
  /** «Вес» слова: сколько домов у объектов с ним — для начала слова из 1–2 букв. */
  mass: Float32Array;
  /** Число — часть названия («1 Мая»). */
  numeric: Uint8Array;
}

export const PREC: AddrPrecision[] = ["house", "interpolated", "street", "place"];

export interface SearchIndex {
  version: string;
  citySlug: string;
  places: PlaceRec[];
  streets: StreetRec[];
  pois: PoiRec[];
  forms: FormRec[];
  postings: Int32Array[];
  vocab: Vocab;
  /** Дома: сначала по улицам (отрезки StreetRec), затем адреса без улицы по пунктам. */
  hLat: Float64Array;
  hLon: Float64Array;
  hNum: Int32Array;
  hPrec: Uint8Array;
  hPlace: Int32Array;
  /** Почтовый индекс дома числом (0 — нет). */
  hPost: Int32Array;
  hKey: string[];
  hRaw: string[];
  /** Адреса по пункту без улицы: пункт → [start, end). */
  placeHouses: Map<number, [number, number]>;
  /** Центр по умолчанию — крупнейший город. */
  center: { lat: number; lon: number };
  cityPlace: number;
}

export const SETTLEMENT_KINDS = new Set<PlaceKind>(["city", "town", "village", "hamlet"]);

/** Слова ядра названия улицы: тип (один, совпадающий с `type` или крайний) прочь. */
function streetCore(name: string, type: string): { words: string[]; typeWord: string | null } {
  const words = nameWords(name);
  const t = fold(type);
  // тип — полным словом или сокращением («ул. Набережная» при type «улица»)
  let idx = t ? words.findIndex((w) => w === t) : -1;
  if (idx < 0 && t) idx = words.findIndex((w) => w !== t && (STREET_TYPES[w] ?? "").split("|").includes(t) && w.length < t.length);
  if (idx < 0) {
    const first = words[0];
    const last = words[words.length - 1];
    if (words.length > 1 && last && STREET_TYPES[last] && last !== "линия") idx = words.length - 1;
    else if (words.length > 1 && first && STREET_TYPES[first] && first !== "линия") idx = 0;
    // тип не указан и не с краю: «1-й проезд Шовгенова» — полное слово типа внутри
    else if (words.length > 2) idx = words.findIndex((w, i) => i > 0 && FULL_TYPES.has(w));
  }
  if (idx >= 0 && words.length > 1 && words[idx] !== "линия") {
    const typeWord = words[idx];
    return { words: words.filter((_, i) => i !== idx), typeWord };
  }
  return { words, typeWord: null };
}

/** Слова ядра названия пункта: типы по краям прочь («СНТ «Лесное»» → «лесное», «Родник СТ» → «родник»). */
function placeCore(name: string): string[] {
  const words = nameWords(name);
  let a = 0;
  let b = words.length;
  while (b - a > 1 && PLACE_TYPES[words[a]]) a++;
  while (b - a > 1 && PLACE_TYPES[words[b - 1]]) b--;
  return words.slice(a, b);
}

function poiCore(name: string): string[] {
  const words = nameWords(name);
  return words.filter((w) => !(w in PLACE_TYPES || POI_TYPES.has(w)) || words.length === 1);
}

/** Слова, которые в сокращениях названий не участвуют: «Кубанский государственный аграрный университет» → «КГАУ». */
const ACRONYM_SKIP = new Set(["и", "им", "имени", "в", "на", "по", "для", "с", "при"]);

/**
 * Формы названия объекта:
 *  - название и синонимы без вида («ТЦ», «ЖК»);
 *  - латиница кириллицей, как читают: «Oz Молл» → «оз молл», «Royal City Mall» → «роял сити молл»;
 *    короткое название из двух слов — и слитно («озмолл»);
 *  - вид словами перед названием: «аэропорт Краснодар - Пашковский», «вокзал Краснодар-1»;
 *  - сокращения вузов и больниц: по первым буквам («БСМП», «КГАУ») и с первым слогом («КубГАУ»).
 */
export function poiForms(name: string, aliases: string[], kind: string): string[][] {
  const out: string[][] = [];
  const kindWords = POI_KIND_WORDS[kind] ?? [];
  for (const n of [name, ...aliases]) {
    const core = poiCore(n);
    if (!core.length) continue;
    const start = out.length;
    out.push(core);
    if (core.some((w) => /[a-z]/.test(w))) {
      out.push(core.map((w) => (/[a-z]/.test(w) ? latinNameToRu(w) : w)));
      out.push(core.map((w) => (/[a-z]/.test(w) ? translitToRu(w) : w)));
    }
    for (const f of out.slice(start)) if (f.length >= 2 && f.length <= 3 && f.join("").length <= 14) out.push([f.join("")]);
    for (const kw of kindWords) if (kw !== "тц" && kw !== "жк" && !core.includes(kw)) out.push([kw, ...core]);
    // сокращение — по названию до «имени» («ККБ № 1 имени С. В. Очаповского» — «ККБ»), без инициалов
    const imAt = core.findIndex((w) => w === "имени" || w === "им");
    const named = imAt > 0 ? core.slice(0, imAt) : core;
    const words = named.filter((w) => !ACRONYM_SKIP.has(w) && !/^\d+$/.test(w) && !/^[а-я]$/.test(w));
    const nums = named.filter((w) => /^\d+$/.test(w));
    if ((kind === "university" || kind === "college" || kind === "hospital") && words.length >= 3 && words.length <= 7) {
      const acr = words.map((w) => w[0]).join("");
      out.push([acr]);
      // с номером: «ККБ 2» — «Краевая клиническая больница № 2»
      if (nums.length) out.push([acr, ...nums]);
      if (words[0].length >= 5 && /^[а-я]+$/.test(words[0])) out.push([words[0].slice(0, 3) + words.slice(1).map((w) => w[0]).join("")]);
    }
    // по имени, чьё оно: «ККБ № 1 имени С. В. Очаповского» — «Очаповского», «Сквер имени маршала Г. К. Жукова» —
    // «сквер Жукова»
    const im = core.findIndex((w) => w === "имени" || w === "им");
    if (im >= 0) {
      const eponym = core.slice(im + 1).filter((w) => !TITLES.has(w) && !GIVEN_NAMES.has(w) && !/^[а-я]$/.test(w) && !/^\d+$/.test(w));
      if (eponym.length && eponym.length <= 2) {
        out.push(eponym);
        if (im > 0 && !/^\d+$/.test(core[0])) out.push([core[0], ...eponym]);
      }
    }
  }
  return out.filter((f) => f.length);
}

/** Род порядкового числа в названии улицы по окончанию: «2-я Линия» — f, «2-й проезд» — m, «1-е отделение» — n. */
export function ordinalGender(name: string): "" | "f" | "m" | "n" {
  const m = /\d+\s*-?\s*(ая|яя|я|ый|ий|ой|й|ое|ее|е|го|ого)(?![а-я])/.exec(fold(name));
  if (!m) return "";
  return /^(ая|яя|я)$/.test(m[1]) ? "f" : /^(ое|ее|е)$/.test(m[1]) ? "n" : "m";
}

const FULL_TYPES = new Set(["улица", "проспект", "переулок", "проезд", "бульвар", "шоссе", "тупик", "набережная", "площадь", "аллея"]);

/**
 * Заранее посчитанное по домам — для индекса без домов (клиентский мини-индекс, client-index.ts):
 * ранжирование то же, что на сервере, хотя домов в данных нет.
 */
export interface Precomputed {
  /** Домов у улицы (размер улицы в оценке). */
  streetHouses: ArrayLike<number>;
  /** Пункт большинства домов улицы (индекс в places) или −1. */
  streetArea: ArrayLike<number>;
  placeRadiusKm: ArrayLike<number>;
  placeHouses: ArrayLike<number>;
}

export function buildIndex(input: GeoIndexData, pre?: Precomputed): SearchIndex {
  // мусор ГАР в названиях улиц — до всего остального (подпись, формы, ядро)
  const data: GeoIndexData = input.streets.some((s) => /[()]/.test(s.name) || s.aliases.some((a) => /[()]/.test(a)))
    ? { ...input, streets: input.streets.map((s) => ({ ...s, name: cleanStreetName(s.name, s.type), aliases: s.aliases.map((a) => cleanStreetName(a, s.type)) })) }
    : input;
  // --- пункты
  const placeIdx = new Map<string, number>();
  data.places.forEach((p, i) => placeIdx.set(p.id, i));
  const places: PlaceRec[] = data.places.map((p: IndexPlace) => ({
    id: p.id, name: p.name, kind: p.kind, parent: p.parentId ? placeIdx.get(p.parentId) ?? -1 : -1,
    settlement: -1, lat: p.lat, lon: p.lon, radiusKm: 0.5, houses: 0,
  }));
  // Пункт для близости и подписи: сам пункт или СНТ; микрорайон и округ — их город.
  for (let i = 0; i < places.length; i++) {
    let s = i;
    const seen = new Set<number>();
    while (!SETTLEMENT_KINDS.has(places[s].kind) && places[s].kind !== "snt" && places[s].parent >= 0 && !seen.has(s)) {
      seen.add(s);
      s = places[s].parent;
    }
    places[i].settlement = SETTLEMENT_KINDS.has(places[s].kind) || places[s].kind === "snt" ? s : i;
  }

  // --- улицы
  const streetIdx = new Map<string, number>();
  data.streets.forEach((s, i) => streetIdx.set(s.id, i));
  const streets: StreetRec[] = data.streets.map((s, idx) => {
    const words = streetCore(s.name, s.type).words;
    const main = words.filter((w) => !optionalWord(w) && !TITLES.has(w));
    return {
      idx, id: s.id, name: s.name, area: -1, core: (main.length ? main : words).join(" "), type: s.type,
      place: s.placeId ? placeIdx.get(s.placeId) ?? -1 : -1,
      lat: s.lat, lon: s.lon, houses: 0, start: 0, end: 0, ordGender: ordinalGender(s.name), twins: [], typeSibling: false,
    };
  });

  // --- дома: сортировка по улице (адреса без улицы — в конце, по пункту), внутри — по номеру
  const n = data.houses.length;
  const sKey = new Int32Array(n);
  const nums = new Int32Array(n);
  const keys: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const h = data.houses[i];
    const s = h.streetId ? streetIdx.get(h.streetId) ?? -1 : -1;
    sKey[i] = s >= 0 ? s : streets.length + (h.placeId ? placeIdx.get(h.placeId) ?? places.length : places.length);
    keys[i] = houseKey(h.number);
    nums[i] = houseParts(keys[i]).num;
  }
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => sKey[a] - sKey[b] || nums[a] - nums[b]);
  const hLat = new Float64Array(n);
  const hLon = new Float64Array(n);
  const hNum = new Int32Array(n);
  const hPrec = new Uint8Array(n);
  const hPlace = new Int32Array(n);
  const hPost = new Int32Array(n);
  const hKey: string[] = new Array(n);
  const hRaw: string[] = new Array(n);
  const placeHouses = new Map<number, [number, number]>();
  for (let j = 0; j < n; j++) {
    const i = order[j];
    const h = data.houses[i];
    hLat[j] = h.lat;
    hLon[j] = h.lon;
    hNum[j] = nums[i];
    hPrec[j] = Math.max(0, PREC.indexOf(h.precision));
    hPlace[j] = h.placeId ? placeIdx.get(h.placeId) ?? -1 : -1;
    hPost[j] = h.postcode && /^\d{6}$/.test(h.postcode) ? Number(h.postcode) : 0;
    hKey[j] = keys[i];
    hRaw[j] = h.number;
    const sk = sKey[i];
    if (sk < streets.length) {
      const st = streets[sk];
      if (st.houses === 0) st.start = j;
      st.houses++;
      st.end = j + 1;
    } else if (sk - streets.length < places.length) {
      const p = sk - streets.length;
      const r = placeHouses.get(p);
      if (r) r[1] = j + 1;
      else placeHouses.set(p, [j, j + 1]);
    }
  }

  // --- пункт большинства домов улицы: «улица Степная» в Краснодаре, но дома — в СНТ «Излучина-Кубань»
  for (const st of streets) {
    st.area = st.place;
    if (st.houses === 0) continue;
    const cnt = new Map<number, number>();
    for (let j = st.start; j < st.end; j++) if (hPlace[j] >= 0) cnt.set(hPlace[j], (cnt.get(hPlace[j]) ?? 0) + 1);
    let best = -1;
    let bestN = 0;
    for (const [p, c] of cnt) if (c > bestN) [best, bestN] = [p, c];
    if (best >= 0 && bestN * 2 > st.houses) st.area = best;
  }
  if (pre) {
    streets.forEach((st, i) => {
      st.houses = pre.streetHouses[i] ?? 0;
      st.area = pre.streetArea[i] ?? st.place;
    });
  }

  // --- радиус застройки и число домов пунктов
  const dists = new Map<number, number[]>();
  const addDist = (p: number, lat: number, lon: number) => {
    if (p < 0) return;
    const d = haversineKm(places[p], { lat, lon });
    let arr = dists.get(p);
    if (!arr) dists.set(p, (arr = []));
    if (arr.length < 4000) arr.push(d);
    places[p].houses++;
  };
  for (const st of streets) {
    const p = st.place >= 0 ? places[st.place].settlement : -1;
    if (st.houses === 0) addDist(p, st.lat, st.lon);
    for (let j = st.start; j < st.end; j += Math.max(1, Math.floor(st.houses / 20))) addDist(p, hLat[j], hLon[j]);
  }
  for (const [p, [a, b]] of placeHouses) for (let j = a; j < b; j++) addDist(places[p].settlement, hLat[j], hLon[j]);
  for (const [p, arr] of dists) {
    arr.sort((a, b) => a - b);
    // 85-й перцентиль, но не больше, чем позволяет число домов: у хутора с чужими домами (привязка по
    // ближайшему узлу) «радиус» иначе выходит в десятки километров
    const byCount = 0.5 + 0.06 * Math.sqrt(places[p].houses);
    places[p].radiusKm = Math.max(0.5, Math.min(arr[Math.floor(arr.length * 0.85)] ?? 0.5, byCount, 15));
  }
  if (pre) {
    places.forEach((p, i) => {
      p.radiusKm = pre.placeRadiusKm[i] ?? p.radiusKm;
      p.houses = pre.placeHouses[i] ?? p.houses;
    });
  }

  // --- двойники: одна улица двумя записями под разными именами в одном месте («улица Митрофана Седина» ГАР и
  // «улица Седина» OSM; тип и ядро без имён и званий совпадают, точки ближе 3 км) — если это подтверждают дома:
  // ≥2 общих номера с настоящими точками ближе 150 м или у одной из записей дома без точек (≥ половины; тогда
  // и точка улицы условная — до 6 км).
  // Одноимённые куски одной улицы, которые импорт развёл нарочно (две нумерации, разные СНТ), — не двойники.
  const byCore = new Map<string, number[]>();
  for (const st of streets) {
    if (!st.core) continue;
    const k = `${st.area}|${fold(st.type)}|${st.core}`;
    const arr = byCore.get(k);
    if (arr) arr.push(st.idx);
    else byCore.set(k, [st.idx]);
  }
  const fullKey = (i: number) => streetCore(data.streets[i].name, data.streets[i].type).words.slice().sort().join(" ");
  const realPoints = (st: StreetRec) => {
    const m = new Map<string, number>();
    for (let j = st.start; j < st.end; j++) if (hPrec[j] <= 1) m.set(hKey[j], j);
    return m;
  };
  const collapsed = (st: StreetRec) => {
    if (st.houses < 1) return false;
    let c = 0;
    for (let j = st.start; j < st.end; j++) if (hPrec[j] >= 2) c++;
    return c * 2 >= st.houses;
  };
  for (const arr of byCore.values()) {
    if (arr.length < 2 || arr.length > 12) continue;
    for (const a of arr) {
      for (const b of arr) {
        // одноимённые куски (то же имя, другой порядок слов или «ё») импорт развёл нарочно — не двойники
        if (a >= b || fullKey(a) === fullKey(b)) continue;
        // у записи без точек домов и точка улицы условная — длинная улица, до 6 км
        const loose = collapsed(streets[a]) || collapsed(streets[b]);
        if (haversineKm(streets[a], streets[b]) > (loose ? 6 : 3)) continue;
        let ok = loose;
        if (!ok) {
          const pa = realPoints(streets[a]);
          let common = 0;
          for (const [k, jb] of realPoints(streets[b])) {
            const ja = pa.get(k);
            if (ja !== undefined && haversineKm({ lat: hLat[ja], lon: hLon[ja] }, { lat: hLat[jb], lon: hLon[jb] }) <= 0.15) common++;
          }
          ok = common >= 2;
        }
        if (ok) {
          streets[a].twins.push(b);
          streets[b].twins.push(a);
        }
      }
    }
  }
  const typesByCore = new Map<string, Set<string>>();
  const coreKey = (st: StreetRec) => `${st.place >= 0 ? places[st.place].settlement : -1}|${st.core}`;
  for (const st of streets) {
    if (!st.core) continue;
    const k = coreKey(st);
    let set = typesByCore.get(k);
    if (!set) typesByCore.set(k, (set = new Set()));
    set.add(fold(st.type));
  }
  for (const st of streets) if (st.core && (typesByCore.get(coreKey(st))?.size ?? 0) > 1) st.typeSibling = true;

  // --- формы названий
  const wordIds = new Map<string, number>();
  const words: string[] = [];
  const wid = (w: string) => {
    let id = wordIds.get(w);
    if (id === undefined) {
      id = words.length;
      words.push(w);
      wordIds.set(w, id);
    }
    return id;
  };
  const rawForms: { ent: number; words: string[]; alias: boolean }[] = [];
  /** list[0] — основное название, остальное — синонимы. */
  const addForms = (ent: number, list: string[][], mainCount = 1) => {
    const seen = new Set<string>();
    list.forEach((ws, li) => {
      const w = ws.filter(Boolean).slice(0, 31);
      const k = w.join(" ");
      if (!w.length || seen.has(k)) return;
      seen.add(k);
      rawForms.push({ ent, words: w, alias: li >= mainCount });
    });
  };
  // Синоним улицы, совпадающий с основным названием другой улицы того же места («Сиреневая» у Инженерной рядом
  // с настоящей Сиреневой) — не форма: иначе адрес уверенно уходит на чужую улицу.
  const settle = (st: StreetRec) => (st.place >= 0 ? places[st.place].settlement : -1);
  // ключ — тип и слова без званий: «улица имени Археолога Веселовского» — то же, что «улица Археолога Веселовского»,
  // а «улица имени Цезаря Куникова» — не «проезд Цезаря Куникова»
  const mainKey = (words: string[], type: string) => {
    const main = words.filter((w) => !TITLES.has(w));
    return `${fold(type)}|${(main.length ? main : words).join(" ")}`;
  };
  const mainCore = new Map<string, number[]>();
  data.streets.forEach((s, i) => {
    const k = `${settle(streets[i])}|${mainKey(streetCore(s.name, s.type).words, s.type)}`;
    const arr = mainCore.get(k);
    if (arr) arr.push(i);
    else mainCore.set(k, [i]);
  });
  data.streets.forEach((s, i) => {
    const list: string[][] = [];
    let mainCount = 0;
    [s.name, ...s.aliases].forEach((name, ni) => {
      const words = streetCore(name, s.type).words;
      // синоним = основное имя другой улицы ближе 3 км — пропустить: та улица находится по своему имени
      // (без домов: мини-индекс браузера должен собрать те же формы, что и сервер)
      if (ni > 0) {
        const others = mainCore.get(`${settle(streets[i])}|${mainKey(words, s.type)}`) ?? [];
        if (others.some((o) => o !== i && haversineKm(streets[o], streets[i]) <= 3)) return;
      }
      list.push(words);
      if (/-/.test(name)) list.push(streetCore(joinHyphens(name), s.type).words);
      if (ni === 0) mainCount = list.length;
    });
    addForms(i * 4 + ENT_STREET, list, mainCount);
  });
  data.places.forEach((p, i) => {
    const list: string[][] = [];
    for (const name of [p.name, ...p.aliases]) {
      list.push(placeCore(name));
      if (/-/.test(name)) list.push(placeCore(joinHyphens(name)));
    }
    addForms(i * 4 + ENT_PLACE, list);
  });
  // объект без пункта в данных («Краснодар - Пашковский», аэропорт) — пункт, в застройке которого он лежит (до 1,5 км
  // от края; из нескольких — крупнейший): иначе у подсказки пустая подпись и нет близости к пользователю
  const settlementOf = (lat: number, lon: number): number => {
    let best = -1;
    places.forEach((pl, i) => {
      if (pl.settlement !== i || pl.kind === "snt") return;
      if (haversineKm(pl, { lat, lon }) - pl.radiusKm > 1.5) return;
      if (best < 0 || pl.houses > places[best].houses) best = i;
    });
    return best;
  };
  const pois: PoiRec[] = (data.pois ?? []).map((p) => ({
    id: p.id, name: p.name, kind: p.kind, place: p.placeId ? placeIdx.get(p.placeId) ?? -1 : settlementOf(p.lat, p.lon),
    lat: p.lat, lon: p.lon, address: p.address ?? null,
  }));
  (data.pois ?? []).forEach((p, i) => addForms(i * 4 + ENT_POI, poiForms(p.name, p.aliases, p.kind), 0));

  // составные формы объектов: одно слово, которого нет в многословных формах того же объекта
  const multiWords = new Map<number, Set<string>>();
  for (const f of rawForms) {
    if ((f.ent & 3) !== ENT_POI || f.words.length < 2) continue;
    let set = multiWords.get(f.ent);
    if (!set) multiWords.set(f.ent, (set = new Set()));
    for (const w of f.words) set.add(w);
  }
  const isCompound = (f: { ent: number; words: string[] }) =>
    (f.ent & 3) === ENT_POI && f.words.length === 1 && !!multiWords.get(f.ent) && !multiWords.get(f.ent)!.has(f.words[0]);

  // df → вес слова
  const df = new Map<string, number>();
  for (const f of rawForms) for (const w of new Set(f.words)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = rawForms.length;
  const forms: FormRec[] = [];
  const postingLists: number[][] = [];
  for (const f of rawForms) {
    const ids = new Int32Array(f.words.length);
    const weights = new Float32Array(f.words.length);
    let total = 0;
    let optional = 0;
    // улица и пункт: звания, имена, инициалы необязательны, если в названии есть что-то ещё;
    // объект: всё, кроме первого слова и чисел («Кубанский университет» = «Кубанский государственный университет»)
    const isPoi = (f.ent & 3) === ENT_POI;
    const canOpt = !isPoi && f.words.some((w) => !optionalWord(w) && !TITLES.has(w) && !/^\d+$/.test(w));
    // название целиком из звания («ТЦ Адмирал», «ЖК Маршал») — звание и есть имя, весит как обычное слово
    const titleIsName = !f.words.some((w) => !TITLES.has(w) && !/^\d+$/.test(w) && functionKind(w) !== "filler" && functionKind(w) !== "region");
    f.words.forEach((w, pos) => {
      const id = wid(w);
      ids[pos] = id;
      let wt = Math.min(4, Math.max(0.6, Math.log(1 + N / (df.get(w) ?? 1)) / 2));
      // имя («Николая Кондратенко») весит как обычное слово — его набирают первым; без него — необязательно
      if (TITLES.has(w) && !titleIsName) wt = 0.3;
      else if (/^[а-я]$/.test(w)) wt = 0.15; // инициал: «Д. Нехая»
      else if (/^\d+$/.test(w)) wt = Math.max(wt, 1);
      else if (functionKind(w) === "filler" || functionKind(w) === "region") wt = Math.min(wt, 0.5);
      // звание тоже: «Посадского» = «Героя Владислава Посадского»
      if ((canOpt && (optionalWord(w) || TITLES.has(w))) || (isPoi && pos > 0 && !/^\d+$/.test(w))) optional |= 1 << pos;
      weights[pos] = wt;
      total += wt;
      (postingLists[id] ??= []).push(forms.length * 32 + pos);
    });
    forms.push({ ent: f.ent, words: ids, weights, total, optional, alias: f.alias, compound: isCompound(f) });
  }
  const postings = words.map((_, i) => Int32Array.from(postingLists[i] ?? []));

  // --- словарь
  const stems: string[] = [];
  const stemIds = new Map<string, number>();
  const stemWords: number[][] = [];
  const wordStem = new Int32Array(words.length);
  const byPhon = new Map<string, number[]>();
  const wordsByLen: number[][] = [];
  const stemsByLen: number[][] = [];
  const wordMask = new Uint32Array(words.length);
  const numeric = new Uint8Array(words.length);
  words.forEach((w, i) => {
    const st = stemWord(w);
    let sid = stemIds.get(st);
    if (sid === undefined) {
      sid = stems.length;
      stems.push(st);
      stemIds.set(st, sid);
      stemWords.push([]);
      (stemsByLen[st.length] ??= []).push(sid);
    }
    stemWords[sid].push(i);
    wordStem[i] = sid;
    const ph = phoneticKey(w);
    const arr = byPhon.get(ph);
    if (arr) arr.push(i);
    else byPhon.set(ph, [i]);
    (wordsByLen[w.length] ??= []).push(i);
    wordMask[i] = letterMask(w);
    numeric[i] = /^\d+$/.test(w) ? 1 : 0;
  });
  const stemMask = new Uint32Array(stems.length);
  stems.forEach((s, i) => (stemMask[i] = letterMask(s)));
  const sorted = Int32Array.from(words.map((_, i) => i).sort((a, b) => (words[a] < words[b] ? -1 : words[a] > words[b] ? 1 : 0)));
  const mass = new Float32Array(words.length);
  const entMass = (ent: number) => {
    const kind = ent & 3;
    const idx = ent >> 2;
    if (kind === ENT_STREET) return 1 + streets[idx].houses;
    if (kind === ENT_PLACE) return 50 + places[idx].houses;
    return 3;
  };
  forms.forEach((f) => {
    const m = Math.log(1 + entMass(f.ent));
    for (const id of f.words) mass[id] += m;
  });

  // --- центр по умолчанию: город с наибольшим числом домов
  let city = -1;
  places.forEach((p, i) => {
    if (p.kind === "city" && (city < 0 || p.houses > places[city].houses)) city = i;
  });
  if (city < 0) places.forEach((p, i) => (city < 0 || p.houses > places[city].houses ? (city = i) : null));
  const center = city >= 0 ? { lat: places[city].lat, lon: places[city].lon } : { lat: 45.0355, lon: 38.9753 };

  return {
    version: data.version, citySlug: data.citySlug, places, streets, pois, forms, postings,
    vocab: { words, ids: wordIds, stems, stemIds, stemWords, wordStem, byPhon, sorted, wordsByLen, stemsByLen, wordMask, stemMask, mass, numeric },
    hLat, hLon, hNum, hPrec, hPlace, hPost, hKey, hRaw, placeHouses, center, cityPlace: city,
  };
}
