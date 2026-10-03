// Поиск адреса: подсказки «Где» и геокодирование для CSV-импорта. Чистый TypeScript, без БД и сети:
// на вход — GeoIndexData, индекс держится в памяти процесса.
//
// Как ищем:
//  1. Запрос → куски; у кусков в латинице выбираем вариант (как набрано / раскладка / транслит) по словарю.
//  2. Куски → слова, числа и номер дома (query.ts): «21 корп 1» = «21к1», «кв. 5» выброшено.
//  3. Каждое слово → слова словаря: точно, основа (падеж), фонетика, опечатки (Дамерау–Левенштейн ≤ 2),
//     начало слова (последнее слово при наборе).
//  4. Слова → формы названий улиц, пунктов и POI; у формы — доля покрытых слов с весами (редкие слова весомее,
//     «Героя», «имени», инициалы — легче).
//  5. Кандидат = улица (+ пункт, если назван) + номер дома из оставшихся чисел; дом ищется в улице точно,
//     иначе «≈» — точка по соседним домам той же чётности (дом не выдумываем).
//  6. Оценка: совпадение текста → полнота (дом выше улицы) → названный пункт → близость к near → размер улицы.

import { haversineKm } from "@/lib/geo/point";
import { damerau, damerauFull, letterMask, popcount, prefixDamerau } from "./fuzzy";
import { displayHouse, houseKey, houseParts } from "./house-number";
import { buildIndex, ENT_PLACE, ENT_POI, ENT_STREET, PREC, SETTLEMENT_KINDS, type SearchIndex, type StreetRec } from "./index-build";
import { Lru } from "./lru";
import { chunkVariants, houseLetterTwins, tokenize, type QueryToken } from "./query";
import { fold, functionKind, phoneticKey, PLACE_TYPES, POI_KIND_WORDS, POI_TYPES, stemWord, streetTypeOf } from "./text";
import type { AddrPrecision, AddressHit, GeoIndexData, PlaceKind, SuggestOptions } from "./types";

export interface GeocodeOptions {
  near?: { lat: number; lon: number } | null;
  /**
   * Строго (по умолчанию): пункт не назван, а такой же адрес есть и в другом пункте — null
   * («Садовая, 5» есть в Краснодаре и в Яблоновском). Нестрого — берётся ответ в пункте near.
   */
  strict?: boolean;
}

/** Почему geocode не дал ответа. */
export type GeocodeFailure =
  | "empty"            // пустая строка
  | "not_found"        // ни улицы, ни пункта, ни объекта
  | "weak_match"       // похоже слишком слабо
  | "extra_words"      // в адресе слова, которых нет ни в одном названии
  | "place_mismatch"   // улица есть, но не в названном пункте
  | "ambiguous_place"  // пункт не назван, а такой адрес есть в нескольких пунктах
  | "ambiguous"        // несколько похожих адресов почти с одной оценкой
  | "type_mismatch";   // тип улицы назван, а дом найден только на улице другого типа

export const GEOCODE_MESSAGES: Record<GeocodeFailure, string> = {
  empty: "Пустой адрес",
  not_found: "Адрес не найден",
  weak_match: "Похожего адреса нет — проверьте написание",
  extra_words: "В адресе есть слова, которых нет в названиях улиц и пунктов — проверьте написание",
  place_mismatch: "Такой улицы нет в указанном пункте",
  ambiguous_place: "Такой адрес есть в нескольких пунктах — уточните пункт",
  ambiguous: "Похожих адресов несколько — уточните адрес",
  type_mismatch: "Дом найден только на улице другого типа (например, проезд вместо улицы) — проверьте адрес",
};

export interface GeocodeResult {
  /** Ответ; null — отказ, причина в reason. */
  hit: AddressHit | null;
  reason: GeocodeFailure | null;
  /** Причина словами — для отчёта импорта. */
  message: string | null;
  /** При отказе — между чем выбирали (до 5): «Садовая, 5 — Яблоновский», «… — Новая Адыгея». */
  alternatives: AddressHit[];
}

export interface ReverseOptions {
  /** Дом не дальше этого, м (60). Дальше — ответ уровня улицы или пункта. */
  houseM?: number;
}

export interface Geocoder {
  /** Подсказки при наборе: до `limit` (5) адресов, сразу с координатами. */
  suggest(q: string, opts?: SuggestOptions): AddressHit[];
  /** Один адрес для CSV-импорта: лучший, если он однозначен и совпал уверенно; иначе null. */
  geocode(address: string, opts?: GeocodeOptions): AddressHit | null;
  /** То же с причиной отказа («уточните пункт») и вариантами — для отчёта CSV-импорта. */
  geocodeDetailed(address: string, opts?: GeocodeOptions): GeocodeResult;
  /** Точка → ближайший адрес: дом ≤ 60 м, иначе улица, иначе пункт («Моё местоположение»). */
  reverse(lat: number, lon: number, opts?: ReverseOptions): AddressHit | null;
  /** Размер индекса. */
  stats(): { places: number; streets: number; houses: number; pois: number; words: number; forms: number };
}

// ------------------------------------------------------------------ параметры ранжирования

/** Веса оценки. Подобраны на train-части набора замера (data/geocoder/research/eval), см. README. */
export const RANK = {
  text: 100,
  /** Дом найден точно / приблизительно по соседям. */
  houseExact: 30,
  houseApprox: 14,
  /** Нашёлся дом без отделённой буквы («58/1 г, Краснодар» → 58/1). */
  houseAltPenalty: 8,
  /** Назван пункт, и улица в нём / не в нём. */
  placeMatch: 20,
  placeMismatch: -30,
  /** Лишнее слово запроса, которое ни к чему не подошло. */
  leftoverWord: -22,
  leftoverShort: -8,
  /** Лишнее длинное слово — почти наверняка другое название. */
  leftoverLong: -30,
  leftoverNumber: -6,
  leftoverOrdinal: -25,
  /** Тип улицы в запросе совпал / не совпал. */
  typeMatch: 4,
  /** Служебное слово запроса вошло в название («имени Есенина»). */
  fnWord: 2,
  typeMismatch: -6,
  /** Близость пункта к near (от края застройки) и самой точки. */
  nearPlace: 12,
  nearPlaceKm: 10,
  nearPoint: 8,
  nearPointKm: 2,
  size: 8,
  /** Дополненный номер при наборе — ниже точного совпадения. */
  completionGap: 30,
  /** Отрыв лучшего ответа geocode от следующего в другом месте. */
  geocodeMargin: 8,
  geocodeMinText: 0.76,
  geocodeTextGap: 0.12,
  /** Пункт не назван, лучший ответ — в другом пункте, а в «домашнем» есть такая же улица: отказ (1) или ответ (0). */
  geocodeHomeGuard: 0,
  /** Строгий geocode: соперник-тёзка ближе этого по оценке — отказ. */
  geocodeStrictMargin: 25,
  /**
   * Набор по буквам: слово набирается («Никол», «имени Анто») — недонабранные слова названия после него
   * засчитываются с этой долей веса («Николая Кондратенко» не проигрывает «Николаевской» из-за второго слова).
   */
  trailCredit: 0.7,
  /** Недонабранное слово запроса ни к чему не подошло — как лишнее слово (а не короткое). */
  leftoverPrefix: -22,
  /** Род порядкового совпал / нет: «1-я Заречная» — улица, «1-й Заречный» — проезд. */
  ordGenderMatch: 2,
  ordGenderMismatch: -8,
  /** Подсказки: «≈» ниже найденного дома с тем же названием улицы в другом пункте («Вишнёвая 5»). */
  approxBehindExact: 16,
  /** Насколько правдоподобие соседей снимает это понижение (1 — полностью). */
  approxFitRelief: 0.5,
  /**
   * Слово сразу после типа другого вида: «ст. Калужская» — станица, а не «улица Калужская»; «ул. Динская» — не
   * станица; «ЖК Янтарный 4» — объект, а не «улица Янтарная, 4».
   */
  typeContext: 25,
  /** Тип в запросе не указан — вероятнее «улица» («Есенина 10» — улица, а не переулок Есенина). */
  impliedStreet: 5,
  /** Найдено без личного имени, а в том же пункте есть улица ровно с таким названием («Ковалёва» — не «Льва Ковалёва»). */
  optionalRival: 20,
  /**
   * Объект найден целиком: все слова запроса — его название, и в нём есть число («Городская больница 3»,
   * «ЖК Янтарный 4») или назван вид («ТЦ», «парк», «аэропорт») — как найденный дом у улицы.
   */
  poiComplete: 30,
  /** Тип пункта в запросе — другого вида («СНТ Гидростроитель» у микрорайона, «ЖК Лесной» у СНТ). */
  typeKindClash: 12,
  /**
   * Запрос — ровно название населённого пункта («Динская», «Калужская»): пункт не ниже одноимённых улиц
   * (они — в другом месте, пункт назван целиком).
   */
  placeNamed: 18,
  /** Ответ — пункт, а в запросе назван и пункт помельче внутри него (микрорайон, ЖК): ниже. */
  coarserPlace: 10,
  /** Строгий geocode: совпадение с опечаткой — соперник с другим названием, похожий не хуже чем на столько, — отказ. */
  geocodeFuzzyGap: 0.1,
  /** Почтовый индекс запроса совпал с индексом дома / другой. */
  postcode: 8,
  /** Микрорайон назван, а найденная точка — не в нём (город назван тоже, так что это не «пункт не тот»). */
  farNamed: 15,
  /**
   * Набор по буквам: объект, чьё название набрано не целиком (покрытие «по набранному» `Cand.typed` ниже
   * `poiTypedWhole`), — ниже улиц и пунктов с тем же началом: «красная» — улица Красная, а не «ТРЦ Красная Площадь».
   */
  poiPartial: 15,
  poiTypedWhole: 0.7,
  /** Запрос короче стольких букв — объекты только названные целиком («ккб»), без случайных начал («же» → «женус»). */
  poiMinLetters: 4,
  /** Короткое начало слова (2–4 буквы): размер улицы весит больше — «кр» — улица Красная, а не любая «Кр…». */
  sizeShort: 6,
  sizeShortKm: 4,
  /** `near` в посёлке или СНТ внутри застройки большего пункта — ответы в нём самом выше (`homeOf`). */
  nearHome: 6,
};

export const MATCH = {
  stem: 0.1,
  phonetic: 0.14,
  edit1: 0.22,
  edit2: 0.42,
  /** Три правки — только в длинных словах (от 10 букв): «росссисйкаая» → «российская». */
  edit3: 0.55,
  stemEditExtra: 0.06,
  obliqueExact: 0.08,
  /** Опечатка в слове из 3 букв («Мра» → «Мира») — дороже. */
  shortEdit: 0.13,
  /** «Весёлая» ≠ «Весёлый» (улица и переулок) — другой род, а не падеж. */
  gender: 0.25,
  /** Опечатка и другой род сразу: «Загечный» → «Заречная». */
  genderEdit: 0.12,
  obliqueStem: 0.04,
  prefixBase: 0.04,
  prefixSpan: 0.3,
  prefixEdit: 0.22,
  layout: 0.02,
  translit: 0.04,
  /** Слово ещё набирается: опечатка в целом слове («водн» → «видн(ая)») дороже, чем точное начало длинного слова. */
  prefixTypo: 0.12,
  /** Набранное слово уже есть в словаре целиком («Степная») — продолжения («Степановская») дороже. */
  prefixWhenExact: 0.1,
  /** Начало слова в середине запроса («Селезн 100») — дороже, чем у последнего набираемого слова. */
  midPrefix: 0.1,
  /** Буква-сокращение слова названия («Н. Адыгея»). */
  initial: 0.3,
  /** Доля веса необязательного слова названия (звание, имя), которого нет в запросе. */
  optionalMiss: 0.1,
  /** Множественное и единственное число фамилии: «Игнатовых» ≠ «Игнатова». */
  plural: 0.25,
  /** Фонетически равные слова: за каждую правку написания сверх одной. */
  phoneticEdit: 0.03,
  /** Буква-сокращение с точкой или дефисом («В.Кругликовская», «Г.К. Жукова») — явное сокращение, дешевле. */
  initialAbbr: 0.1,
  /** Опечатка в основе при падежном окончании («на Сверной» = «Северной», «на Красонй») — как одна опечатка. */
  inflectEdit: 0.23,
  /** После предлога окончание другого рода («на Майском» — не «Майская», «на Саратвской» — не «Саратовский»). */
  obliqueGender: 0.06,
};

interface WordMatch {
  w: number;
  cost: number;
}

interface Cand {
  ent: number;
  cov: number;
  /** Совпало без необязательного слова названия (личного имени): «Покрышкина» ↔ «Александра Покрышкина». */
  missOpt: boolean;
  /** Пропущено слово в середине названия («Краевая больница» у «Краевая наркологическая больница»), а не в конце. */
  missInner: boolean;
  /** Слова запроса, покрытые формой (битовая маска). */
  mask: number;
  /** Какая-то форма сущности совпала целиком, без пропуска необязательных слов (не только выбранная). */
  full: boolean;
  /** Голые числа запроса, ушедшие в название («1 Мая»), и покрытие без них. */
  numMask: number;
  covNoNum: number;
  lastTok: number;
  /**
   * Покрытие «по набранному»: недонабранное слово засчитано долей набранных букв («же» у «женус» — 0,4, а не 0,78,
   * как в `cov`). Объект при наборе обгоняет улицу, только если его название набрано целиком или почти целиком.
   */
  typed: number;
  /**
   * Название набрано целиком или почти: `typed` ≥ `RANK.poiTypedWhole` или совпали два слова названия и больше
   * («красная пл» — «Красная Площадь», «оз м» — «Oz Молл»).
   */
  typedWhole: boolean;
}

interface Scored {
  score: number;
  text: number;
  leftover: number;
  hit: AddressHit;
  /** Ключ одного адреса — дубли отбрасываются. */
  key: string;
  settlement: number;
  /** Назван ли пункт и подходит ли: null — пункт в запросе не назван. */
  placeOk: boolean | null;
  /** Ядро названия улицы («красная») — одноимённые улицы разных пунктов. */
  core: string;
  /** Названный в запросе пункт, к которому отнесён ответ (−1 — нет): «СНТ Мелиоратор» — какой из двух. */
  named?: number;
  /** Тип в запросе противоречит виду ответа («ЖК Лесной» — а это СНТ): geocode не берёт. */
  clash?: boolean;
  /** Тип улицы назван явно и совпал (true) / другой (false); не назван — null. */
  typeOk?: boolean | null;
  /** Почтовый индекс запроса совпал с индексом дома (true) / другой (false); нет индекса — null. */
  postOk?: boolean | null;
  /** Названный вместе с городом микрорайон: точка в нём (true) / далеко (false); не назван — null. */
  hoodOk?: boolean | null;
  /** Одно из двух прочтений латинской литеры («24B» — 24В или 24Б). */
  letterTwin?: boolean;
  /** Для дополнения номера при наборе: улица, номер из запроса, вклад найденного дома в оценку. */
  street?: number;
  houseTok?: QueryToken;
  houseBonus?: number;
  /**
   * Найден дом данных с настоящей точкой (здание, интерполяция данных, двойник) или с «≈» данных, но с соседями
   * рядом: такой дом, скорее всего, стоит там, где сказано. Для строгих отказов geocode, не для показа.
   */
  realPoint?: boolean;
}

/** Дополнительное к оценке улицы: что проверить по точке найденного дома. */
interface StreetExtra {
  /** Микрорайоны, названные в запросе и «поглощённые» пунктом улицы, — проверить, что точка в них. */
  hoods: number[];
  /** Почтовый индекс из запроса (0 — нет). */
  postcode: number;
  typeOk: boolean | null;
  /** Названный микрорайон другого пункта может подойти по расстоянию (назван уверенно). */
  spatial?: boolean;
  /**
   * Лишние слова, если найден дом с этой точкой (имя объекта перед адресом не лишнее); `poi` — рядом с домом нашёлся
   * названный объект (он и уточняет место, как названный пункт).
   */
  relax?: (lat: number, lon: number) => { lo: number; poi: boolean };
}

/** Почтовый индекс в запросе («350018, Краснодар, …»): 6 цифр отдельно, 35…/36…/38…; нет — 0. */
function queryPostcode(q: string): number {
  const m = /(?<![\d/-])(3[568]\d{4})(?![\d/-])/.exec(q);
  return m ? Number(m[1]) : 0;
}

const MAX_TOKENS = 24;
/** Сетка обратного геокодирования: ячейка ≈ 220 × 235 м на широте Краснодара. */
const GRID_LAT = 0.002;
const GRID_LON = 0.003;
const GRID_KEY = 1_000_000;
/** Доля бонуса «дом найден» по точности точки: house, interpolated, street, place. */
const PREC_TRUST = [1, 0.93, 0.75, 0.6];
/** Предлоги, после которых название в косвенном падеже: «-ой» — женский род («с Береговой», «угол Береговой»). */
const PREPOSITIONS = new Set(["на", "по", "у", "около", "возле", "напротив", "в", "с", "со", "угол", "уг", "от", "до", "из", "за", "перекресток", "между"]);
/** Тип улицы в косвенном падеже: название после него — тоже («в переулке Майском», «на улице Мира»). */
const OBLIQUE_TYPES = /^(улиц[еуыи]|улицей|проспект[еуа]|переулк[еуа]|проезд[еуа]|бульвар[еуа]|набережн(ой|ую)|площади|тупик[еуа]|алле[еи])$/;

function maxEdits(len: number): number {
  return len >= 10 ? 3 : len >= 5 ? 2 : len >= 3 ? 1 : 0;
}

export function createGeocoder(data: GeoIndexData): Geocoder {
  return new Engine(buildIndex(data));
}

export class Engine implements Geocoder {
  private cache = new Lru<string, WordMatch[]>(20000);

  constructor(readonly ix: SearchIndex) {}

  stats() {
    const ix = this.ix;
    return {
      places: ix.places.length, streets: ix.streets.length, houses: ix.hLat.length, pois: ix.pois.length,
      words: ix.vocab.words.length, forms: ix.forms.length,
    };
  }

  // ---------------------------------------------------------------- слова

  /** Слово запроса → слова словаря с ценой (0 — точно). */
  matchWord(text: string, prefix: boolean, numeric: boolean, oblique = false, relaxed = false): WordMatch[] {
    const key = `${prefix ? 1 : 0}${numeric ? 1 : 0}${oblique ? 1 : 0}${relaxed ? 1 : 0}${text}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const res = this.computeMatches(text, prefix, numeric, oblique, relaxed);
    this.cache.set(key, res);
    return res;
  }

  private computeMatches(text: string, prefix: boolean, numeric: boolean, oblique: boolean, relaxed: boolean): WordMatch[] {
    const v = this.ix.vocab;
    const best = new Map<number, number>();
    const add = (w: number, cost: number) => {
      const c = best.get(w);
      if (c === undefined || cost < c) best.set(w, cost);
    };
    const exact = v.ids.get(text);
    // после предлога («на Кольцевой») косвенный падеж вероятнее: «Кольцевая улица» выше «Кольцевой проезд»
    if (exact !== undefined) add(exact, oblique && /(ой|ей|ом|ем)$/.test(text) ? MATCH.obliqueExact : 0);
    if (numeric) return [...best].map(([w, cost]) => ({ w, cost }));
    const len = text.length;
    // основа: «красной» → «красная», «красный»
    const st = stemWord(text);
    const sid = v.stemIds.get(st);
    if (sid !== undefined) {
      for (const w of v.stemWords[sid]) {
        const word = v.words[w];
        // «на Медведовской» — женский род («Медведовская улица»), мужской был бы «на Медведовском»
        // средний род тоже: «на Ростовской» — не «Ростовское шоссе» («на Ростовском»)
        // «в проезде Сормовском», «на Ростовском» — мужской или средний род: женский («Сормовская») — другое название
        const cost = oblique
          ? (/(ом|ем)$/.test(text) && FEM.test(word) ? MATCH.gender
            : /(ой|ей)$/.test(text) && (MASC.test(word) || NEUT.test(word)) ? MATCH.stem + 0.02 : MATCH.obliqueStem)
          : genderClash(text, word) ? MATCH.gender : pluralClash(text, word) ? MATCH.plural : MATCH.stem;
        add(w, cost);
      }
    }
    // сокращение с падежным окончанием: «на ФМРе», «КМРа», «в ЮМРе» — «ФМР», «КМР», «ЮМР»
    const abbrCase = /^([бвгджзклмнпрстфхцчшщ]{2,4})(е|у|а|ом)$/.exec(text);
    const abbrId = abbrCase ? v.ids.get(abbrCase[1]) : undefined;
    if (abbrId !== undefined) add(abbrId, MATCH.stem);
    // сокращение без гласных («ВКМР», «ФМР») — только точно: «ВКМР» — не «КМР» с опечаткой
    const noVowels = !VOWELS.test(text);
    // фонетика: «кутузава» → «кутузова»; из равных по звучанию ближе по написанию — выше («сечеввая»: Сечевая, не Сычевая)
    const ph = noVowels ? undefined : v.byPhon.get(phoneticKey(text));
    // другой род фонетически неразличим («новатитаровскя» ~ «новотитаровский»): как у опечатки — дороже
    if (ph && len >= 4) {
      for (const w of ph) {
        add(w, MATCH.phonetic + MATCH.phoneticEdit * Math.min(3, Math.max(0, damerauFull(text, v.words[w], 3) - 1)) + (genderClash(text, v.words[w]) ? MATCH.genderEdit : 0));
      }
    }
    // опечатки: целое слово и основа к основе
    // слово есть в словаре целиком — две и больше правок до другого слова уже не опечатка, а другое название:
    // «Вектор» — не «Нектар», «Ильинская» — не «Ильская»
    const k = noVowels ? 0 : exact !== undefined ? Math.min(1, maxEdits(len)) : maxEdits(len);
    const typo = prefix ? MATCH.prefixTypo : 0;
    if (k > 0) {
      const m = letterMask(text);
      for (let L = len - k; L <= len + k; L++) {
        const bucket = v.wordsByLen[L];
        if (!bucket) continue;
        for (const w of bucket) {
          if (popcount((v.wordMask[w] ^ m) >>> 0) > 2 * k || !VOWELS.test(v.words[w])) continue;
          const d = damerauFull(text, v.words[w], k);
          if (d > 0 && d <= k) add(w, typo + (d === 1 ? MATCH.edit1 : d === 2 ? MATCH.edit2 : MATCH.edit3) + (len <= 3 ? MATCH.shortEdit : 0) + (genderClash(text, v.words[w]) ? MATCH.genderEdit : 0));
        }
      }
      if (st.length >= 4) {
        const ks = Math.min(k, 2, maxEdits(st.length + 1));
        const ms = letterMask(st);
        for (let L = st.length - ks; L <= st.length + ks; L++) {
          const bucket = v.stemsByLen[L];
          if (!bucket) continue;
          for (const s of bucket) {
            if (popcount((v.stemMask[s] ^ ms) >>> 0) > 2 * ks) continue;
            const d = damerau(st, v.stems[s], ks);
            if (d > 0 && d <= ks) {
              const c = typo + (d === 1 ? MATCH.edit1 : MATCH.edit2) + MATCH.stemEditExtra;
              for (const w of v.stemWords[s]) {
                const word = v.words[w];
                // после предлога «-ой» — женский род и при опечатке («на Саратвской» — улица, а не проезд)
                const g = oblique && /(ой|ей)$/.test(text) && (MASC.test(word) || NEUT.test(word)) ? MATCH.obliqueGender : 0;
                add(w, c + g + (genderClash(text, word) ? MATCH.genderEdit : 0));
              }
            }
          }
        }
      }
    }
    // опечатка в основе при падежном окончании: «сверной» = «северн» + «ой», «красонй» = «красн» + «ой» (перестановка),
    // «бородинскй» = «бородинск» + «ой» — одна правка до косвенной формы слова словаря
    if (k > 0 && len >= 6) {
      const m = letterMask(text);
      const fem = /(ой|ей)$/.test(text);
      for (let L = Math.max(3, len - 4); L <= len - 1; L++) {
        const bucket = v.stemsByLen[L];
        if (!bucket) continue;
        for (const s of bucket) {
          if (popcount((v.stemMask[s] & ~m) >>> 0) > 1) continue;
          const stem = v.stems[s];
          // та же основа с другим окончанием («сормовском» — «сормовск» + «ой») — это падеж, а не опечатка
          if (text.startsWith(stem)) continue;
          let hit = false;
          for (const e of OBLIQUE_ENDINGS) {
            if (Math.abs(L + e.length - len) > 1) continue;
            if (damerauFull(text, stem + e, 1) === 1) {
              hit = true;
              break;
            }
          }
          if (!hit) continue;
          for (const w of v.stemWords[s]) {
            const word = v.words[w];
            const g = oblique && fem && (MASC.test(word) || NEUT.test(word)) ? MATCH.obliqueGender : 0;
            add(w, typo + MATCH.inflectEdit + g);
          }
        }
      }
    }
    // начало слова: «казбекск» → «казбекская»; с одной опечаткой — от 4 букв
    if (prefix && len >= 1) {
      const lo = lowerBound(v.words, v.sorted, text);
      const found: number[] = [];
      for (let i = lo; i < v.sorted.length; i++) {
        const w = v.sorted[i];
        if (!v.words[w].startsWith(text)) break;
        found.push(w);
      }
      const cap = len <= 1 ? 150 : len === 2 ? 400 : 600;
      if (found.length > cap) found.sort((a, b) => v.mass[b] - v.mass[a]).length = cap;
      const extra = exact !== undefined ? MATCH.prefixWhenExact : 0;
      for (const w of found) {
        const wl = v.words[w].length;
        if (wl === len) continue;
        add(w, extra + MATCH.prefixBase + MATCH.prefixSpan * (1 - len / wl));
      }
      // опечатка в начале из 3 букв («сьо» → «со…») — только запасной ход, когда иначе пусто
      if (!noVowels && (len >= 4 || (relaxed && len === 3))) {
        const first = text.charCodeAt(0);
        for (let L = len; L < v.wordsByLen.length; L++) {
          const bucket = v.wordsByLen[L];
          if (!bucket) continue;
          for (const w of bucket) {
            const word = v.words[w];
            if (word.charCodeAt(0) !== first || word.startsWith(text)) continue;
            const d = prefixDamerau(text, word, 1);
            if (d === 1) add(w, MATCH.prefixBase + MATCH.prefixEdit + MATCH.prefixSpan * (1 - len / word.length));
          }
        }
      }
    }
    return [...best].map(([w, cost]) => ({ w, cost }));
  }

  // ---------------------------------------------------------------- разбор запроса

  /** Выбор варианта кусков (раскладка, транслит) по словарю и разбор на слова. */
  analyze(q: string): QueryToken[] {
    const open = !/[\s,.;]$/.test(q);
    const chunks = chunkVariants(q);
    const scored = chunks.map((variants, ci) => variants.map((v) => this.variantScore(v.text, open && ci === chunks.length - 1)));
    // Весь запрос обычно набран в одном режиме: раскладка или транслит. Режим — по сумме лучших вариантов кусков;
    // кусок уходит из режима, только если другой вариант заметно лучше.
    const bestIn = (ci: number, how: string | null) => {
      let bi = -1;
      chunks[ci].forEach((v, i) => {
        if ((how === null || v.how === how || chunks[ci].length === 1) && (bi < 0 || scored[ci][i] > scored[ci][bi] + 1e-9)) bi = i;
      });
      return bi;
    };
    let mode: string | null = null;
    if (chunks.some((c) => c.length > 1)) {
      let best = -Infinity;
      for (const how of ["as-is", "layout", "translit"]) {
        let total = 0;
        chunks.forEach((c, ci) => {
          const bi = bestIn(ci, how);
          total += bi >= 0 ? scored[ci][bi] : scored[ci][0];
        });
        if (total > best + 1e-9) {
          best = total;
          mode = how;
        }
      }
    }
    const chosen = chunks.map((variants, ci) => {
      const inMode = bestIn(ci, mode);
      const any = bestIn(ci, null);
      const bi = inMode < 0 || scored[ci][any] > scored[ci][inMode] + 2 ? any : inMode;
      return variants[bi].text;
    });
    let toks = this.regroup(tokenize(chosen.join(" "), open));
    // «24B» — и 24В, и 24Б: второе прочтение латинской литеры — отдельный ответ
    const twins = /[a-z]/i.test(q) ? houseLetterTwins(q) : null;
    if (twins?.size) {
      toks = toks.map((t) => {
        const tw = t.kind === "h" && t.house ? twins.get(t.house) : undefined;
        return tw && tw !== t.house ? { ...t, houseTwins: [tw] } : t;
      });
    }
    // длинный полный адрес ФИАС («Россия, 350000, Краснодарский край, городской округ город Краснодар, …, ул. Российская,
    // д. 267/4»): сначала без слов региона, затем — последние слова (улица и дом в таком адресе в конце)
    if (toks.length > MAX_TOKENS) toks = toks.filter((t) => !(t.kind === "w" && t.fn === "region"));
    return toks.length > MAX_TOKENS ? toks.slice(toks.length - MAX_TOKENS) : toks;
  }

  /**
   * Слова, склеенные или разделённые не там:
   *  - тип улицы слитно с названием («улКрасная», «Краснаяул», «прЧекистов», «Геофизиковул») — отдельным словом, если
   *    целиком слово не похоже ни на что, а без типа совпадает точно;
   *  - часть слитного названия через пробел («Кубано Набережная» = «Кубанонабережная»), если первой части нет в словаре.
   */
  private regroup(toks: QueryToken[]): QueryToken[] {
    const v = this.ix.vocab;
    const out: QueryToken[] = [];
    const bestCost = (text: string, prefix: boolean) => {
      let c = Infinity;
      for (const m of this.matchWord(text, prefix, false)) if (m.cost < c) c = m.cost;
      return c;
    };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const nx = toks[i + 1];
      if (t.kind === "w" && !t.fn && !t.abbr && t.text.length >= 3 && !v.ids.has(t.text) && nx?.kind === "w" && !nx.comma) {
        const joined = t.text + nx.text;
        let ok = v.ids.has(joined);
        if (!ok && nx.prefix) {
          const lo = lowerBound(v.words, v.sorted, joined);
          ok = lo < v.sorted.length && v.words[v.sorted[lo]].startsWith(joined);
        }
        if (ok) {
          out.push({ ...nx, text: joined, fn: null, comma: t.comma });
          i++;
          continue;
        }
      }
      // два слова названия слитно строчными: «митрофанаседина10», «карламаркса20» — если в каком-то названии эти
      // слова идут подряд, а целиком слово ни на что не похоже
      if (t.kind === "w" && !t.fn && t.text.length >= 8 && !v.ids.has(t.text) && bestCost(t.text, t.prefix) > MATCH.edit1) {
        const split = this.splitGlued(t.text);
        if (split) {
          out.push({ ...t, text: split[0], prefix: false }, { ...t, text: split[1], comma: false });
          continue;
        }
      }
      if (t.kind === "w" && !t.fn && t.text.length >= 5 && !v.ids.has(t.text) && bestCost(t.text, t.prefix) > MATCH.edit1) {
        const m = GLUED_TYPE_HEAD.exec(t.text) ?? GLUED_TYPE_TAIL.exec(t.text);
        if (m) {
          const head = GLUED_TYPE_HEAD.test(t.text);
          const type = head ? m[1] : m[2];
          const rest = head ? m[2] : m[1];
          if (bestCost(rest, t.prefix && head) <= (t.prefix && head ? 0.2 : MATCH.stem + 0.02)) {
            const typeTok: QueryToken = { kind: "w", text: type, fn: functionKind(type), prefix: false, comma: false, houseMarker: false };
            const restTok: QueryToken = { ...t, text: rest, comma: false };
            if (head) out.push({ ...typeTok, comma: t.comma }, restTok);
            else out.push({ ...restTok, comma: t.comma, prefix: false }, { ...typeTok, prefix: t.prefix });
            continue;
          }
        }
      }
      out.push(t);
    }
    return out;
  }

  /** Слово → два слова словаря, стоящие подряд в одном названии («митрофанаседина» → «митрофана седина»); нет — null. */
  private splitGlued(text: string): [string, string] | null {
    const v = this.ix.vocab;
    let best: [string, string] | null = null;
    for (let i = 3; i <= text.length - 3; i++) {
      const a = v.ids.get(text.slice(0, i));
      const b = v.ids.get(text.slice(i));
      if (a === undefined || b === undefined) continue;
      const next = new Set<number>();
      for (const p of this.ix.postings[a]) next.add(p + 1);
      if (!this.ix.postings[b].some((p) => next.has(p))) continue;
      // из нескольких разрезов — где короче более короткая часть длиннее («карла маркса», а не «карл амаркса»)
      if (!best || Math.min(i, text.length - i) > Math.min(best[0].length, best[1].length)) best = [text.slice(0, i), text.slice(i)];
    }
    return best;
  }

  /** Насколько вариант куска похож на адрес: слова словаря, служебные слова, номера. Латиница — минус. */
  private variantScore(text: string, last: boolean): number {
    // одна цифра внутри слова («кра3ная», «заводск0я») — скорее буква-двойник, чем номер
    let s = /[а-я][0346][а-я]|(?:^|[^0-9а-я])[03][а-я]{4,}/.test(text) ? -3 : 0;
    for (const w of text.split(/[^а-яa-z]+/)) if (w && functionKind(w) === "apartment") s += 1.5;
    for (const t of tokenize(text, last)) {
      if (/[a-z]/.test(t.text)) s -= 1;
      else if (t.kind !== "w") s += t.kind === "n" ? 1 : 2;
      else if (t.fn && t.text.length > 1) s += 2.5;
      else {
        const m = this.matchWord(t.text, t.prefix, false);
        let c = 1;
        for (const x of m) if (x.cost < c) c = x.cost;
        // опечатки на мусоре тоже что-то находят — их вклад слабее точного и основы
        if (m.length && t.text.length === 1) s += 0.3; // инициал
        else if (m.length) s += c <= MATCH.phonetic ? 3 * (1 - c) : Math.max(0, 3 * (1 - 2 * c));
        else s += t.fn ? (t.fn === "filler" ? 0.3 : 0.8) : -1;
      }
    }
    return s;
  }

  // ---------------------------------------------------------------- кандидаты

  /** Слова словаря, которые начинаются с `text` (недонабранное слово в середине запроса: «Селезн 100»). */
  private prefixMatches(text: string): WordMatch[] {
    const key = `p${text}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const v = this.ix.vocab;
    const res: WordMatch[] = [];
    for (let i = lowerBound(v.words, v.sorted, text); i < v.sorted.length && res.length < 200; i++) {
      const w = v.sorted[i];
      const word = v.words[w];
      if (!word.startsWith(text)) break;
      if (word.length > text.length) res.push({ w, cost: MATCH.midPrefix + MATCH.prefixBase + MATCH.prefixSpan * (1 - text.length / word.length) });
    }
    this.cache.set(key, res);
    return res;
  }

  /** `info.weak` — слова, найденные только началом другого слова («Зап.» → «Западно…», «Западный»). */
  private candidates(tokens: QueryToken[], relaxed = false, dead = 0, poiHint = false, info?: { weak: number }): Map<number, Cand> {
    const ix = this.ix;
    // форма → [позиция, токен, цена]…
    const perForm = new Map<number, number[]>();
    const v = ix.vocab;
    tokens.forEach((t, ti) => {
      if (t.kind === "h" || dead & (1 << ti)) return;
      // «д.», «дом» перед номером — метка номера, а не буква названия («проезд Ковтюха, д. 144» — не «проезд им. Д. Ковтюха»)
      if (t.kind === "w" && t.fn === "house" && tokens[ti + 1]?.houseMarker) return;
      const numeric = t.kind !== "w";
      const prev = tokens[ti - 1];
      // после предлога или типа улицы в косвенном падеже («в переулке Майском», «на улице Мира»)
      const oblique = !numeric && !!prev && prev.kind === "w" && (PREPOSITIONS.has(prev.text) || OBLIQUE_TYPES.test(prev.text));
      let matches = this.matchWord(t.text, t.prefix && !numeric, numeric, oblique, relaxed && t.prefix);
      // служебное слово целиком («шоссе», «ст», «край») — только точно или падежом, не опечаткой:
      // «шоссе неытяноив» — не «Щорса»
      if (t.fn && t.fn !== "title" && !t.prefix && !numeric) matches = matches.filter((m) => m.cost <= MATCH.stem + 0.02);
      // недонабранное слово в середине: «Селезн 100», «Метальник 11» — начало слова, если целиком ничего нет
      // («Зап. Кругликовская», «Вост-Кругликовская» — сокращение с точкой или дефисом — от 3 букв)
      else if (!numeric && !t.prefix && !t.fn && t.text.length >= (t.abbr ? 3 : 4) && !matches.some((m) => m.cost <= MATCH.stem + 0.02)) {
        // слабое — только если и опечаткой ничего не нашлось (длинное «Новатитаровскя» — пункт, а не начало слова)
        if (info && (t.abbr || t.text.length < 5 || !matches.some((m) => m.cost <= MATCH.edit2 + MATCH.stemEditExtra))) info.weak |= 1 << ti;
        matches = matches.concat(this.prefixMatches(t.text));
      }
      // «наб.» — и тип, и слово названия («Набережная улица»)
      if (t.fn === "street-type") {
        const extra: WordMatch[] = [];
        for (const ty of (streetTypeOf(t.text) ?? "").split("|")) {
          const id = v.ids.get(ty);
          if (id !== undefined && ty !== t.text) extra.push({ w: id, cost: MATCH.stem });
        }
        if (extra.length) matches = matches.concat(extra);
      }
      // голое число уступает порядковому: «1 пр. 1-й Мартыновский» — «1-й» в названии, «1» — дом
      const nPenalty = t.kind === "n" ? 0.001 : 0;
      for (const { w, cost: c0 } of matches) {
        const cost = c0 + nPenalty;
        const post = ix.postings[w];
        for (let i = 0; i < post.length; i++) {
          const p = post[i];
          const f = p >> 5;
          let arr = perForm.get(f);
          if (!arr) perForm.set(f, (arr = []));
          arr.push(p & 31, ti, cost);
        }
      }
    });
    const best = new Map<number, Cand>();
    for (const [f, arr] of perForm) {
      const form = ix.forms[f];
      const n = arr.length / 3;
      const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => arr[a * 3 + 2] - arr[b * 3 + 2]);
      let posUsed = 0;
      let mask = 0;
      let numMask = 0;
      let got = 0;
      let typedGot = 0;
      let numGot = 0;
      let anchor = false;
      let lastTok = -1;
      let prefPos = -1;
      let prefCost = 1;
      let maxPos = -1;
      const tiAt: number[] = [];
      for (const i of idx) {
        const pos = arr[i * 3];
        const ti = arr[i * 3 + 1];
        const cost = arr[i * 3 + 2];
        if (posUsed & (1 << pos) || mask & (1 << ti)) continue;
        posUsed |= 1 << pos;
        mask |= 1 << ti;
        tiAt[pos] = ti;
        const g = form.weights[pos] * (1 - cost);
        got += g;
        // недонабранное слово — долей набранных букв: «же» у «женус» — 0,4; начало сокращения или слитного
        // названия («стад» у «стадц», «оз» у «озмолл») — не набранное название
        const tw = tokens[ti];
        const wl = v.words[form.words[pos]].length;
        typedGot += tw.prefix && tw.kind === "w" && tw.text.length < wl ? (form.compound ? 0 : form.weights[pos] * Math.min(1 - cost, tw.text.length / wl)) : g;
        if (tokens[ti].kind === "n") {
          numMask |= 1 << ti;
          numGot += g;
        }
        if (!this.ix.vocab.numeric[form.words[pos]] && form.weights[pos] >= 0.5) anchor = true;
        if (ti > lastTok) lastTok = ti;
        if (pos > maxPos) maxPos = pos;
        if (tokens[ti].prefix && tokens[ti].kind === "w") {
          prefPos = pos;
          prefCost = cost;
        }
      }
      // сокращение одной буквой рядом с совпавшим словом: «Н. Адыгея» = «Новая Адыгея», «К. Маркса»
      if (anchor && posUsed !== (1 << form.words.length) - 1) {
        for (let pos = 0; pos < form.words.length; pos++) {
          if (posUsed & (1 << pos)) continue;
          const first = v.words[form.words[pos]][0];
          const near = [tiAt[pos + 1] !== undefined ? tiAt[pos + 1] - 1 : -1, tiAt[pos - 1] !== undefined ? tiAt[pos - 1] + 1 : -1];
          for (const ti of near) {
            const t = tokens[ti];
            if (!t || mask & (1 << ti) || t.kind !== "w" || t.text.length !== 1 || t.text !== first || v.words[form.words[pos]].length < 2) continue;
            posUsed |= 1 << pos;
            mask |= 1 << ti;
            got += form.weights[pos] * (1 - (t.abbr ? MATCH.initialAbbr : MATCH.initial));
            typedGot += form.weights[pos] * (1 - (t.abbr ? MATCH.initialAbbr : MATCH.initial));
            break;
          }
        }
      }
      const kind = form.ent & 3;
      // набирается слово названия, дальше в названии ещё слова: «Никол» → «Николая Кондратенко»
      // (только точное начало слова, не опечатка: «галерея» ≠ «Валерия Гассия»)
      let trail = 0;
      if (prefPos >= 0 && prefPos === maxPos && prefPos < form.words.length - 1 && kind !== ENT_POI && prefCost < MATCH.edit1) {
        let rest = 0;
        for (let pos = prefPos + 1; pos < form.words.length; pos++) {
          rest += form.weights[pos];
          trail |= 1 << pos;
        }
        got += RANK.trailCredit * rest;
      }
      // необязательные слова (личные имена), которых нет в запросе, почти не снижают покрытие:
      // «Покрышкина» ≈ «Александра Покрышкина»
      let missOpt = 0;
      let missInner = false;
      // у объекта необязательны все слова, кроме первого, — но только если совпало два слова или назван вид
      // («Кубанский университет», «ТЦ OZ»); одно недонабранное слово («Иса», «Стад») — не «ЖК ISAY Парк»
      if (form.optional && (kind !== ENT_POI || poiHint || popcount(posUsed >>> 0) >= 2)) {
        // у объекта из 3+ слов, если совпало два, необязательно и первое: «Аграрный университет» =
        // «Кубанский государственный аграрный университет»
        const opt = kind === ENT_POI && popcount(posUsed >>> 0) >= 2 && form.words.length >= 3 && !v.numeric[form.words[0]] ? form.optional | 1 : form.optional;
        for (let pos = 0; pos < form.words.length; pos++) {
          if (opt & (1 << pos) && !((posUsed | trail) & (1 << pos))) {
            missOpt += form.weights[pos];
            if (pos < maxPos) missInner = true;
          }
        }
      }
      const total = form.total - (1 - MATCH.optionalMiss) * missOpt;
      const cov = got / total;
      // только числа совпали — годится лишь целиком числовая улица («6-я улица»), не пункт «СТ №1»
      if (!anchor && (kind !== ENT_STREET || cov < 0.999)) continue;
      if (cov < (kind === ENT_STREET ? 0.4 : 0.5)) continue;
      // лучшая форма сущности — по покрытию; при близком покрытии — та, что объясняет больше слов запроса
      // («вокзал Краснодар-2»: форма с видом «вокзал краснодар 2», а не только «краснодар 2»)
      const prev = best.get(form.ent);
      const full = missOpt === 0 && cov >= 0.95;
      const typed = typedGot / total;
      // название набирается по порядку: два слова и больше («красная пл», «оз м», «мега ад») — объект назван, а не угадан
      // по началу одного слова («красная» — ещё и улица)
      const typedWhole = typed >= RANK.poiTypedWhole || popcount(posUsed >>> 0) >= 2;
      if (!prev || cov + 0.08 * popcount(mask >>> 0) > prev.cov + 0.08 * popcount(prev.mask >>> 0) + 1e-9) {
        best.set(form.ent, {
          ent: form.ent, cov, mask, numMask, covNoNum: (got - numGot) / total, lastTok, missOpt: missOpt > 0, missInner, full: full || !!prev?.full,
          typed: Math.max(typed, prev?.typed ?? 0), typedWhole: typedWhole || !!prev?.typedWhole,
        });
      } else {
        if (full) prev.full = true;
        prev.typed = Math.max(prev.typed, typed);
        if (typedWhole) prev.typedWhole = true;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- места

  /** Подпись пункта: «Краснодар», «Краснодар, Юбилейный», «СНТ Кубаночка». */
  placeLabel(p: number): string {
    const ix = this.ix;
    if (p < 0) return "";
    const pl = ix.places[p];
    if ((pl.kind === "microdistrict" || pl.kind === "district") && pl.settlement !== p) return `${ix.places[pl.settlement].name}, ${pl.name}`;
    if (pl.kind === "okrug" && pl.settlement !== p) return ix.places[pl.settlement].name;
    return pl.name;
  }

  private streetLabels = new Map<number, string>();

  /** Подпись улицы: её пункт; у улицы без пункта в данных — ближайший населённый пункт (не пустая строка). */
  streetLabel(st: StreetRec): string {
    const own = this.placeLabel(st.place);
    if (own) return own;
    let label = this.streetLabels.get(st.idx);
    if (label === undefined) {
      const p = this.nearestSettlement(st.lat, st.lon, 30);
      label = p >= 0 ? this.ix.places[p].name : "";
      this.streetLabels.set(st.idx, label);
    }
    return label;
  }

  /** Ближайший населённый пункт (город, посёлок, СНТ) — от края застройки, не дальше maxKm; нет — −1. */
  nearestSettlement(lat: number, lon: number, maxKm: number): number {
    const ix = this.ix;
    let best = -1;
    let bestD = maxKm;
    ix.places.forEach((p, i) => {
      if (p.settlement !== i) return;
      const d = Math.max(0, haversineKm(p, { lat, lon }) - p.radiusKm);
      if (d < bestD || (d === bestD && best >= 0 && p.houses > ix.places[best].houses)) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private contexts = new Map<number, string>();

  /**
   * Где садовое товарищество: пункт-родитель или ближайший населённый пункт (не СНТ) до 10 км — чтобы пять
   * «СНТ Строитель» различались: «садовое товарищество, Елизаветинская». Не СНТ — пустая строка.
   */
  placeContext(p: number): string {
    const ix = this.ix;
    if (p < 0 || ix.places[p].kind !== "snt") return "";
    let label = this.contexts.get(p);
    if (label !== undefined) return label;
    const pl = ix.places[p];
    const parent = pl.parent >= 0 ? ix.places[pl.parent].settlement : -1;
    let best = parent >= 0 && parent !== p && ix.places[parent].kind !== "snt" ? parent : -1;
    if (best < 0) {
      let bestD = 10;
      ix.places.forEach((q, i) => {
        if (q.settlement !== i || q.kind === "snt" || i === p) return;
        const d = Math.max(0, haversineKm(q, pl) - q.radiusKm);
        if (d < bestD || (d === bestD && best >= 0 && q.houses > ix.places[best].houses)) {
          bestD = d;
          best = i;
        }
      });
    }
    label = best >= 0 ? ix.places[best].name : "";
    this.contexts.set(p, label);
    return label;
  }

  /**
   * Совместим ли названный пункт с улицей: 1 — сам пункт, его предок или часть (микрорайон рядом);
   * 0 — «может быть»: назван город, а улица в посёлке или СНТ у его границы (посёлки в черте Краснодара
   * пишут и «Краснодар, …»); −1 — другой пункт.
   */
  private placeFit(p: number, streetPlace: number, lat: number, lon: number, spatial = true): 1 | 0 | -1 {
    const ix = this.ix;
    if (streetPlace < 0) return -1;
    for (let q = streetPlace, guard = 0; q >= 0 && guard < 8; q = ix.places[q].parent, guard++) if (q === p) return 1;
    const pl = ix.places[p];
    const sp = ix.places[streetPlace];
    // округ города: границ округов в индексе нет — «может быть»
    if (pl.kind === "okrug" && pl.settlement === sp.settlement) return 0;
    // микрорайон / СНТ внутри пункта улицы — по расстоянию
    if (pl.settlement === sp.settlement || pl.parent === streetPlace) {
      return haversineKm(pl, { lat, lon }) <= Math.max(2.5, pl.radiusKm * 1.5) ? 1 : -1;
    }
    // микрорайон — место на карте, а не граница из справочника: улица соседнего посёлка или СНТ в нём тоже
    // («Вектор, Земляничная 55» — СНТ рядом с микрорайоном Вектор в Яблоновском; «Любимово, Апшеронская 8»)
    if (spatial && (pl.kind === "microdistrict" || pl.kind === "district")) return haversineKm(pl, { lat, lon }) <= Math.max(1.5, pl.radiusKm * 1.5) ? 1 : -1;
    const s = ix.places[sp.settlement];
    if (pl.kind === "city" && (s.kind === "village" || s.kind === "hamlet" || s.kind === "snt") && haversineKm(pl, s) <= pl.radiusKm + 3) return 0;
    return -1;
  }

  /**
   * Названный пункт q — не лишний для кандидата в пункте p: предок или часть p (микрорайон, округ того же города),
   * посёлок в черте города. Главный пункт кандидата выбирается отдельно (варианты в rank), здесь — «не мешает».
   */
  private absorbable(q: number, p: number, lat: number, lon: number, spatial = true): boolean {
    const ix = this.ix;
    const ql = ix.places[q];
    if ((ql.kind === "microdistrict" || ql.kind === "okrug" || ql.kind === "district") && ql.settlement === ix.places[p].settlement) return true;
    return this.placeFit(q, p, lat, lon, spatial) >= 0;
  }

  private homeCache = { key: "", home: -1 };

  /**
   * Пункт, в застройке которого `near`, — если это не единственный такой пункт: посёлок у края большого города
   * (Яблоновский за рекой от Краснодара); СНТ не считаются. Радиус застройки города накрывает и его, поэтому близость
   * пункта (от края застройки) у города и посёлка одинакова — и одноимённая улица города выигрывает у своей.
   * −1 — `near` в одном пункте (в самом городе) или вне застройки: там близость пункта и так различает.
   */
  private homeOf(near: { lat: number; lon: number }): number {
    const key = `${near.lat},${near.lon}`;
    if (this.homeCache.key === key) return this.homeCache.home;
    const ix = this.ix;
    let home = -1;
    let inside = 0;
    ix.places.forEach((p, i) => {
      if (p.settlement !== i || haversineKm(p, near) > p.radiusKm) return;
      inside++;
      if (home < 0 || p.radiusKm < ix.places[home].radiusKm) home = i;
    });
    // СНТ — не «свой» пункт: садовые товарищества мелкие и стоят вплотную, соседнее так же вероятно
    if (inside < 2 || (home >= 0 && ix.places[home].kind === "snt")) home = -1;
    this.homeCache = { key, home };
    return home;
  }

  private proximity(settlement: number, lat: number, lon: number, near: { lat: number; lon: number }): number {
    const ix = this.ix;
    let s = 0;
    if (settlement >= 0 && settlement === this.homeOf(near)) s += RANK.nearHome;
    if (settlement >= 0) {
      const pl = ix.places[settlement];
      const d = Math.max(0, haversineKm(pl, near) - pl.radiusKm);
      s += RANK.nearPlace * Math.exp(-d / RANK.nearPlaceKm);
    }
    s += RANK.nearPoint * Math.exp(-haversineKm({ lat, lon }, near) / RANK.nearPointKm);
    return s;
  }

  // ---------------------------------------------------------------- дома

  /**
   * Почтовый индекс дома j; у дома его нет (здание OSM без индекса) — индекс ближайшего дома той же улицы не дальше
   * 300 м (зона индекса сплошная). 0 — не знаем.
   */
  private postOf(j: number, a: number, b: number): number {
    const ix = this.ix;
    if (ix.hPost[j]) return ix.hPost[j];
    let best = 0;
    let bestD = 0.3;
    const at = { lat: ix.hLat[j], lon: ix.hLon[j] };
    const look = (k: number) => {
      if (!ix.hPost[k] || ix.hPrec[k] > 1) return;
      const d = haversineKm(at, { lat: ix.hLat[k], lon: ix.hLon[k] });
      if (d <= bestD) {
        bestD = d;
        best = ix.hPost[k];
      }
    };
    for (let k = a; k < b; k++) look(k);
    if (best || ix.hPrec[j] > 1) return best;
    // на улице индексов нет — ближайший дом с индексом рядом (соседняя улица того же квартала)
    const grid = this.houseGrid();
    const [ca, cb] = this.cellOf(at.lat, at.lon);
    for (let x = ca - 1; x <= ca + 1; x++) for (let y = cb - 1; y <= cb + 1; y++) for (const k of grid.get(x * GRID_KEY + y) ?? []) look(k);
    return best;
  }

  /** Дом по ключу в отрезке [a, b); нет — `-1`. */
  private findHouse(a: number, b: number, key: string): number {
    const ix = this.ix;
    const num = houseParts(key).num;
    for (let j = a; j < b; j++) {
      if (ix.hNum[j] > num) break;
      if (ix.hKey[j] === key) return j;
    }
    return -1;
  }

  /**
   * Дома с таким номером нет в данных: точка по соседям той же чётности. Это оценка движка, а не дом: ответ с ней
   * всегда «≈» (`precision: "street"`); `precision` здесь — только способ оценки (между соседями или у улицы).
   * `fit` — насколько правдоподобно, что такой дом на этой улице есть: тот же номер с другим корпусом (1),
   * соседи той же чётности рядом (0,9…0,5), сосед с одной стороны (0,2), номер далеко за краем нумерации (−0,4).
   */
  private approxHouse(a: number, b: number, key: string, fallback: { lat: number; lon: number }): { lat: number; lon: number; precision: AddrPrecision; fit: number } {
    const ix = this.ix;
    const { num, letter } = houseParts(key);
    if (num < 0 || a >= b) return { ...fallback, precision: "street", fit: 0 };
    // тот же дом с другим корпусом / строением / без буквы: «21к1» → «21к1с6», «21»
    // соседи — только дома с настоящей точкой (здание OSM или интерполяция), не «точка улицы» из ГАР
    let same = -1;
    for (let j = a; j < b; j++) {
      if (ix.hNum[j] !== num || ix.hPrec[j] > 1) continue;
      const p = houseParts(ix.hKey[j]);
      if (same < 0 || (p.letter === letter && houseParts(ix.hKey[same]).letter !== letter) || (!p.rest && !p.letter)) same = j;
    }
    if (same >= 0) return { lat: ix.hLat[same], lon: ix.hLon[same], precision: "interpolated", fit: 1 };
    let lo = -1;
    let hi = -1;
    for (let j = a; j < b; j++) {
      const n = ix.hNum[j];
      if (n < 0 || n % 2 !== num % 2 || ix.hPrec[j] > 1) continue;
      if (n < num && (lo < 0 || n >= ix.hNum[lo])) lo = j;
      if (n > num && (hi < 0 || n < ix.hNum[hi])) hi = j;
    }
    if (lo >= 0 && hi >= 0) {
      const span = ix.hNum[hi] - ix.hNum[lo];
      const km = haversineKm({ lat: ix.hLat[lo], lon: ix.hLon[lo] }, { lat: ix.hLat[hi], lon: ix.hLon[hi] });
      if (span <= 40 && km <= 0.8) {
        const t = (num - ix.hNum[lo]) / span;
        return {
          lat: ix.hLat[lo] + t * (ix.hLat[hi] - ix.hLat[lo]), lon: ix.hLon[lo] + t * (ix.hLon[hi] - ix.hLon[lo]), precision: "interpolated",
          fit: span <= 6 ? 0.9 : span <= 16 ? 0.7 : 0.5,
        };
      }
    }
    const nb = [lo, hi].filter((j) => j >= 0).sort((x, y) => Math.abs(ix.hNum[x] - num) - Math.abs(ix.hNum[y] - num))[0];
    if (nb !== undefined && Math.abs(ix.hNum[nb] - num) <= 12) return { lat: ix.hLat[nb], lon: ix.hLon[nb], precision: "street", fit: 0.2 };
    // номер далеко за последним домом улицы — такого дома тут, скорее всего, нет
    let maxNum = -1;
    for (let j = a; j < b; j++) if (ix.hNum[j] > maxNum) maxNum = ix.hNum[j];
    const far = b - a >= 5 && maxNum >= 0 && num > maxNum * 2 + 20;
    return { ...fallback, precision: "street", fit: far ? -0.4 : 0 };
  }

  // ---------------------------------------------------------------- ранжирование

  rank(q: string, near: { lat: number; lon: number } | null | undefined, mode: "suggest" | "geocode" = "geocode"): Scored[] {
    const ix = this.ix;
    const tokens = this.analyze(q);
    if (!tokens.length) return [];
    const at = near ?? ix.center;
    // «Краснодарский край», «Динской р-н», «Республика Адыгея», «городское поселение» — регион, не название улицы
    let dead = 0;
    // «р-н Тахтамукайский», «район Динской» — тип района перед именем (порядок ФИАС и Почты) — тоже регион
    const regionish = (t: QueryToken | undefined) => t?.kind === "w" && (t.fn === "region" || DISTRICT_TYPES.has(t.text));
    tokens.forEach((t, ti) => {
      if (!regionish(t)) return;
      if (regionish(tokens[ti - 1]) || regionish(tokens[ti + 1])) dead |= 1 << ti;
    });
    // имя поселения перед «сельское/городское поселение» («Южно-Кубанское сельское поселение, пос. Южный») — муниципальное
    // образование, а не пункт: не совпало ни с чем — не лишнее слово
    let soft = 0;
    tokens.forEach((t, ti) => {
      if (t.kind !== "w" || !/^(сельск|городск)(ое|ого)$/.test(t.text) || !/^поселени/.test(tokens[ti + 1]?.text ?? "")) return;
      for (let j = ti - 1, n = 0; j >= 0 && n < 3 && tokens[j].kind === "w" && !tokens[j].fn; j--, n++) {
        soft |= 1 << j;
        if (tokens[j].comma) break;
      }
    });
    // слово региона сразу после типа пункта — имя пункта («ст. Динской», «х. Городской»): лишнее — как обычное слово
    const regionName = tokens.map((t, ti) => t.kind === "w" && t.fn === "region" && tokens[ti - 1]?.kind === "w" && tokens[ti - 1].fn === "place-type"
      && !DISTRICT_TYPES.has(tokens[ti - 1].text));
    // номер дома помечен («д. 17») — голое число перед ним не дом, а часть названия («Северный 1 д. 17»): лишнее — как порядковое
    const markerAt = tokens.findIndex((t) => t.houseMarker);
    // слово сразу после типа: «ст. Калужская» — пункт, «ул. Динская» — улица, «ЖК Янтарный» — объект
    // «мкр Фестивальный» — микрорайон: пункт этого вида или улица-«микрорайон», но не «Фестивальный переулок»
    const ctx: ("street" | "place" | "poi" | "mkr" | null)[] = tokens.map((t, ti) => {
      const p = tokens[ti - 1];
      // слово региона сразу после типа пункта — имя пункта («х. Городской»), но не после «р-н»
      // тип — перед названием в том же куске: «Прикубанский округ, Красных Партизан» — «Красных» не имя округа
      if (!p || p.kind !== "w" || t.kind === "n" || t.kind === "h" || t.comma
        || (t.kind === "w" && t.fn && t.fn !== "title" && !(t.fn === "region" && p.fn === "place-type" && !DISTRICT_TYPES.has(p.text)))) return null;
      // тип после прилагательного — его («Фестивальный микрорайон Краснодар», «Майский переулок 8»), а не следующего слова
      const pp = tokens[ti - 2];
      if (pp?.kind === "w" && !pp.fn && !p.comma && ADJ_END.test(pp.text) && (p.fn === "street-type" || MKR_TYPES.has(p.text))) return null;
      if (POI_TYPES.has(p.text)) return "poi";
      if (MKR_TYPES.has(p.text)) return "mkr";
      if (p.fn === "street-type") return p.text in PLACE_TYPES ? null : "street";
      if (p.fn === "place-type") return "place";
      return null;
    });
    const firstTok = (mask: number): number => {
      for (let ti = 0; ti < tokens.length; ti++) {
        if (!(mask & (1 << ti))) continue;
        const t = tokens[ti];
        if (t.kind === "w" && t.fn && t.fn !== "title" && !ctx[ti]) continue;
        return ti;
      }
      return -1;
    };
    /** `placeKind` — вид пункта-кандидата: «хутор Колос» — хутор, а не СНТ «Колос»; «п. Российский» — посёлок. */
    const ctxTerm = (mask: number, kind: "street" | "place" | "poi", placeKind?: PlaceKind, streetType?: string): number => {
      const ti = firstTok(mask);
      const c = ti >= 0 ? ctx[ti] : null;
      // тип сам вошёл в название: «ул. Г.К. Жукова» («г» — инициал, не «город»), «Сквер Жукова» — слово объекта
      if (!c || mask & (1 << (ti - 1))) return 0;
      if (c === "mkr") {
        if (kind === "street") return streetType === "микрорайон" ? 0 : -RANK.typeContext;
        if (kind === "poi") return 0;
        return placeKind === "microdistrict" ? 2 * RANK.typeMatch : -RANK.typeKindClash;
      }
      if (c === kind || (c === "poi" && kind === "place")) {
        if (kind === "street") return 0;
        const kinds = placeKind ? TYPE_PLACE_KINDS[tokens[ti - 1].text] : undefined;
        // «СНТ Гидростроитель» — не микрорайон Гидрострой; «ЖК Лесной» — не СНТ «Лесное»
        if (kinds && placeKind && !kinds.includes(placeKind)) return -RANK.typeKindClash;
        return RANK.typeMatch + (kinds?.includes(placeKind!) ? RANK.typeMatch : 0);
      }
      return -RANK.typeContext;
    };
    // запрос про объект: вид назван («ТЦ», «ЖК» — любой объект этого вида; «парк», «аэропорт» — если это слово в его названии)
    const kindWordMask = tokens.reduce((m, t, ti) => (t.kind === "w" && (POI_TYPES.has(t.text) || POI_WORDS.has(t.text)) ? m | (1 << ti) : m), 0);
    const typeKinds = new Set(tokens.flatMap((t) => (t.kind === "w" ? POI_TYPE_KINDS[t.text] ?? [] : [])));
    /** Объект или пункт найден целиком — как дом у улицы: все слова — его, и в названии число или вид. */
    const complete = (c: Cand, lo: number, kind: string | null): number => {
      if (lo !== 0 || c.cov < 0.8) return 0;
      if (c.numMask && c.cov >= 0.97) return RANK.poiComplete;
      // вид в названии и ещё слово названия («Парк Краснодар»), или вид назван типом («ТЦ OZ» — торговый центр)
      // вид словом — только если название совпало целиком: «Краевая больница» — не «Краевая наркологическая больница»
      // вид типом — сразу перед названием: «ЖК Панорама Краснодар» — не «ЖК Краснодар»
      const ft = firstTok(c.mask);
      if (kind !== null && ((c.mask & kindWordMask && c.mask & ~kindWordMask && !c.missOpt) || (typeKinds.has(kind) && ft >= 0 && ctx[ft] === "poi"))) return RANK.poiComplete;
      // название из нескольких слов набрано целиком, других слов нет: «Мега Адыгея» — ТЦ «Мега Адыгея-Кубань»
      if (kind !== null && c.cov >= 0.9 && !c.missInner && popcount(c.mask >>> 0) >= 2 && tokens.every((t, ti) => c.mask & (1 << ti) || (t.kind === "w" && t.fn))) return RANK.poiComplete / 2;
      return 0;
    };
    const info = { weak: 0 };
    // «Мега на Тургеневском шоссе», «ЖК Олимпийский у Дзержинского» — слово перед предлогом и улицей скорее объект:
    // его название можно набрать не целиком
    const poiHint = kindWordMask !== 0 || tokens.some((t, ti) => ti > 0 && t.kind === "w" && QUALIFIER_PREPS.has(t.text) && tokens[ti - 1].kind === "w" && !tokens[ti - 1].fn);
    let cands = this.candidates(tokens, false, dead, poiHint, info);
    // ничего не нашлось, а последнее слово набирается — опечатка в первых буквах («Сьо» → «Со…»)
    if (!cands.size && mode === "suggest" && tokens[tokens.length - 1].prefix) cands = this.candidates(tokens, true, dead, poiHint, info);
    const lastPrefix = tokens[tokens.length - 1].prefix ? 1 << (tokens.length - 1) : 0;
    /** Пункт найден лишь началом слова и похож слабо («Зап.» → «Западный округ», «Кубанская На…» → «Набережный»). */
    const weakPlace = (q: Cand, typing: boolean) => q.cov < 0.75 && (q.mask & ~(info.weak | (typing ? lastPrefix : 0))) === 0;
    const streets: Cand[] = [];
    const places: Cand[] = [];
    const pois: Cand[] = [];
    for (const c of cands.values()) {
      const kind = c.ent & 3;
      if (kind === ENT_STREET) streets.push(c);
      else if (kind === ENT_PLACE) places.push(c);
      else if (kind === ENT_POI) pois.push(c);
    }
    streets.sort((a, b) => b.cov - a.cov);
    places.sort((a, b) => b.cov - a.cov);
    pois.sort((a, b) => b.cov - a.cov);
    // пункт с двумя опечатками («Елизавтинкая», «Новтитаровкая» — 0,58) — тоже уточнение улицы
    const topPlaces = places.filter((p) => p.cov >= 0.55).slice(0, 12);

    // Типы улиц в запросе
    const queryTypes: { ti: number; type: string }[] = [];
    tokens.forEach((t, ti) => {
      if (t.kind === "w" && t.fn === "street-type") {
        const ty = streetTypeOf(t.text);
        if (ty) queryTypes.push({ ti, type: ty });
      }
    });

    const leftover = (used: number): number => {
      let pen = 0;
      // повтор уже использованного слова («город Краснодар, город Краснодар») — не лишнее
      const usedText = new Set<string>();
      tokens.forEach((t, ti) => {
        if (used & (1 << ti) && t.kind === "w") usedText.add(stemWord(t.text));
      });
      tokens.forEach((t, ti) => {
        if (used & (1 << ti) || soft & (1 << ti)) return;
        if (t.kind === "w") {
          // «…, Яблоновское городское поселение, пгт Яблоновский» — тот же пункт другим словом
          if (usedText.has(stemWord(t.text)) && !t.prefix) return;
          // недонабранное слово: человек набирает именно его — не подошло, значит кандидат не тот
          // «Кубанская На…» — предлог в конце запроса не бывает: это начало слова («Набережная»)
          if (t.prefix && (!t.fn || t.text.length === 1 || t.fn === "region" || (t.fn === "place-type" && t.text.length <= 2) || (t.fn === "filler" && ti > 0 && t.text.length >= 2))) {
            pen += Math.min(RANK.leftoverPrefix, t.text.length >= 5 ? RANK.leftoverLong : RANK.leftoverWord);
            return;
          }
          if (t.fn && !regionName[ti]) return;
          pen += t.text.length <= 2 ? RANK.leftoverShort : t.text.length >= 5 ? RANK.leftoverLong : RANK.leftoverWord;
        } else if (t.kind === "o" || (t.kind === "n" && markerAt > ti)) pen += RANK.leftoverOrdinal;
        else pen += RANK.leftoverNumber;
      });
      return pen;
    };
    const typeTerm = (used: number, st: StreetRec, named: boolean): number => {
      let s = 0;
      for (const qt of queryTypes) {
        if (used & (1 << qt.ti)) continue;
        s += qt.type.split("|").includes(st.type) ? RANK.typeMatch : st.type ? RANK.typeMismatch : 0;
      }
      // тип не назван, а в пункте есть тёзка другого типа — вероятнее «улица» («Есенина 10», «8 Марта 10»)
      // только в подсказках: для импорта «Герцена, 38» при улице и проезде Герцена остаётся неоднозначным
      if (mode === "suggest" && !queryTypes.length && named && st.typeSibling && st.type === "улица") s += RANK.impliedStreet;
      // род порядкового: «1-я Заречн» — «улица 1-я Заречная», а не «1-й Заречный проезд»
      if (st.ordGender) {
        tokens.forEach((t, ti) => {
          if (t.kind === "o" && t.gender && used & (1 << ti)) s += t.gender === st.ordGender ? RANK.ordGenderMatch : RANK.ordGenderMismatch;
        });
      }
      return s;
    };
    /** Тип улицы назван явно: совпал (true) / другой (false); не назван — null. */
    /** Тип относится к другому названию запроса: «мкр. Юбилейный, Чекистов 26» — «мкр» у пункта, не у улицы. */
    const typeOfOther = (qt: { ti: number }, used: number, streetMask: number) => !!(used & ~streetMask & (1 << (qt.ti + 1)));
    const typeOkOf = (used: number, st: StreetRec, streetMask: number): boolean | null => {
      let res: boolean | null = null;
      for (const qt of queryTypes) {
        if (used & (1 << qt.ti) || !st.type || typeOfOther(qt, used, streetMask)) continue;
        if (qt.type.split("|").includes(st.type)) return true;
        res = false;
      }
      return res;
    };
    /**
     * Номер дома из оставшихся: с «д.» → после улицы, ближайший к ней («Красная 120, 44» — 120, а 44 — квартира;
     * «Красная 120, 3 подъезд») → с буквой/корпусом → до улицы, ближайший к ней («111 улица Абрикосовая»).
     */
    const pickHouse = (used: number, after: number): number => {
      let bestTi = -1;
      let bestRank = -Infinity;
      tokens.forEach((t, ti) => {
        if (used & (1 << ti) || (t.kind !== "n" && t.kind !== "h")) return;
        const r = (t.houseMarker ? 800 : 0) + (ti > after ? 200 : 0) + (t.kind === "h" ? 100 : 0) - Math.abs(ti - after);
        if (r > bestRank) {
          bestRank = r;
          bestTi = ti;
        }
      });
      return bestTi;
    };

    // служебные слова, совпавшие со словами названия («имени Есенина», «Героя Аверкиева») — плюс
    let fnMask = 0;
    tokens.forEach((t, ti) => {
      if (t.kind === "w" && t.fn) fnMask |= 1 << ti;
    });

    /**
     * Другие названные пункты, совместимые с местом кандидата, — не лишние слова: «г. Краснодар, п. Российский,
     * ул. Пинская», «Краснодар, ЮМР, Чекистов 26», «Краснодар, Прикубанский округ, …».
     */
    const absorb = (placeIdx: number, lat: number, lon: number, taken: number, hoods?: number[]): number => {
      let m = 0;
      if (placeIdx < 0) return 0;
      for (const q of topPlaces) {
        if (q.mask & (taken | m)) continue;
        // похоже лишь началом или сокращением («Кубанская На…» — «Набережный»?, «Зап. Кругликовская» — «Западный
        // округ»?) — не пункт; тип перед ним другого вида («СНТ Гидростроитель» — не микрорайон Гидрострой) — тоже
        if (weakPlace(q, true) || ctxTerm(q.mask, "place", ix.places[q.ent >> 2].kind) < 0) continue;
        if (this.absorbable(q.ent >> 2, placeIdx, lat, lon, q.cov >= 0.9 && !(q.mask & lastPrefix))) {
          m |= q.mask;
          const k = ix.places[q.ent >> 2].kind;
          if (hoods && (k === "microdistrict" || k === "district")) hoods.push(q.ent >> 2);
        }
      }
      return m;
    };

    // Слова после вида объекта до запятой («ТЦ OZ Mall, ул. Крылатая, 2», «ЖК Ренессанс, ул. Строителей, 21») — имя
    // объекта, где этот адрес: у найденного дома не лишние, даже если такого объекта в данных нет
    let poiSeg = 0;
    tokens.forEach((t, ti) => {
      if (t.kind !== "w" || !POI_TYPES.has(t.text)) return;
      for (let j = ti + 1; j < tokens.length; j++) {
        const u = tokens[j];
        if (u.comma || u.kind === "n" || u.kind === "h" || (u.kind === "w" && u.fn && u.fn !== "title" && u.fn !== "filler")) break;
        poiSeg |= 1 << j;
      }
    });
    /** Слова, которые у найденного дома не лишние: имя объекта перед адресом и объекты не дальше 1 км от дома. */
    const nearPois = (used: number, lat: number, lon: number): { m: number; near: boolean } => {
      let m = poiSeg & ~used;
      let near = false;
      for (const p of pois) {
        if (p.cov < 0.8 || p.mask & used) continue;
        if (haversineKm(ix.pois[p.ent >> 2], { lat, lon }) <= 1) {
          m |= p.mask;
          near = true;
        }
      }
      return { m, near };
    };
    const postcode = queryPostcode(q);

    // Улица с тем же ядром в том же пункте совпала полным названием («улица Ковалёва») — тёзка, найденная только
    // без личного имени («улица Льва Ковалёва»), ниже: человек написал именно «Ковалёва».
    // «В том же пункте» — в том же городе вместе с посёлками в его черте (Пригородный, Индустриальный — Краснодар).
    const fullNamed = new Set<string>();
    for (const c of streets) {
      if (!c.full && (c.missOpt || c.cov < 0.95)) continue;
      const st = ix.streets[c.ent >> 2];
      fullNamed.add(`${this.rootSettlement(st.area)}|${st.core}`);
    }
    // И наоборот: звание набрано («Атамана Кухаренко») и у тёзки с тем же ядром оно есть в названии — улица без него
    // («улица Кухаренко») ниже. «им.», «имени» — не звание: их пишут как угодно.
    const titleToks = tokens.reduce((m, t, ti) => (t.kind === "w" && t.fn === "title" && t.text !== "им" && t.text !== "имени" ? m | (1 << ti) : m), 0);
    const titled = new Map<string, number>();
    if (titleToks) {
      for (const c of streets) {
        if (c.cov < 0.95 || !(c.mask & titleToks)) continue;
        const core = ix.streets[c.ent >> 2].core;
        titled.set(core, (titled.get(core) ?? 0) | (c.mask & titleToks));
      }
    }
    const titleMissed = (c: Cand): boolean => {
      const need = titled.get(ix.streets[c.ent >> 2].core);
      return need !== undefined && (need & ~c.mask) !== 0;
    };

    // Набор по буквам: сколько букв в словах запроса (без служебных) и насколько коротко набираемое слово.
    const letters = tokens.reduce((n, t) => n + (t.kind === "w" && !t.fn ? t.text.length : 0), 0);
    const lastTok = tokens[tokens.length - 1];
    // только если набираемое слово — весь запрос («кр», «ул кр»), а не «мега ад»
    const shortLen = mode === "suggest" && lastPrefix && lastTok.kind === "w" && !lastTok.fn && lastTok.text.length <= 4 && letters === lastTok.text.length ? lastTok.text.length : 0;
    /**
     * «кр», «кра» — улица побольше выше: при коротком начале слова прочих признаков почти нет. Только рядом с `near`:
     * у точки пользователя своя «Садовая» в СНТ важнее большой «Садовой» в городе.
     */
    const shortSize = (c: Cand, st: StreetRec): number =>
      shortLen && c.mask & lastPrefix
        ? RANK.sizeShort * Math.min(1, Math.log10(1 + st.houses) / 3) * Math.min(1, (5 - shortLen) / 3) * Math.exp(-haversineKm(st, at) / RANK.sizeShortKm)
        : 0;

    const out: Scored[] = [];
    const streetLimit = Math.min(streets.length, 400);
    for (let si = 0; si < streetLimit; si++) {
      const c = streets[si];
      const st = ix.streets[c.ent >> 2];
      const settlement = st.area >= 0 ? ix.places[st.area].settlement : -1;
      const ctxStreet = ctxTerm(c.mask, "street", undefined, st.type);
      const ctxPen = ctxStreet - (c.missOpt && !c.full && fullNamed.has(`${this.rootSettlement(st.area)}|${st.core}`) ? RANK.optionalRival : 0)
        - (titleMissed(c) ? RANK.optionalRival : 0);
      // варианты: без пункта и с каждым названным пунктом, чьи слова не заняты улицей
      const options: { place: Cand | null }[] = [{ place: null }];
      // пункт, похожий лишь началом слова в середине адреса («Зап. Кругликовская» — «Западный округ»?), — не пункт
      for (const p of topPlaces) if (!(p.mask & c.mask) && !weakPlace(p, false)) options.push({ place: p });
      for (const { place } of options) {
        const hoods: number[] = [];
        const extra = absorb(st.place, st.lat, st.lon, c.mask | (place ? place.mask : 0), hoods);
        for (const releaseNum of c.numMask ? [false, true] : [false]) {
          const cov = releaseNum ? c.covNoNum : c.cov;
          if (cov < 0.4) continue;
          let used = (releaseNum ? c.mask & ~c.numMask : c.mask) | (place ? place.mask : 0) | extra;
          const hti = pickHouse(used, c.lastTok);
          if (hti >= 0) used |= 1 << hti;
          const fnBonus = RANK.fnWord * popcount((c.mask & fnMask) >>> 0);
          // название набрано целиком (последнее его слово не недонабрано) — для «тип не назван, значит улица»
          const named = c.lastTok >= 0 && !(tokens[c.lastTok].prefix && tokens[c.lastTok].kind === "w");
          // тип перед названным пунктом: «СНТ Гидростроитель» — СНТ, а не микрорайон Гидрострой
          const placeCtx = place ? Math.min(0, ctxTerm(place.mask, "place", ix.places[place.ent >> 2].kind)) : 0;
          const u = used;
          const more: StreetExtra = {
            hoods, postcode, typeOk: typeOkOf(used, st, c.mask),
            // микрорайон соседнего пункта подходит по карте, только если назван целиком (не набираемое «Ве…»)
            spatial: !place || (place.cov >= 0.9 && !(place.mask & lastPrefix)),
            relax: (lat, lon) => {
              const { m, near } = nearPois(u, lat, lon);
              return { lo: leftover(u | m), poi: near };
            },
          };
          const tok = hti >= 0 ? tokens[hti] : null;
          const reads = tok?.houseTwins ? [tok, ...tok.houseTwins.map((h): QueryToken => ({ ...tok, text: h, house: h, houseAlts: undefined, houseTwins: undefined }))] : [tok];
          for (const read of reads) {
            const sc = this.scoreStreet(st, settlement, cov, place, read, used, at, leftover(used), typeTerm(used, st, named) + fnBonus + ctxPen + placeCtx + shortSize(c, st), more);
            // «мкр Музыкальный», «Музыкальный микрорайон» — назван микрорайон, а это переулок: импорт не берёт
            if (ctxStreet < 0 || (more.typeOk === false && queryTypes.some((qt) => !(used & (1 << qt.ti)) && qt.type === "микрорайон" && !typeOfOther(qt, used, c.mask)))) sc.clash = true;
            if (reads.length > 1) sc.letterTwin = true;
            out.push(sc);
          }
        }
      }
    }

    // Пункты (и адреса по пункту без улицы: «СНТ Кубаночка, 15»)
    for (const p of topPlaces.concat(places.filter((x) => x.cov < 0.55 && x.cov >= 0.5).slice(0, 4))) {
      const pi = p.ent >> 2;
      const pl = ix.places[pi];
      const absorbed = absorb(pi, pl.lat, pl.lon, p.mask);
      let used = p.mask | absorbed;
      const hti = pickHouse(used, p.lastTok);
      const pctx = ctxTerm(p.mask, "place", pl.kind);
      let score = RANK.text * p.cov + this.proximity(pl.settlement, pl.lat, pl.lon, at) + kindBonus(pl.kind) + pctx;
      let hit: AddressHit = {
        id: `p:${pl.id}`, kind: "place", title: pl.name, subtitle: placeSubtitle(pl.kind, pl.settlement !== pi ? ix.places[pl.settlement].name : this.placeContext(pi)),
        lat: pl.lat, lon: pl.lon, precision: "place", score: 0, parts: { place: pl.name, street: null, house: null },
      };
      const range = ix.placeHouses.get(pi);
      let postOk: boolean | null = null;
      if (hti >= 0 && range) {
        const tok = tokens[hti];
        let j = this.findHouse(range[0], range[1], tok.house ?? tok.text);
        for (const alt of tok.houseAlts ?? []) if (j < 0) j = this.findHouse(range[0], range[1], alt);
        // в запросе осталось слово — номер, скорее всего, его («Любимово, Апшеронская 8»: дом 8 улицы, а не «Любимово, 8»)
        if (j >= 0 && leftover(used | (1 << hti)) <= RANK.leftoverWord) j = -1;
        if (j >= 0) {
          used |= 1 << hti;
          score += RANK.houseExact;
          const post = postcode ? this.postOf(j, range[0], range[1]) : 0;
          if (post) {
            postOk = post === postcode;
            score += postOk ? RANK.postcode : -RANK.postcode;
          }
          hit = {
            ...hit, id: `ph:${pl.id}:${ix.hKey[j]}`, kind: "house", title: `${pl.name}, ${ix.hRaw[j]}`, subtitle: this.placeLabel(pl.parent),
            lat: ix.hLat[j], lon: ix.hLon[j], precision: PREC[ix.hPrec[j]], parts: { place: pl.name, street: null, house: ix.hRaw[j] },
          };
        }
      }
      const lo = leftover(used);
      // «ЖК Мега Победа 2» — число в названии места («Мега-Победа 2»)
      if (hit.kind === "place") score += complete(p, lo, null);
      // «Динская», «Калужская» — ровно название станицы: не ниже одноимённых улиц (улицы названы по ней). Кроме имени
      // в родительном падеже («хутор Ленина»): и пункт, и улицы названы по человеку, улица Ленина — в каждом пункте
      if (hit.kind === "place" && SETTLEMENT_KINDS.has(pl.kind) && p.cov >= 0.97 && lo === 0 && pctx >= 0 && !GENITIVE_NAME.test(pl.name.toLowerCase())
        // звание — не служебное слово, а, может быть, имя объекта («ЖК Маршал Краснодар»)
        && tokens.every((t, ti) => t.kind === "w" && (p.mask & (1 << ti) || (t.fn && t.fn !== "title")))) score += RANK.placeNamed;
      // в запросе назван и пункт помельче внутри этого («ЖК Панорама Краснодар») — ответ — он, а не весь город
      if (hit.kind === "place" && absorbed && pl.settlement === pi && topPlaces.some((q) => q.mask & absorbed && q.mask & ~p.mask
        && ix.places[q.ent >> 2].settlement === pi && q.ent >> 2 !== pi && ix.places[q.ent >> 2].kind !== "okrug")) score -= RANK.coarserPlace;
      // назван и пункт, в который этот входит («Краснодар, мкр Фестивальный», «Краснодар Калинино») — как у улицы
      // в названном пункте: иначе переулок-тёзка в станице за городом получает «пункт подходит», а микрорайон — нет
      let anc = 0;
      for (const q of topPlaces) if (q.mask & absorbed && q.ent >> 2 !== pi && this.isAncestor(q.ent >> 2, pi)) anc = Math.max(anc, q.cov);
      score += RANK.placeMatch * anc;
      out.push({ score: score + lo, text: p.cov, leftover: lo, hit, key: hit.id, settlement: pl.settlement, placeOk: anc ? true : null, core: "", clash: pctx < 0, postOk });
    }

    // POI
    for (const p of pois.slice(0, 20)) {
      // набор по буквам: короткий запрос — только объект, названный целиком («ккб»), а не случайное начало
      // сокращения или синонима («же» → «женус», «кра» → «Краснодарский политехнический институт»)
      if (mode === "suggest" && !kindWordMask && letters < RANK.poiMinLetters && !p.typedWhole) continue;
      const poi = ix.pois[p.ent >> 2];
      let used = p.mask | absorb(poi.place, poi.lat, poi.lon, p.mask);
      // улица (и номер) из адреса объекта — уточнение, а не лишние слова: «ТРЦ Красная площадь на Дзержинского»,
      // «Учебный корпус КубГТУ, Красная 166» — корпус на Красной, 166, а не на Красной, 91
      let addrBonus = 0;
      const addr = poi.address ? /^(.*\S),\s*(\S+)$/.exec(poi.address) : null;
      if (addr) {
        const name = fold(addr[1]);
        const root = this.rootSettlement(poi.place);
        const sc = streets.find((c) => !(c.mask & used) && c.cov >= 0.85 && fold(ix.streets[c.ent >> 2].name) === name
          && (this.rootSettlement(ix.streets[c.ent >> 2].area) === root || haversineKm(ix.streets[c.ent >> 2], poi) <= 3));
        if (sc) {
          used |= sc.mask;
          // номера в запросе нет — улица уточняет объект (+); номер совпал с номером объекта — не лишний, но это полный
          // адрес, и первым пусть идёт дом («ТЦ OZ Mall, ул. Крылатая, 2»)
          const nums = tokens.some((t, ti) => !(used & (1 << ti)) && (t.kind === "n" || t.kind === "h"));
          const key = houseKey(addr[2]);
          tokens.forEach((t, ti) => {
            if (!(used & (1 << ti)) && (t.kind === "n" || t.kind === "h") && (t.house ?? t.text) === key) used |= 1 << ti;
          });
          if (!nums) addrBonus = RANK.placeMatch;
        }
      }
      const lo = leftover(used);
      const settlement = poi.place >= 0 ? ix.places[poi.place].settlement : -1;
      // «Мега на Тургеневском шоссе»: объект назван вместе со своей улицей — найден целиком, как «ТЦ OZ»
      const whole = addrBonus && lo === 0 ? Math.max(complete(p, lo, poi.kind), RANK.poiComplete) : complete(p, lo, poi.kind);
      // название набирается и набрано не целиком — ниже улиц и пунктов с тем же началом
      // (тем ниже, чем меньше набрано: «аэроп» — аэропорт почти рядом с «Аэропортовской», «крас» — ТРЦ далеко внизу)
      const partial = mode === "suggest" && !kindWordMask && p.mask & lastPrefix && !p.typedWhole ? RANK.poiPartial * (1 - p.typed / RANK.poiTypedWhole) : 0;
      const score = RANK.text * p.cov + lo + this.proximity(settlement, poi.lat, poi.lon, at) - 4 + whole + ctxTerm(p.mask, "poi") + addrBonus - partial;
      out.push({
        score, text: p.cov, leftover: lo, settlement, key: `o:${poi.id}`, placeOk: null, core: "",
        hit: {
          id: `o:${poi.id}`, kind: "poi", title: poi.name, subtitle: poi.address ?? this.placeLabel(poi.place),
          lat: poi.lat, lon: poi.lon, precision: "house", score: 0, parts: { place: this.placeLabel(poi.place) || null, street: null, house: null },
        },
      });
    }

    out.sort((a, b) => b.score - a.score);
    if (mode === "suggest") this.approxBehindExact(out);
    this.completeHouses(out);
    for (const s of out) s.hit.score = Math.round(s.score * 10) / 10;
    return out;
  }

  /**
   * Подсказки: «Карла Маркса, ≈87» (такого дома на этой улице нет) — ниже найденных домов «Карла Маркса, 87»
   * в других пунктах: одноимённые варианты с настоящим домом должны поместиться в пятёрку.
   */
  private approxBehindExact(out: Scored[]): void {
    // лучший «пункт подходит» среди найденных домов с этим ядром: true > null > false
    const lvl = (x: boolean | null) => (x === true ? 2 : x === null ? 1 : 0);
    const exact = new Map<string, number>();
    for (const s of out.slice(0, 40)) {
      if (s.hit.kind === "house" && s.core && s.text >= 0.85) exact.set(s.core, Math.max(exact.get(s.core) ?? 0, lvl(s.placeOk)));
    }
    if (!exact.size) return;
    let changed = false;
    for (const s of out) {
      const e = exact.get(s.core);
      if (e === undefined || s.hit.kind !== "street" || !s.houseTok || lvl(s.placeOk) > e) continue;
      // соседи той же чётности рядом (fit ≈ 1) — дом, скорее всего, есть, просто его нет в данных: почти не опускаем
      const fit = Math.max(0, Math.min(1, (s.houseBonus ?? 0) / RANK.houseApprox));
      s.score -= RANK.approxBehindExact * (1 - RANK.approxFitRelief * fit);
      changed = true;
    }
    if (changed) out.sort((a, b) => b.score - a.score);
  }

  /**
   * Номер ещё набирается («Красная 12», «Крупской 125/», «Чукотская 23 к»): дома, чей номер начинается так же
   * («120», «12а», «12/1»; «125/3»; «23к1»), у двух лучших улиц.
   *  - дом с набранным номером есть — дополнения ниже него и ниже точных совпадений других улиц;
   *  - такого дома нет (или номер оборван на «/», «корп») — дополнения на его месте, а «≈» и дом «125» — ниже.
   */
  private completeHouses(out: Scored[]): void {
    const ix = this.ix;
    const extra: Scored[] = [];
    const done = new Set<number>();
    for (const s of out.slice(0, 6)) {
      const tok = s.houseTok;
      if (s.street === undefined || !tok || !tok.prefix || (tok.kind !== "n" && tok.kind !== "h") || done.has(s.street) || s.text < 0.85) continue;
      done.add(s.street);
      if (done.size > 2) break;
      const st = ix.streets[s.street];
      const key = tok.partial ?? tok.house ?? tok.text;
      const found: number[] = [];
      for (let j = st.start; j < st.end && found.length < 12; j++) if (ix.hKey[j] !== key && ix.hKey[j].startsWith(key)) found.push(j);
      if (!found.length) continue;
      found.sort((a, b) => ix.hNum[a] - ix.hNum[b] || ix.hKey[a].length - ix.hKey[b].length || (ix.hKey[a] < ix.hKey[b] ? -1 : 1));
      // «85С», «7К» набраны целиком (`partial` = ключ) и такой дом есть — он и есть ответ, дополнения ниже
      const exact = s.hit.kind === "house" && (!tok.partial || tok.partial === (tok.house ?? tok.text));
      let base = s.score - (s.houseBonus ?? 0) - (exact ? RANK.completionGap : 1);
      // дом с набранным номером есть — дополнения ниже всех тёзок с этим домом («Вишнёвая 5» во всех пунктах)
      if (exact) {
        let lowest = Infinity;
        for (const o of out.slice(0, 12)) if (o.hit.kind === "house" && o.core === s.core && o.houseTok === tok && o.score < lowest) lowest = o.score;
        if (lowest < Infinity) base = Math.min(base, lowest - 1 - RANK.houseExact);
      }
      // «≈23К» при настоящих 23к1, 23к2 не нужен; дом «125» при наборе «125/» — ниже дробей
      if (!exact) s.score -= s.hit.kind === "house" ? RANK.completionGap : 1000;
      for (const j of found.slice(0, exact ? 3 : 4)) {
        const label = ix.hPlace[j] >= 0 && ix.hPlace[j] !== st.place ? this.placeLabel(ix.hPlace[j]) || this.streetLabel(st) : this.streetLabel(st);
        extra.push({
          ...s, score: base + RANK.houseExact * PREC_TRUST[ix.hPrec[j]] - (ix.hKey[j].length - key.length) * 0.01, key: `h:${st.id}:${ix.hKey[j]}`, houseTok: undefined,
          realPoint: ix.hPrec[j] <= 1,
          hit: {
            id: `h:${st.id}:${ix.hKey[j]}`, kind: "house", title: `${st.name}, ${ix.hRaw[j]}`, subtitle: label, lat: ix.hLat[j], lon: ix.hLon[j],
            precision: PREC[ix.hPrec[j]], score: 0, parts: { place: label || null, street: st.name, house: ix.hRaw[j] },
          },
        });
      }
    }
    if (!extra.length) return;
    out.push(...extra);
    out.sort((a, b) => b.score - a.score);
  }

  private scoreStreet(
    st: StreetRec, settlement: number, cov: number, place: Cand | null, houseTok: QueryToken | null, used: number,
    at: { lat: number; lon: number }, leftoverPen: number, typePen: number, more?: StreetExtra,
  ): Scored {
    const ix = this.ix;
    let houseBonus = 0;
    let postOk: boolean | null = null;
    let score = RANK.text * cov + leftoverPen + typePen;
    score += RANK.size * Math.min(1, Math.log10(1 + st.houses) / 3);
    let lat = st.lat;
    let lon = st.lon;
    let realPoint = false;
    let hit: AddressHit;
    const baseLabel = this.streetLabel(st);
    // индекс без домов (клиентский мини-индекс): номер не ищем — улица, дома догрузит сервер
    if (houseTok && ix.hLat.length) {
      let key = houseTok.house ?? houseTok.text;
      let j = this.findHouse(st.start, st.end, key);
      for (const alt of houseTok.houseAlts ?? []) {
        if (j >= 0) break;
        const j2 = this.findHouse(st.start, st.end, alt);
        if (j2 >= 0) {
          j = j2;
          key = alt;
          score -= RANK.houseAltPenalty;
        }
      }
      if (j >= 0) {
        lat = ix.hLat[j];
        lon = ix.hLon[j];
        let precision = PREC[ix.hPrec[j]];
        /** Доверие к точке для оценки (не для показа): 0 — дом, 1 — интерполяция данных, 2 — «≈», 3 — пункт. */
        let trust = ix.hPrec[j];
        // дом есть (ГАР), но точка — улица или пункт: точка того же дома у двойника улицы («улица Митрофана Седина»
        // ГАР = «улица Седина» OSM) — это данные, с их точностью. Иначе точность данных не повышается: «≈» остаётся
        // «≈» (точка тоже из данных); соседи с настоящими точками рядом только поднимают доверие в оценке — дом есть,
        // и точка, скорее всего, близко
        if (ix.hPrec[j] >= 2) {
          let twin = -1;
          for (const tw of st.twins) {
            const t = ix.streets[tw];
            const j2 = this.findHouse(t.start, t.end, key);
            if (j2 >= 0 && ix.hPrec[j2] < ix.hPrec[j] && (twin < 0 || ix.hPrec[j2] < ix.hPrec[twin])) twin = j2;
          }
          if (twin >= 0) {
            lat = ix.hLat[twin];
            lon = ix.hLon[twin];
            precision = PREC[ix.hPrec[twin]];
            trust = ix.hPrec[twin];
          } else {
            const ap = this.approxHouse(st.start, st.end, key, st);
            if (ap.precision === "interpolated" && ap.fit >= 0.5) trust = 1;
          }
        }
        realPoint = trust <= 1;
        houseBonus = RANK.houseExact * PREC_TRUST[trust];
        score += houseBonus;
        // почтовый индекс в запросе совпал с индексом дома / другой: «350018, Краснодар, ул. Калинина, 12» — та
        // «Калинина, 12», у которой этот индекс (тёзки в одном городе различаются только им)
        const post = more?.postcode ? this.postOf(j, st.start, st.end) : 0;
        if (post) {
          postOk = post === more!.postcode;
          score += postOk ? RANK.postcode : -RANK.postcode;
        }
        const label = ix.hPlace[j] >= 0 && ix.hPlace[j] !== st.place ? this.placeLabel(ix.hPlace[j]) || baseLabel : baseLabel;
        hit = {
          id: `h:${st.id}:${ix.hKey[j]}`, kind: "house", title: `${st.name}, ${ix.hRaw[j]}`, subtitle: label,
          lat, lon, precision, score: 0,
          parts: { place: label || null, street: st.name, house: ix.hRaw[j] },
        };
      } else {
        // такого номера в данных нет: точка — оценка по соседям (лучше точки улицы), но это не дом — всегда «≈»
        const ap = this.approxHouse(st.start, st.end, key, st);
        lat = ap.lat;
        lon = ap.lon;
        houseBonus = RANK.houseApprox * ap.fit;
        score += houseBonus;
        hit = {
          id: `a:${st.id}:${key}`, kind: "street", title: `${st.name}, ≈${displayHouse(key)}`, subtitle: baseLabel,
          lat, lon, precision: "street", score: 0, parts: { place: baseLabel || null, street: st.name, house: null },
        };
      }
    } else {
      hit = {
        id: `s:${st.id}`, kind: "street", title: st.name, subtitle: baseLabel, lat, lon, precision: "street", score: 0,
        parts: { place: baseLabel || null, street: st.name, house: null },
      };
    }
    let placeOk: boolean | null = null;
    if (place) {
      const fit = this.placeFit(place.ent >> 2, st.place, lat, lon, more?.spatial ?? true);
      placeOk = fit === 1 ? true : fit === -1 ? false : null;
      score += fit === 1 ? RANK.placeMatch * place.cov : fit === -1 ? RANK.placeMismatch : 0;
    }
    // микрорайон, названный вместе с городом («Краснодар, КМР, ул. Дзержинского, 38»), не лишний, но и не пустой звук:
    // точка ответа далеко от него — ниже (тёзка в этом микрорайоне — выше)
    let hoodOk: boolean | null = null;
    for (const q of more?.hoods ?? []) {
      const far = this.placeFit(q, st.place, lat, lon) < 0;
      if (far) score -= RANK.farNamed;
      hoodOk = hoodOk === false || far ? false : true;
    }
    // найден дом — имя объекта перед адресом и объекты рядом с домом не лишние слова («ТЦ OZ Mall, ул. Крылатая, 2»)
    if (hit.kind === "house" && more?.relax) {
      const r = more.relax(lat, lon);
      if (r.lo > leftoverPen) {
        score += r.lo - leftoverPen;
        leftoverPen = r.lo;
      }
      // «ЖК Ренессанс, ул. Строителей, 21»: этот ЖК рядом с этим домом — место названо (тёзки в других пунктах — нет)
      if (r.poi && placeOk === null) {
        placeOk = true;
        score += RANK.placeMatch / 2;
      }
    }
    score += this.proximity(settlement, lat, lon, at);
    return {
      score, text: cov, leftover: leftoverPen, hit, key: hit.id, settlement, placeOk, core: st.core,
      street: st.idx, houseTok: houseTok ?? undefined, houseBonus, named: place ? place.ent >> 2 : -1,
      typeOk: more?.typeOk ?? null, postOk, hoodOk, realPoint,
    };
  }

  // ---------------------------------------------------------------- API

  suggest(q: string, opts: SuggestOptions = {}): AddressHit[] {
    const limit = opts.limit ?? 5;
    if (!q.trim()) return [];
    const ranked = this.rank(q, opts.near, "suggest");
    const seen = new Set<string>();
    const out: Scored[] = [];
    for (const s of ranked) {
      if (seen.has(s.key) || s.score < -500) continue; // вытесненные дополнениями номера
      seen.add(s.key);
      out.push(s);
      if (out.length >= limit * 3) break;
    }
    return this.distinct(out, limit).map((s) => s.hit);
  }

  /** Один адрес — одна подсказка; одинаковые подписи у разных мест различаем микрорайоном. */
  private distinct(list: Scored[], limit: number): Scored[] {
    const ix = this.ix;
    const res: Scored[] = [];
    const byText = new Map<string, Scored>();
    const housePoints = new Set<string>();
    for (const s of list) {
      // один дом под двумя именами улицы (двойники OSM и ГАР) — одна подсказка
      if (s.hit.kind === "house" && s.hit.parts?.house) {
        const hp = `${s.hit.lat.toFixed(6)},${s.hit.lon.toFixed(6)},${s.hit.parts.house}`;
        if (housePoints.has(hp)) continue;
        housePoints.add(hp);
      }
      const t = `${s.hit.title}|${s.hit.subtitle}`;
      const prev = byText.get(t);
      if (prev) {
        // куски одной улицы (в данных улица бывает разрезана) — одна подсказка
        if (haversineKm(prev.hit, s.hit) < 2) continue;
        let area = this.areaNear(s.hit.lat, s.hit.lon, s.settlement);
        let areaPrev = this.areaNear(prev.hit.lat, prev.hit.lon, prev.settlement);
        // два СНТ с одним именем: микрорайонов нет — пункт рядом («СНТ Мелиоратор, Новая Адыгея» / «…, Афипский»)
        if (!area || area === areaPrev) {
          area = this.placeContext(s.settlement) || area;
          areaPrev = this.placeContext(prev.settlement) || areaPrev;
        }
        if (area && area !== areaPrev) {
          s.hit = { ...s.hit, subtitle: s.hit.subtitle ? `${s.hit.subtitle}, ${area}` : area };
          // главная улица пункта (втрое больше домов) остаётся просто «Краснодар», уточняется меньшая
          const main = prev.street !== undefined && s.street !== undefined && ix.streets[prev.street].houses >= 3 * Math.max(1, ix.streets[s.street].houses);
          if (!main && areaPrev && !prev.hit.subtitle.endsWith(areaPrev)) prev.hit = { ...prev.hit, subtitle: prev.hit.subtitle ? `${prev.hit.subtitle}, ${areaPrev}` : areaPrev };
        }
      } else byText.set(t, s);
      res.push(s);
      if (res.length >= limit) break;
    }
    return res;
  }

  /** Ближайший микрорайон / район того же пункта — для различения одноимённых улиц. */
  private areaNear(lat: number, lon: number, settlement: number, maxKm = 4): string | null {
    const ix = this.ix;
    let best: string | null = null;
    let bestD = maxKm;
    for (const p of ix.places) {
      if (p.kind !== "microdistrict" && p.kind !== "district" && p.kind !== "snt") continue;
      if (settlement >= 0 && p.settlement !== settlement && p.parent !== settlement) continue;
      const d = haversineKm(p, { lat, lon });
      if (d < bestD) {
        bestD = d;
        best = p.name;
      }
    }
    return best;
  }

  /**
   * Один адрес для импорта. Отказ (null), если совпало неуверенно или рядом по оценке есть другое место:
   *  - назван пункт — соперники только в этом же пункте;
   *  - пункт не назван, лучший — в «домашнем» пункте (где near) — соперники только оттуда же;
   *  - пункт не назван, лучший — в другом пункте, а в домашнем есть улица с тем же названием — отказ.
   */
  geocode(address: string, opts: GeocodeOptions = {}): AddressHit | null {
    return this.geocodeDetailed(address, opts).hit;
  }

  /**
   * Как geocode, но с причиной отказа — для отчёта CSV-импорта («уточните пункт», «слова не из справочника»…).
   * `alternatives` — при неоднозначности: варианты, между которыми не выбрали (до 5).
   */
  geocodeDetailed(address: string, opts: GeocodeOptions = {}): GeocodeResult {
    const fail = (reason: GeocodeFailure, alternatives: AddressHit[] = []): GeocodeResult => ({ hit: null, reason, message: GEOCODE_MESSAGES[reason], alternatives });
    if (!address.trim()) return fail("empty");
    const ranked = this.rank(address.trim() + " ", opts.near);
    const top = ranked[0];
    if (!top) return fail("not_found");
    if (top.text < RANK.geocodeMinText) return fail("weak_match", [top.hit]);
    if (top.leftover <= RANK.leftoverWord) return fail("extra_words", [top.hit]);
    if (top.placeOk === false) return fail("place_mismatch", [top.hit]);
    const home = this.homeSettlement(opts.near ?? this.ix.center);
    const strict = opts.strict ?? true;
    /** Соперники в других местах — для подсказки в отчёте: чем уточнить. */
    const rivals = (pred: (o: Scored) => boolean): AddressHit[] => {
      const res: AddressHit[] = [top.hit];
      const seen = new Set([`${top.hit.title}|${top.hit.subtitle}`]);
      for (let i = 1; i < ranked.length && i < 60 && res.length < 5; i++) {
        const o = ranked[i];
        const k = `${o.hit.title}|${o.hit.subtitle}`;
        if (!seen.has(k) && pred(o) && !res.some((h) => haversineKm(h, o.hit) <= 0.5)) {
          seen.add(k);
          res.push(o.hit);
        }
      }
      return res;
    };
    if (top.clash) return fail("weak_match", [top.hit]);
    // Не соперник: тип улицы назван явно и совпал у лучшего, а у этого другой («проезд Кропоткина, 15» — не «улица
    // Кропоткина, 15»), или почтовый индекс совпал у лучшего, а у этого другой.
    // (тип решает, только если название у соперника совпало не лучше: «ул. Кошевая» — не повод уверенно брать «улицу
    // Олега Кошевого» при «Кошевом проезде»)
    const beaten = (o: Scored) => (top.typeOk === true && o.typeOk === false && o.text <= top.text + 1e-9) || (top.postOk === true && o.postOk === false)
      || (top.hoodOk === true && o.hoodOk === false);
    // «24B» — 24В или 24Б: оба дома есть — не угадываем
    if (top.letterTwin) {
      const other = ranked.find((o) => o !== top && o.letterTwin && o.street === top.street && o.hit.kind === "house" && top.hit.kind === "house"
        && o.hit.id !== top.hit.id && top.score - o.score < RANK.geocodeStrictMargin);
      if (other) return fail("ambiguous", [top.hit, other.hit]);
    }
    // строго: пункт не назван — одноимённая улица с тем же домом (или «≈» рядом по оценке) в другом месте = неоднозначно
    if (strict && top.placeOk === null && top.core) {
      for (let i = 1; i < ranked.length && i < 60; i++) {
        const o = ranked[i];
        if (top.score - o.score >= RANK.geocodeStrictMargin) break;
        if (beaten(o)) continue;
        if (o.core === top.core && o.hit.kind === top.hit.kind && haversineKm(top.hit, o.hit) > 0.5) {
          return fail("ambiguous_place", rivals((x) => x.core === top.core && x.hit.kind === top.hit.kind && top.score - x.score < RANK.geocodeStrictMargin));
        }
      }
    }
    // строго: тип улицы назван, а найденный дом — на улице другого типа («ул. 9-го Января, 12» → «проезд 9 Января, 12»,
    // «проезд Бородина, 21» → «улица Бородина, 21»): набранной улицы или этого номера на ней может просто не быть в
    // данных — чужой дом как точный не выдаём. На val ни одного верного ответа такой отказ не стоит
    if (strict && top.hit.kind === "house" && top.typeOk === false) {
      return fail("type_mismatch", rivals((x) => x.core === top.core && x.typeOk === true && top.score - x.score < RANK.geocodeStrictMargin));
    }
    // строго: назван город, а такой дом (с настоящей точкой) есть в нём дважды — в центре и в микрорайоне («г. Краснодар,
    // улица Дзержинского, 37» — центр и Комсомольский): названный пункт их не различает. Станица или посёлок в черте
    // города с тем же адресом — не соперник: их пишут своим именем («г. Краснодар, ст-ца Елизаветинская, …»)
    const real = (x: Scored) => x.hit.kind === "house" && (x.realPoint ?? (x.hit.precision === "house" || x.hit.precision === "interpolated"));
    if (strict && top.placeOk === true && top.core && real(top)) {
      for (let i = 1; i < ranked.length && i < 60; i++) {
        const o = ranked[i];
        if (top.score - o.score >= RANK.geocodeStrictMargin) break;
        if (beaten(o) || o.placeOk !== true || o.core !== top.core || !real(o) || o.settlement !== top.settlement || haversineKm(top.hit, o.hit) <= 0.5
          // соперник объясняет запрос хуже: «ул имени Льва Ковалёва» — «улица Ковалёва» без набранного «Льва»
          || o.leftover < top.leftover || o.text < top.text - 0.02) continue;
        if ((o.named ?? -1) !== (top.named ?? -1)) continue;
        return fail("ambiguous_place", rivals((x) => x.core === top.core && x.placeOk === true && real(x) && top.score - x.score < RANK.geocodeStrictMargin));
      }
    }
    if (strict && top.core && top.street !== undefined) {
      const ix = this.ix;
      const topNamed = top.named ?? -1;
      for (let i = 1; i < ranked.length && i < 60; i++) {
        const o = ranked[i];
        if (top.score - o.score >= RANK.geocodeStrictMargin) break;
        if (o.hit.kind !== top.hit.kind || o.street === undefined || haversineKm(top.hit, o.hit) <= 0.5 || beaten(o)) continue;
        // названный пункт — один из тёзок («СНТ Мелиоратор» — их два): тот же адрес в другом — неоднозначно
        const oNamed = o.named ?? -1;
        if (topNamed >= 0 && oNamed >= 0 && oNamed !== topNamed && o.placeOk === true && top.placeOk === true && o.core === top.core
          && ix.places[oNamed].name === ix.places[topNamed].name) {
          return fail("ambiguous_place", rivals((x) => x.core === top.core && x.placeOk === true && top.score - x.score < RANK.geocodeStrictMargin));
        }
        // другое название, совпавшее не хуже: старое имя одной улицы и основное другой («Церковная» — синоним
        // Ярославского и улица в СНТ), две улицы на одну опечатку («турина» — Туркина и Тюрина)
        if (o.core !== top.core && (o.placeOk !== false || top.placeOk !== true) && o.leftover >= top.leftover
          && o.text >= top.text - (top.text >= 0.999 ? 0.001 : top.text >= 0.9 ? RANK.geocodeFuzzyGap / 3 : RANK.geocodeFuzzyGap)) {
          return fail("ambiguous", rivals((x) => x.hit.kind === top.hit.kind && top.score - x.score < RANK.geocodeStrictMargin));
        }
      }
    }
    for (let i = 1; i < ranked.length && i < 60; i++) {
      const o = ranked[i];
      if (top.score - o.score >= RANK.geocodeMargin) break;
      if (haversineKm(top.hit, o.hit) <= 0.5) continue;
      if (o.text < top.text - RANK.geocodeTextGap) continue; // соперник похож хуже — номер дома его не спасает
      if (top.placeOk === true && o.placeOk !== true) continue;
      if (beaten(o)) continue;
      if (!strict && top.placeOk === null && home >= 0 && top.settlement === home && o.settlement !== home) continue;
      // в одном пункте две одноимённые улицы: центральная «Красная» и «Красная» в СНТ — берём крупную. Но если у
      // тёзки этот дом есть с настоящей точкой (здание, адресный узел, интерполяция) — это два разных дома, не угадываем
      // («улица Дзержинского, 37» — в центре и в Комсомольском)
      const realTwin = top.hit.kind === "house" && o.core === top.core && real(o);
      if (!realTwin && o.settlement === top.settlement && top.street !== undefined && o.street !== undefined
        && this.ix.streets[top.street].houses >= 5 * Math.max(1, this.ix.streets[o.street].houses)) continue;
      const samePlace = top.placeOk === null && o.core === top.core && o.settlement !== top.settlement;
      return fail(samePlace ? "ambiguous_place" : "ambiguous", rivals((x) => top.score - x.score < RANK.geocodeMargin));
    }
    if (RANK.geocodeHomeGuard && top.placeOk === null && home >= 0 && top.settlement !== home && top.core) {
      if (ranked.some((o) => o.settlement === home && o.core === top.core)) return fail("ambiguous_place", rivals((x) => x.core === top.core));
    }
    // подпись как у подсказок: у тёзки в том же пункте — микрорайон («Краснодар, Комсомольский»)
    const same = ranked.filter((o, i) => i > 0 && i < 30 && o.hit.title === top.hit.title && o.hit.subtitle === top.hit.subtitle);
    const hit = same.length ? this.distinct([{ ...top, hit: { ...top.hit } }, ...same.map((o) => ({ ...o, hit: { ...o.hit } }))], 1 + same.length)[0].hit : top.hit;
    return { hit, reason: null, message: null, alternatives: [] };
  }

  // ---------------------------------------------------------------- обратное геокодирование

  /** Сетка домов с настоящей точкой (здание, адресный узел, интерполяция) — строится при первом reverse. */
  private grid: Map<number, number[]> | null = null;

  private cellOf(lat: number, lon: number): [number, number] {
    return [Math.floor(lat / GRID_LAT), Math.floor(lon / GRID_LON)];
  }

  private houseGrid(): Map<number, number[]> {
    if (this.grid) return this.grid;
    const ix = this.ix;
    const grid = new Map<number, number[]>();
    for (let j = 0; j < ix.hLat.length; j++) {
      if (ix.hPrec[j] > 1) continue; // точка «улица/пункт» из ГАР — не дом
      const [a, b] = this.cellOf(ix.hLat[j], ix.hLon[j]);
      const k = a * GRID_KEY + b;
      const arr = grid.get(k);
      if (arr) arr.push(j);
      else grid.set(k, [j]);
    }
    this.grid = grid;
    return grid;
  }

  /** Улица дома j (отрезки домов улиц идут подряд) — двоичный поиск; −1 — адрес по пункту без улицы. */
  private streetOfHouse(j: number): number {
    const st = this.ix.streets;
    // улицы без домов имеют start = end = 0 — ищем по отсортированному списку отрезков
    if (!this.streetStarts) {
      const list = st.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
      this.streetStarts = { starts: Int32Array.from(list.map((s) => s.start)), idx: Int32Array.from(list.map((s) => s.idx)) };
    }
    const { starts, idx } = this.streetStarts;
    let lo = 0;
    let hi = starts.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= j) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (ans < 0) return -1;
    const s = st[idx[ans]];
    return j < s.end ? s.idx : -1;
  }

  private streetStarts: { starts: Int32Array; idx: Int32Array } | null = null;

  /**
   * Точка → адрес для «Моё местоположение»:
   *  - дом с настоящей точкой не дальше 60 м (интерполированный — 30 м) → kind "house", точка дома;
   *  - иначе улица ближайшего дома (до 250 м) или ближайшая улица по её точке (до 300 м) → kind "street",
   *    точка — сама переданная (место человека известно точнее точки улицы);
   *  - иначе пункт, в застройке которого точка (или ближайший до 5 км) → kind "place", точка — переданная.
   * Подпись — пункт и ближайший микрорайон: «Краснодар, Юбилейный». Нет ничего — null.
   */
  reverse(lat: number, lon: number, opts: ReverseOptions = {}): AddressHit | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const ix = this.ix;
    const houseKm = (opts.houseM ?? 60) / 1000;
    const grid = this.houseGrid();
    const [ca, cb] = this.cellOf(lat, lon);
    const at = { lat, lon };
    let best = -1;
    let bestD = Infinity;
    for (let a = ca - 1; a <= ca + 1; a++) {
      for (let b = cb - 1; b <= cb + 1; b++) {
        const arr = grid.get(a * GRID_KEY + b);
        if (!arr) continue;
        for (const j of arr) {
          const d = haversineKm(at, { lat: ix.hLat[j], lon: ix.hLon[j] });
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        }
      }
    }
    const area = (la: number, lo: number, settlement: number) => {
      const a = this.areaNear(la, lo, settlement, 1.5);
      return a;
    };
    const withArea = (label: string, la: number, lo: number, settlement: number) => {
      const a = area(la, lo, settlement);
      return a && !label.endsWith(a) ? (label ? `${label}, ${a}` : a) : label;
    };
    if (best >= 0 && bestD <= (ix.hPrec[best] === 0 ? houseKm : Math.min(houseKm, 0.03))) {
      const si = this.streetOfHouse(best);
      const hp = ix.hPlace[best];
      if (si >= 0) {
        const st = ix.streets[si];
        const label = hp >= 0 && hp !== st.place ? this.placeLabel(hp) || this.streetLabel(st) : this.streetLabel(st);
        const settlement = st.area >= 0 ? ix.places[st.area].settlement : -1;
        return {
          id: `h:${st.id}:${ix.hKey[best]}`, kind: "house", title: `${st.name}, ${ix.hRaw[best]}`, subtitle: withArea(label, ix.hLat[best], ix.hLon[best], settlement),
          lat: ix.hLat[best], lon: ix.hLon[best], precision: PREC[ix.hPrec[best]], score: Math.round(bestD * 1000),
          parts: { place: label || null, street: st.name, house: ix.hRaw[best] },
        };
      }
      if (hp >= 0) {
        const pl = ix.places[hp];
        return {
          id: `ph:${pl.id}:${ix.hKey[best]}`, kind: "house", title: `${pl.name}, ${ix.hRaw[best]}`, subtitle: this.placeLabel(pl.parent),
          lat: ix.hLat[best], lon: ix.hLon[best], precision: PREC[ix.hPrec[best]], score: Math.round(bestD * 1000),
          parts: { place: pl.name, street: null, house: ix.hRaw[best] },
        };
      }
    }
    // улица: ближайшего дома (до 250 м) или по точке улицы (до 300 м)
    let street = best >= 0 && bestD <= 0.25 ? this.streetOfHouse(best) : -1;
    let streetD = street >= 0 ? bestD : Infinity;
    for (const st of ix.streets) {
      if (Math.abs(st.lat - lat) > 0.003 || Math.abs(st.lon - lon) > 0.004) continue;
      const d = haversineKm(at, st);
      if (d <= 0.3 && d < streetD) {
        streetD = d;
        street = st.idx;
      }
    }
    if (street >= 0) {
      const st = ix.streets[street];
      const settlement = st.area >= 0 ? ix.places[st.area].settlement : -1;
      const label = this.streetLabel(st);
      return {
        id: `s:${st.id}`, kind: "street", title: st.name, subtitle: withArea(label, lat, lon, settlement), lat, lon, precision: "street",
        score: Math.round(streetD * 1000), parts: { place: label || null, street: st.name, house: null },
      };
    }
    // пункт: в застройке которого точка, иначе ближайший до 5 км
    const p = this.nearestSettlement(lat, lon, 5);
    if (p < 0) return null;
    const pl = ix.places[p];
    const a = area(lat, lon, p);
    return {
      id: `p:${pl.id}`, kind: "place", title: a ?? pl.name, subtitle: a ? pl.name : placeSubtitle(pl.kind, ""), lat, lon, precision: "place",
      score: Math.round(Math.max(0, haversineKm(pl, at) - pl.radiusKm) * 1000), parts: { place: pl.name, street: null, house: null },
    };
  }

  /** q — предок p (город микрорайона, город посёлка в его черте). */
  isAncestor(q: number, p: number): boolean {
    const ix = this.ix;
    for (let x = ix.places[p].parent, guard = 0; x >= 0 && guard < 8; x = ix.places[x].parent, guard++) if (x === q) return true;
    return false;
  }

  /** Верхний населённый пункт: город для посёлков и СНТ в его черте, сам пункт — для остальных; −1 — нет. */
  rootSettlement(p: number): number {
    const ix = this.ix;
    let s = p >= 0 ? ix.places[p].settlement : -1;
    for (let guard = 0; s >= 0 && ix.places[s].parent >= 0 && guard < 8; guard++) {
      const up = ix.places[ix.places[s].parent].settlement;
      if (up < 0 || up === s) break;
      s = up;
    }
    return s;
  }

  /** Пункт, в застройке которого точка near (Краснодар для центра города); нет — −1. */
  homeSettlement(near: { lat: number; lon: number }): number {
    const ix = this.ix;
    let best = -1;
    let bestD = Infinity;
    ix.places.forEach((p, i) => {
      if (p.settlement !== i || p.kind === "snt") return;
      const d = haversineKm(p, near) - p.radiusKm;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD <= 0 ? best : -1;
  }
}

/** Предлоги «объект на улице»: «Мега на Тургеневском шоссе». */
const QUALIFIER_PREPS = new Set(["на", "у", "возле", "около", "напротив"]);
/** Тип района перед именем: «р-н Тахтамукайский» — регион, а не пункт «Тахтамукайский». */
const DISTRICT_TYPES = new Set(["рн", "район"]);
/** Тип «микрорайон»: и тип пункта, и тип улицы («микрорайон Любимово» бывает улицей). */
const MKR_TYPES = new Set(["мкр", "мкрн", "мн", "микрорайон"]);
/** Окончание прилагательного в именительном падеже: «Фестивальный», «Майская», «Ростовское». */
const ADJ_END = /(ый|ий|ой|ая|яя|ое|ее)$/;

/** Слова вида объекта: «аэропорт», «вокзал», «парк»… — запрос про объект. */
const POI_WORDS = new Set(Object.values(POI_KIND_WORDS).flat());
/** Тип пункта перед названием → виды пунктов в данных. */
const TYPE_PLACE_KINDS: Record<string, PlaceKind[]> = {
  х: ["hamlet"], хут: ["hamlet"], хутор: ["hamlet"], хутора: ["hamlet"],
  п: ["village", "town"], пос: ["village", "town"], поселок: ["village", "town"], поселка: ["village", "town"],
  пгт: ["town", "village"], рп: ["town", "village"], кп: ["village"],
  ст: ["village", "town", "snt"], стца: ["village", "town"], станица: ["village", "town"], станицы: ["village", "town"], стн: ["village", "town"],
  а: ["village"], аул: ["village"], аула: ["village"], с: ["village"], село: ["village"], села: ["village"], г: ["city", "town"], гор: ["city", "town"], город: ["city", "town"],
  снт: ["snt"], сот: ["snt"], днт: ["snt"], тсн: ["snt"], нст: ["snt"], сдт: ["snt"], дпк: ["snt"], пк: ["snt"],
  мкр: ["microdistrict"], мкрн: ["microdistrict"], микрорайон: ["microdistrict"], жк: ["microdistrict"],
};

/** Вид объекта перед названием → вид в данных: «ТЦ OZ» — торговый центр. */
const POI_TYPE_KINDS: Record<string, string[]> = {
  тц: ["mall"], трц: ["mall"], тк: ["mall"], трк: ["mall"], тоц: ["mall"], мфк: ["mall"], жк: ["residential_complex"], жд: ["station"],
};

const VOWELS = /[аеёиоуыэюяaeiouy]/;
/** Тип улицы слитно с названием: в начале («улКрасная», «перМайский») и в конце («Краснаяул»). */
const GLUED_TYPE_HEAD = /^(улица|ул|переулок|пер|проспект|просп|пр|проезд|прд|бульвар|бул|набережная|наб|шоссе|площадь|пл)([а-я]{4,})$/;
const GLUED_TYPE_TAIL = /^([а-я]{4,}?)(улица|ул|переулок|пер|проспект|просп|пр|проезд|бульвар|наб|шоссе)$/;
/** Косвенные окончания прилагательных и фамилий: «Северной», «Ставропольскую», «Ростовском», «Игнатовых». */
const OBLIQUE_ENDINGS = ["ой", "ей", "ую", "юю", "ом", "ем", "ого", "его", "ому", "ему", "ых", "их", "ым", "им"];
/** Название в родительном падеже — по имени человека: «Ленина», «Кирова», «Калинина». */
const GENITIVE_NAME = /(ова|ева|ёва|ина|ына|ого|его|ых|их)$/;
/** Женский род; «ростовскя» (пропущена «а») — тоже: не «Ростовское». */
const FEM = /(ая|яя|[бвгдзклмнпрстфхцчшщ]я)$/;
const MASC = /(ый|ий)$/;
const NEUT = /(ое|ее)$/;
/** Оба слова — именительный падеж прилагательного, но разного рода. */
function genderClash(a: string, b: string): boolean {
  const g = (w: string) => (FEM.test(w) ? 1 : MASC.test(w) ? 2 : NEUT.test(w) ? 3 : 0);
  const ga = g(a);
  const gb = g(b);
  return ga > 0 && gb > 0 && ga !== gb;
}

/** Фамилия во множественном числе и в единственном: «игнатовых» / «игнатова» («Братьев Игнатовых» ≠ «Игнатова»). */
function pluralClash(a: string, b: string): boolean {
  const pa = /(ых|их)$/.test(a);
  const pb = /(ых|их)$/.test(b);
  return pa !== pb && a.length >= 6 && b.length >= 6 && /(ов|ев|ин|ын)(а|ых)$/.test(a) && /(ов|ев|ин|ын)(а|ых)$/.test(b);
}

function lowerBound(words: string[], sorted: Int32Array, key: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[sorted[mid]] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function kindBonus(kind: PlaceKind): number {
  switch (kind) {
    case "city": return 6;
    case "town": return 4;
    case "microdistrict": return 4;
    case "village": return 3;
    case "okrug": return 3;
    case "district": return 2;
    case "snt": return 1;
    default: return 1;
  }
}

const KIND_LABEL: Record<PlaceKind, string> = {
  city: "город", town: "посёлок", village: "населённый пункт", hamlet: "хутор", microdistrict: "микрорайон",
  snt: "садовое товарищество", district: "район", okrug: "округ",
};

function placeSubtitle(kind: PlaceKind, parent: string): string {
  return parent ? `${KIND_LABEL[kind]}, ${parent}` : KIND_LABEL[kind];
}
