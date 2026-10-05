// Разбор запроса «Где» на слова и номер дома. Порядок слов любой: «Базовская 21к1 Яблоновский»,
// «пгт Яблоновский, ул Базовская, д. 21 корп 1», «111 улица Абрикосовая». Какие слова — улица, а какие —
// пункт, решает поиск по словарю (engine.ts); здесь только слова, числа и номер дома.

import {
  apartmentPrefix, cleanText, fold, functionKind, homoglyphsToRu, ICAO_LATIN, layoutToRu, lookalikesToRu, numeralWord, translitToRu,
  canonicalWord, yearsWord, NUMBER_BEFORE_APARTMENT, type FunctionKind,
} from "./text";

export type TokenKind =
  | "w"  // слово
  | "n"  // голое число: номер дома или число в названии («40 лет Победы», «1 Мая»)
  | "o"  // порядковое число — только часть названия («1-й Линейный», «2-я Пятилетка»)
  | "h"; // номер дома с корпусом, буквой, дробью: «21к1», «7б», «21/1», «12с2»

export interface QueryToken {
  kind: TokenKind;
  /** Слово или число в нормальной форме; для «h» — ключ номера («21к1»). */
  text: string;
  /** Ключ номера дома — для «n» и «h». */
  house?: string;
  /**
   * Запасные ключи по порядку, если по `house` дома нет: «58/1 г, Краснодар» — «г» может быть и литерой, и
   * «городом» (58/1г → 58/1); «120-5» — дробь или дом и квартира (120/5 → 120-5 → 120); «22 к1» — корпус или
   * дробь (22к1 → 22/1); «120 в Краснодаре» — предлог, но и литера (120 → 120в).
   */
  houseAlts?: string[];
  /**
   * Равноправные прочтения номера — отдельные ответы, а не запасные ключи: «24B» — 24В (начертание) и 24Б (транслит).
   */
  houseTwins?: string[];
  /** Служебное слово: тип улицы, тип пункта, регион, «д.», «кв.»… (может быть и частью названия). */
  fn: FunctionKind | null;
  /** Последнее слово без пробела после — возможно, недонабрано. */
  prefix: boolean;
  /** Перед словом стояла запятая. */
  comma: boolean;
  /** Число помечено как дом («д. 21», «дом 21», «№ 21»). */
  houseMarker: boolean;
  /**
   * Слово — сокращение: сразу за ним точка или дефис и слово («В.Кругликовская», «Зап. Кругликовская»,
   * «Вост-Кругликовская», «Г.К. Жукова»). Буква с точкой — инициал, а не предлог «в».
   */
  abbr?: boolean;
  /** Род порядкового числа по окончанию: «1-я» — f, «1-й» — m, «1-е» — n (для «o»). */
  gender?: "f" | "m" | "n";
  /**
   * Номер набирается и оборван на разделителе: «125/», «21 корп», «6 стр» → «125/», «21к», «6с».
   * Только у последнего номера открытого запроса — для подсказок домов с таким началом.
   */
  partial?: string;
}

/** Вариант написания куска запроса: как набрано, в другой раскладке, транслит. */
export interface ChunkVariant {
  text: string;
  how: "as-is" | "layout" | "translit";
}

/** Куски запроса (по пробелам) и их варианты — какой взять, решает словарь. */
export function chunkVariants(query: string): ChunkVariant[][] {
  const q = romanToArabic(cleanText(query))
    // типографский апостроф (автозамена iOS: «luk’yanenko») — как обычный
    .replace(/[’‘ʼ´]/g, "'");
  const chunks = q.split(/\s+/).filter(Boolean);
  // латиница в запросе — все куски со знаками раскладки («22<,», «;tktpyjljhj;yfz») тоже могут быть «не той раскладкой»
  const latin = /[a-z]/i.test(q);
  return chunks.map((chunk, ci) => {
    // номер дома с латинской буквой («24a», «10d», «29 k1») или с буквой-двойником цифры («l20», «3OO») — сразу
    // кириллицей: раскладка тут не при чём («24a» — не «24ф»), а «l» и «O» среди цифр — это 1 и 0
    const house = houseChunk(chunk, chunks[ci - 1]);
    if (house) return [{ text: house.text, how: "as-is" }, ...(latin && house.latin ? [{ text: layoutToRu(fold(chunk)), how: "layout" as const }] : [])];
    // апостроф между кириллическими буквами — твёрдый знак: «В'ездная», «Об'ездная»
    const low = fold(chunk).replace(/(?<=[а-я])['`](?=[а-я])/g, "ъ");
    const out: ChunkVariant[] = [{ text: low, how: "as-is" }];
    // тип слитно с названием с заглавной: «улицаКрасная», «перМайский», «прЧекистов» — через пробел
    if (/[а-яё]{2}[А-ЯЁ][а-яё]/.test(chunk)) out.push({ text: fold(chunk.replace(/([а-яё]{2,})(?=[А-ЯЁ][а-яё])/g, "$1 ")), how: "as-is" });
    // латинские двойники в кириллице («KPACHAЯ») — тот же режим «как набрано»
    const homo = homoglyphsToRu(chunk);
    if (homo && homo !== low) out.push({ text: homo, how: "as-is" });
    // цифра-двойник буквы внутри слова: «ба3овская», «3ападная», «Заводск0я» (одна цифра, рядом буквы)
    const digits = digitHomoglyphs(low);
    if (digits) out.push({ text: digits, how: "as-is" });
    if (!latin || !/[a-z`[\];',.{}:"<>~]/.test(low) || /^[\d\s,.;:/-]+$/.test(low)) return out;
    const trail = /[,.;:]+$/.exec(low)?.[0] ?? "";
    const lead = /^[,.;:]+/.exec(low)?.[0] ?? "";
    // Раскладка: знаки внутри слова — буквы («,fpjdcrfz» = «базовская»), запятая в конце — может быть
    // и разделителем («Gentdfz, 35»), и «б».
    if (trail) out.push({ text: layoutToRu(low.slice(0, low.length - trail.length)) + ",", how: "layout" });
    out.push({ text: layoutToRu(low), how: "layout" });
    if (lead && trail) out.push({ text: layoutToRu(low.slice(0, low.length - trail.length)) + ",", how: "layout" });
    // точка и запятая после инициала — знаки, а не «ю»/«б»: «L.Yt[fz» = «Д.Нехая» (внутри слова — буквы: «yf,tht;yfz»)
    if (/^[a-z][.,][a-z]/.test(low)) out.push({ text: layoutToRu(low, true), how: "layout" });
    // тип улицы по-английски: «Krasnaya street 120», «Chekistov ave 20»; «st» после названия — street, а перед
    // названием («st. Elizavetinskaya») — станица
    const bare = low.replace(/[,.;:]+$/, "");
    const nextChunk = chunks[ci + 1];
    const enType = EN_STREET_TYPES[bare] ?? (bare === "st" && ci > 0 && (!nextChunk || /^\d/.test(nextChunk)) ? "ул" : undefined);
    out.push({ text: (enType ?? translitToRu(bare)) + (trail ? "," : ""), how: "translit" });
    // паспортный транслит: «slavianskaia», «iablonovskii»
    if (ICAO_LATIN.test(low)) out.push({ text: translitToRu(low.replace(/[,.;:]+$/, ""), true) + (trail ? "," : ""), how: "translit" });
    return out;
  });
}

/** Латинская буква номера, похожая на кириллическую начертанием: заглавные — все, строчные — только a, c, e, o, p, x, y. */
const LOOK_UPPER = "ABCEHKMOPTXY";
const LOOK_LOWER = "aceopxy";
/** Латинская буква → кирилица по начертанию. */
const LOOK: Record<string, string> = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" };
/** Где начертание и транслит расходятся — второе прочтение: «24B» — 24В или 24Б, «5P» — 5Р или 5П. */
const LOOK_TWIN: Record<string, string> = { b: "б", c: "ц", h: "х", p: "п" };

/**
 * Кусок — номер дома с латинскими буквами или с буквой-двойником цифры:
 *  - «24a», «10d», «5D», «24zh», «29k1», «7/1b» и буква или корпус отдельным куском после номера («29 k1», «10 d»):
 *    буква — по начертанию (заглавные «B», «H», «P», «C» и строчные «a», «c», «e», «o», «p», «x», «y») или
 *    транслитом («b» — б, «d» — д, «l» — л); раскладкой («a» — «ф») — только если так набран весь запрос;
 *    у «B», «H», «P», «C» (и строчных «c», «p») второе прочтение — `twin`: «24B» — 24В или 24Б;
 *  - «l20», «I20», «3OO», «1O1» — l, I вместо 1 и O вместо 0 (одна O в конце, «12O», — литера, 120 — запасной ключ).
 * `null` — не такой кусок.
 */
export function houseChunk(chunk: string, prev?: string): { text: string; latin: boolean; twin?: string } | null {
  const s = cleanText(chunk);
  const glyph = /^([lI|]?)(\d+)((?:[lI|oOоО]\d*)*)([,.;]?)$/.exec(s);
  // в конце одна «l» — литера «л» («24l»), одна «O» — литера или 0 (как было); цифра-двойник — в начале, между цифрами
  // или несколько «O» подряд
  if (glyph && (glyph[1] || /[lI|oOоО]\d|[oOоО]{2}/.test(glyph[3]))) {
    const d = (x: string) => x.replace(/[lI|]/g, "1").replace(/[oOоО]/g, "0");
    if (/^\d*$/.test(d(glyph[3]))) return { text: d(glyph[1]) + glyph[2] + d(glyph[3]) + glyph[4], latin: false };
  }
  const m = /^(\d+(?:\/\d+)?)([a-z]{1,2})(\d*)([,.;]?)$/i.exec(s) ?? (prev && /\d$/.test(prev) ? /^()([a-z])(\d*)([,.;]?)$/i.exec(s) : null);
  if (!m) return null;
  const letters = m[2];
  // «1st», «2nd» — английские порядковые, не литера
  if (/^(st|nd|rd|th)$/i.test(letters)) return null;
  let cyr: string;
  let twin: string | undefined;
  if (letters.length === 2) {
    const t = translitToRu(letters.toLowerCase());
    cyr = /^[а-я]$/.test(t) ? t : letters.toLowerCase().split("").map((c) => LOOK[c] ?? translitToRu(c)).join("");
  } else {
    const low = letters.toLowerCase();
    const look = letters === letters.toUpperCase() ? LOOK_UPPER.includes(letters) : LOOK_LOWER.includes(letters);
    cyr = look ? LOOK[low] : translitToRu(low);
    if (look && LOOK_TWIN[low]) twin = LOOK_TWIN[low];
  }
  const text = `${m[1]}${cyr}${m[3]}${m[4]}`;
  return { text, latin: true, ...(twin ? { twin: `${m[1]}${twin}${m[3]}` } : {}) };
}

/**
 * Второе прочтение латинской литеры в номерах запроса: ключ номера → ключ-двойник («24B»: 24в → 24б). Для номера
 * отдельным куском («24 B») ключ — с числом перед ним.
 */
export function houseLetterTwins(query: string): Map<string, string> {
  const out = new Map<string, string>();
  const chunks = cleanText(query).split(/\s+/).filter(Boolean);
  chunks.forEach((c, ci) => {
    const h = houseChunk(c, chunks[ci - 1]);
    if (!h?.twin) return;
    const base = /^\d/.test(h.text) ? "" : (/(\d+(?:\/\d+)?)[,.;]?$/.exec(chunks[ci - 1] ?? "")?.[1] ?? "");
    out.set(base + h.text.replace(/[,.;]$/, ""), base + h.twin);
  });
  return out;
}

/** Тип улицы по-английски → сокращение («street» → «ул»). «st» — отдельно: бывает и станицей. */
const EN_STREET_TYPES: Record<string, string> = {
  street: "ул", str: "ул", avenue: "просп", ave: "просп", av: "просп", lane: "пер", ln: "пер", boulevard: "бульвар",
  blvd: "бульвар", square: "пл", sq: "пл", highway: "шоссе", hwy: "шоссе", embankment: "наб", emb: "наб",
};

const ROMAN: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6", VII: "7", VIII: "8", IX: "9", X: "10" };
/**
 * Римская цифра в названии — арабской: «Краснодар-II» = «Краснодар-2», «Краснодар II». Только заглавные: через дефис
 * после кириллического слова — любая до X, через пробел — из двух и более букв (одиночные «I», «V» — латиница).
 */
export function romanToArabic(s: string): string {
  return s
    .replace(/(?<=[а-яёА-ЯЁ]-)(VIII|VII|VI|IV|IX|III|II|I|V|X)(?![A-Za-z0-9])/g, (r) => ROMAN[r])
    .replace(/(?<=[а-яёА-ЯЁ]\s+)(VIII|VII|VI|IV|IX|III|II)(?![A-Za-z0-9])/g, (r) => ROMAN[r]);
}

/** Одна цифра, похожая на букву, внутри кириллического слова: 3 → з, 0 → о, 4 → ч, 6 → б. null — таких нет. */
const DIGIT_LETTER: Record<string, string> = { "3": "з", "0": "о", "4": "ч", "6": "б" };
function digitHomoglyphs(low: string): string | null {
  // внутри: буква-цифра-буква; в начале слова: цифра и за ней 4+ буквы («3ападная», но не «3я», «3й»)
  const s = low
    .replace(/(?<=[а-я])[0346](?=[а-я])/g, (d) => DIGIT_LETTER[d])
    .replace(/(?<![0-9а-я])[03](?=[а-я]{4,})/g, (d) => DIGIT_LETTER[d]);
  return s !== low ? s : null;
}

/**
 * Вид объекта словами — как сокращение: «торговый центр Галерея» = «ТЦ Галерея», «жилой комплекс Мелодия» = «ЖК
 * Мелодия» (иначе «центр» уходит в микрорайон Центр).
 */
const KIND_PHRASES: [RegExp, string][] = [
  [/(^|[^а-я])торгов[а-я]*[\s-]+развлекательн[а-я]*\s+(?:центр|комплекс)[а-я]*(?![а-я])/g, "$1трц"],
  [/(^|[^а-я])торгов[а-я]*\s+центр[а-я]*(?![а-я])/g, "$1тц"],
  [/(^|[^а-я])торгов[а-я]*\s+комплекс[а-я]*(?![а-я])/g, "$1тк"],
  [/(^|[^а-я])жил[а-я]*\s+комплекс[а-я]*(?![а-я])/g, "$1жк"],
  [/(^|[^а-я])бизнес[\s-]*центр[а-я]*(?![а-я])/g, "$1бц"],
];

// ------------------------------------------------------------------ сканер

interface Raw {
  t: string;
  type: "L" | "D" | "P";
  /** Нет пробела и знаков между этим и предыдущим. */
  glued: boolean;
}

const HYPHEN_ABBR: [RegExp, string][] = [
  [/(^|[^а-я])пр-кт(?![а-я])/g, "$1пркт"], [/(^|[^а-я])пр-т(?![а-я])/g, "$1прт"], [/(^|[^а-я])пр-д(?![а-я])/g, "$1прд"],
  [/(^|[^а-я])б-р(?![а-я])/g, "$1бр"], [/(^|[^а-я])кв-л(?![а-я])/g, "$1квл"], [/(^|[^а-я])ст-ц[аы](?![а-я])/g, "$1стца"],
  // ФИАС словами: «посёлок городского типа Яблоновский» = «пгт Яблоновский»
  [/(^|[^а-я])поселок\s+городского\s+типа(?![а-я])/g, "$1пгт"],
  [/(^|[^а-я])мкр-н(?![а-я])/g, "$1мкрн"], [/(^|[^а-я])р-н(?![а-я])/g, "$1рн"], [/(^|[^а-я])м-н(?![а-я])/g, "$1мн"],
  [/(^|[^а-я])х-р(?![а-я])/g, "$1хутор"], [/(^|[^а-я])с\/т(?![а-я])/g, "$1снт"], [/(^|[^а-я])с\/о(?![а-я])/g, "$1снт"],
  [/(^|[^а-я])д\/у(?![а-я])/g, "$1"],
  // «Тахтамукайский м.р-н», «г.о. Краснодар», «г.п. Яблоновское» — район, округ, поселение
  [/(^|[^а-я])м\.?\s?р-н(?![а-я])/g, "$1рн"], [/(^|[^а-я])г\.\s?о\.?(?![а-я])/g, "$1 "], [/(^|[^а-я])[гс]\.\s?п\.?(?![а-я])/g, "$1 "],
  // «садовое (некоммерческое) товарищество Кубаночка» = «СНТ Кубаночка»
  [/(^|[^а-я])(?:(?:садов[а-я]*|садоводческ[а-я]*|дачн[а-я]*|огородническ[а-я]*)\s+)?(?:(?:не)?коммерческ[а-я]*\s+)?(?:товариществ[а-я]*|партнерств[а-я]*)(?![а-я])/g, "$1снт"],
];

function scan(s: string): Raw[] {
  const out: Raw[] = [];
  let i = 0;
  let glued = false;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      glued = false;
      i++;
      continue;
    }
    let j = i + 1;
    let type: Raw["type"];
    if (/[а-яa-z]/.test(c)) {
      type = "L";
      while (j < s.length && /[а-яa-z]/.test(s[j])) j++;
    } else if (/\d/.test(c)) {
      type = "D";
      while (j < s.length && /\d/.test(s[j])) j++;
    } else {
      type = "P";
    }
    const t = s.slice(i, j);
    if (type === "P" && !/[,/\-.№]/.test(t)) {
      // прочие знаки — просто разделители
      glued = false;
      i = j;
      continue;
    }
    out.push({ t, type, glued });
    glued = true;
    i = j;
  }
  return out;
}

const ORD_SUFFIX = new Set(["ый", "ий", "ой", "ая", "яя", "ое", "ее", "го", "ого", "его", "му", "ому", "ему", "ом", "ем", "й", "я", "м", "х", "ых", "ти", "ье", "ья"]);
/** Через дефис порядковое и с «е»: «1-е отделение». */
const ORD_SUFFIX_HYPHEN = new Set([...ORD_SUFFIX, "е"]);
const LET_SUFFIX = new Set(["летия", "летию", "летие", "лет", "летнего"]);
const KORPUS = new Set(["к", "корп", "корпус", "кор"]);
const STROENIE = new Set(["с", "стр", "строение", "стро"]);
const LITERA = new Set(["лит", "литер", "литера"]);
/** Сооружение: «4 соор. 1», «4 сооружение 1», «530соора» — в данных «4соор1», «530соора». */
const SOOR = new Set(["соор", "сооруж", "соорж", "сооружение"]);
/**
 * Одиночные буквы — сокращения типа пункта: «а. Козет», «п. Южный», «х. Ленина». С точкой перед словом — тип
 * пункта; без точки перед словом («113 А Краснодар», «15 п Южный») — скорее литера, но запасной ключ — без неё.
 */
const PLACE_LETTERS = new Set(["а", "п", "х", "г", "с", "д", "ш", "у"]);
/** Предлог после номера: «Красная 120 в Краснодаре» — не литера «120в» (она — запасной ключ). */
const PREP_LETTERS = new Set(["в"]);
/** Первая буква слова «внутри дома», которое дописывают после номера: «п(одъезд)», «э(таж)», «о(фис)». */
const SERVICE_LETTERS = new Set(["п", "э", "о"]);
/** Слово после буквы — точно не пункт: буква — литера дома («113 А кв 5», «350 Д офис 4»). */
function afterLetterIsInside(w: string | undefined): boolean {
  if (!w) return false;
  const fn = functionKind(w);
  return fn === "apartment" || fn === "house" || KORPUS.has(w) || STROENIE.has(w) || LITERA.has(w) || SOOR.has(w);
}

/** Запрос → слова и числа. `query` — уже выбранные варианты кусков, склеенные пробелом. */
export function tokenize(query: string, open = !/[\s,.;]$/.test(query)): QueryToken[] {
  let s = fold(query)
    .replace(/\\/g, "/")
    .replace(/(\d)\s*["«»„“”']\s*([а-я])\s*["«»„“”']?/g, "$1$2") // 10"А" → 10а
    .replace(/[«»"„“”'`]/g, " ");
  for (const [re, rep] of HYPHEN_ABBR) s = s.replace(re, rep);
  for (const [re, rep] of KIND_PHRASES) s = s.replace(re, rep);
  // дефис внутри названия — слитно («Кубано-Набережная»), но короткая первая часть — отдельным словом: сокращение
  // или часть, которую ищут и отдельно («Вост-Кругликовская», «Юго-Западная», «Мега-Победа»)
  s = s.replace(/([а-я]{5,})-(?=[а-я]{2,})/g, "$1");
  const raw = scan(s);
  const out: QueryToken[] = [];
  let comma = false;
  let houseMarker = false;
  const push = (tok: Omit<QueryToken, "prefix" | "comma" | "houseMarker">) => {
    out.push({ ...tok, prefix: false, comma, houseMarker: houseMarker && (tok.kind === "n" || tok.kind === "h") });
    comma = false;
    if (tok.kind !== "w" || tok.fn !== "house") houseMarker = false;
  };
  const isD = (k: number) => raw[k]?.type === "D";
  const isL = (k: number) => raw[k]?.type === "L";
  const isP = (k: number, p: string) => raw[k]?.type === "P" && raw[k].t === p;
  /** С позиции k (через запятую, «д.», «дом») идёт номер. */
  const houseAhead = (k: number) => {
    while (isP(k, ",") || isP(k, ".") || (isL(k) && functionKind(raw[k].t) === "house")) k++;
    return isD(k);
  };

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (r.type === "P") {
      if (r.t === ",") comma = true;
      continue;
    }
    if (r.type === "L") {
      const w = r.t;
      const ord = numeralWord(w);
      if (ord) {
        push({ kind: "o", text: ord, fn: null });
        continue;
      }
      // «Семидесятилетия Октября» = «70 лет Октября»
      const years = yearsWord(w);
      if (years) {
        push({ kind: "o", text: years, fn: null });
        push({ kind: "w", text: "лет", fn: null });
        continue;
      }
      const lastOut = out[out.length - 1];
      // «Мачуги 41 под», «Красная 120 эта» — после номера дописывают «подъезд», «этаж»: номер остаётся домом
      if (open && i === raw.length - 1 && lastOut && (lastOut.kind === "n" || lastOut.kind === "h") && !functionKind(w) && apartmentPrefix(w)) continue;
      let fn = functionKind(w);
      const abbr = (isP(i + 1, ".") || (isP(i + 1, "-") && raw[i + 1].glued)) && isL(i + 2) || (isP(i + 1, ".") && w.length === 1);
      // «В.Кругликовская», «И. Петрова» — буква с точкой — инициал, а не предлог
      if (abbr && w.length === 1 && fn === "filler") fn = null;
      // «кв. 224», «офис 5», «под. 3», «эт 2», «домофон 25» — квартира и прочее внутри дома: выбросить вместе с
      // числом. Недонабранное последнее слово без номера раньше («Под…», «Ком…») — начало названия, не выбрасывать.
      if (fn === "apartment" && !(open && i === raw.length - 1 && !out.some((t) => t.kind === "n" || t.kind === "h"))) {
        let k = i + 1;
        while (isP(k, ".") || isP(k, "№")) k++;
        if (isD(k)) {
          i = k;
          // «кв 5-6», «кв. 12/1», «кв. 5а»
          while (isD(i + 1) || ((isP(i + 1, "-") || isP(i + 1, "/")) && isD(i + 2)) || (isL(i + 1) && raw[i + 1].glued && raw[i + 1].t.length === 1)) i++;
        } else if (w === "вход") {
          // «вход со двора», «вход с торца»
          if (isL(k) && (raw[k].t === "с" || raw[k].t === "со")) k++;
          if (isL(k)) i = k;
        }
        continue;
      }
      if (fn === "house") houseMarker = true;
      // недонабранное «Ком…», «Под…» — начало названия, а не «комната», «подъезд»
      push({ kind: "w", text: canonicalWord(w), fn: fn === "apartment" ? null : fn, ...(abbr ? { abbr: true } : {}) });
      continue;
    }
    // Цифры
    const n = r.t;
    // «40-летия», «40 лет» → число в названии + «лет»
    const nx = raw[i + 1];
    if (nx && ((nx.type === "L" && LET_SUFFIX.has(nx.t)) || (isP(i + 1, "-") && isL(i + 2) && LET_SUFFIX.has(raw[i + 2].t)))) {
      push({ kind: "o", text: n, fn: null });
      push({ kind: "w", text: "лет", fn: null });
      i += nx.type === "L" ? 1 : 2;
      continue;
    }
    // «17 км», «17км» — километр дороги, часть названия места («Ростовское шоссе, 17 км»), а не дом
    if (nx?.type === "L" && nx.t === "км") {
      push({ kind: "o", text: n, fn: null });
      push({ kind: "w", text: "км", fn: functionKind("км") });
      i += 1;
      continue;
    }
    // Число через дефис после слова, а дальше — ещё номер: часть названия («Северный-3 135», «Северный-1, д. 17»)
    if (isP(i - 1, "-") && r.glued && raw[i - 1].glued && isL(i - 2) && raw[i - 2].t.length >= 2 && houseAhead(i + 1)) {
      push({ kind: "o", text: n, fn: null });
      continue;
    }
    // Порядковое: «1-й», «2-я», «1-го», «3й»
    const hyphenOrd = isP(i + 1, "-") && raw[i + 1].glued && isL(i + 2) && raw[i + 2].glued && ORD_SUFFIX_HYPHEN.has(raw[i + 2].t)
      && !(isD(i + 3) && raw[i + 3].glued);
    // слитно: «3й», «1го», «2ая»; одна буква «я», «м», «х» слитно — скорее литера дома («12я» редко, но не порядковое)
    const gluedOrd = nx?.type === "L" && nx.glued && ORD_SUFFIX_HYPHEN.has(nx.t) && !(isD(i + 2) && raw[i + 2].glued)
      && (nx.t.length >= 2 || nx.t === "й"
        // «7я Линия», «1е отделение» — порядковое, если дальше слово; «Красная 7я» — литера
        || (isL(i + 2) && raw[i + 2].t.length >= 3 && !["apartment", "house", "place-type"].includes(functionKind(raw[i + 2].t) ?? "")));
    if (hyphenOrd || gluedOrd) {
      const skip = isP(i + 1, "-") ? 2 : 1;
      // «3-й этаж», «2-й подъезд» — внутри дома, не часть названия
      if (isL(i + skip + 1) && NUMBER_BEFORE_APARTMENT.has(raw[i + skip + 1].t)) {
        i += skip + 1;
        continue;
      }
      push({ kind: "o", text: n, fn: null, gender: ordGender(isP(i + 1, "-") ? raw[i + 2].t : nx.t) });
      i += skip;
      continue;
    }
    // число перед «этаж», «подъезд»: «5 этаж», «3 подъезд». Но «Красная 120 подъезд 2», «120 эт. 3» — у слова своё
    // число после, а 120 — дом (если перед ним название, а не другой номер: «Красная 120, 3 подъезд 5 этаж» — 3 —
    // подъезд); «Мачуги 41 под» — слово ещё дописывают
    if (nx?.type === "L" && NUMBER_BEFORE_APARTMENT.has(nx.t)) {
      let k2 = i + 2;
      while (isP(k2, ".") || isP(k2, "№")) k2++;
      const own = isD(k2) || (open && i + 1 === raw.length - 1);
      const prevTok = out[out.length - 1];
      const houseSlot = !prevTok || prevTok.kind === "w" || !out.some((t) => t.kind === "n" || t.kind === "h");
      if (!(own && houseSlot)) {
        i++;
        continue;
      }
    }
    // Почтовый индекс
    if (/^(35|38|36)\d{4}$/.test(n)) continue;
    // Номер дома: число + буква / корпус / строение / литера / дробь
    let key = n;
    const alts: string[] = [];
    /** Запасной ключ «без литеры» — последним: сначала другие прочтения того же номера («45 А, к. 1» → 45а/1). */
    const baseAlts: string[] = [];
    let partial: string | undefined;
    let k = i + 1;
    for (;;) {
      const a = raw[k];
      if (!a) break;
      // «125/» в конце набираемого запроса — дробь ещё не набрана
      if (open && a.type === "P" && a.t === "/" && k === raw.length - 1) {
        partial = key + "/";
        k += 1;
        break;
      }
      if (a.type === "P" && a.t === "/" && isD(k + 1)) {
        key += "/" + raw[k + 1].t;
        k += 2;
        continue;
      }
      // «22/Б»
      if (a.type === "P" && a.t === "/" && isL(k + 1) && raw[k + 1].t.length === 1 && !(isD(k + 2) && raw[k + 2].glued)) {
        key += "/" + raw[k + 1].t;
        k += 2;
        continue;
      }
      if (a.type === "P" && a.t === "-" && a.glued && isL(k + 1) && raw[k + 1].glued && raw[k + 1].t.length === 1 && !isD(k + 2)) {
        key += raw[k + 1].t;
        k += 2;
        continue;
      }
      // «120-5», «22-1»: дробь (22/1), номер как есть (482-483) или дом и квартира (120, кв. 5)
      if (a.type === "P" && a.t === "-" && a.glued && isD(k + 1) && raw[k + 1].glued && !key.includes("/") && !(isP(k + 2, "-") || isP(k + 2, "/"))) {
        alts.push(`${key}-${raw[k + 1].t}`, key);
        key += "/" + raw[k + 1].t;
        k += 2;
        break;
      }
      // корпус/строение/литера: «21к1», «21 к1», «21 к. 1», «21, корп 1», «12 стр 2»
      let kk = k;
      if (a.type === "P" && a.t === ",") kk = k + 1;
      const b = raw[kk];
      // «530соора», «86соорл» — сооружение с буквой слитно
      const soorGlued = b?.type === "L" && b.glued ? /^соор([а-я])$/.exec(b.t) : null;
      if (soorGlued && !isD(kk + 1)) {
        key += "соор" + soorGlued[1];
        k = kk + 1;
        continue;
      }
      if (b?.type === "L" && SOOR.has(b.t)) {
        let m = kk + 1;
        while (isP(m, ".")) m++;
        if (isD(m) || (isL(m) && raw[m].t.length === 1 && !(isP(m + 1, ".") && isL(m + 2)))) {
          key += "соор" + raw[m].t;
          k = m + 1;
          continue;
        }
        if (open && m >= raw.length) {
          partial = key + "соор";
          k = m;
          break;
        }
      }
      if (b?.type === "L" && (KORPUS.has(b.t) || STROENIE.has(b.t) || LITERA.has(b.t))) {
        let m = kk + 1;
        while (isP(m, ".")) m++;
        // «85С», «7К» в конце набираемого запроса — литера слитно (такой дом бывает), но может быть и начало
        // «85с1», «7к2»: ключ — с литерой, дополнения — от него же
        if (open && m >= raw.length && kk === k && b.glued && b.t.length === 1) {
          key += b.t;
          partial = key;
          k = m;
          break;
        }
        // «21 корп», «6 стр.» в конце набираемого запроса — корпус ещё не набран
        if (open && m >= raw.length && !(b.t.length === 1 && !b.glued && PLACE_LETTERS.has(b.t))) {
          partial = key + (KORPUS.has(b.t) ? "к" : STROENIE.has(b.t) ? "с" : "лит");
          k = m;
          break;
        }
        if (LITERA.has(b.t) && (isL(m) && raw[m].t.length <= 2 || isD(m))) {
          key += "лит" + raw[m].t;
          k = m + 1;
          continue;
        }
        if (!LITERA.has(b.t) && isD(m)) {
          // «22 к1» и «22/1» пишут про один дом: дробь — запасной ключ
          if (KORPUS.has(b.t) && !key.includes("/")) alts.push(`${key}/${raw[m].t}`);
          key += (KORPUS.has(b.t) ? "к" : "с") + raw[m].t;
          k = m + 1;
          continue;
        }
        // «88 стр. а», «26 строение Б» — строение (корпус) с буквой: «88са»; буква — не «аул» («стр. а. Козет» — аул)
        if (!LITERA.has(b.t) && b.t.length > 1 && isL(m) && raw[m].t.length === 1
          && !(isD(m + 1) && raw[m + 1].glued) && !(isP(m + 1, ".") && isL(m + 2))) {
          key += (KORPUS.has(b.t) ? "к" : "с") + raw[m].t;
          k = m + 1;
          continue;
        }
      }
      // Буква: «7б», «7 б», «7 Б». Но «58, а. Козет» — тип пункта, «120 в Краснодаре» — предлог.
      if (a.type === "L" && a.t.length === 1 && !isD(k + 1)) {
        const dotAfter = isP(k + 1, ".");
        const next = isL(k + 1) ? raw[k + 1].t : dotAfter && isL(k + 2) ? raw[k + 2].t : undefined;
        // «45 А, к. 1» — после запятой корпус: буква — литера
        const inside = afterLetterIsInside(next) || (isP(k + 1, ",") && afterLetterIsInside(isL(k + 2) ? raw[k + 2].t : undefined));
        if (a.glued || inside) {
          // «113 А кв 5», «350 Д офис 4», «113а.» — литера
          key += a.t;
          k += dotAfter && inside && !a.glued ? 2 : 1;
          continue;
        }
        // «Красная 120 п» — дописывают «подъезд», «этаж», «офис»: дом 120, литера — запасной ключ
        if (open && k === raw.length - 1 && !a.glued && SERVICE_LETTERS.has(a.t)) {
          alts.push(key + a.t);
          k += 1;
          break;
        }
        if (PREP_LETTERS.has(a.t) && next !== undefined && !dotAfter) {
          // «120 в Краснодаре»: предлог остаётся словом, литера — запасной ключ
          alts.push(key + a.t);
          break;
        }
        if (!dotAfter) {
          // «113 А Краснодар», «15 п Южный», «58/1 г, Краснодар»: литера, запасной ключ — без неё
          // (только если дальше слово: «3 А/7» — литера и дробь, без запасного «3»)
          let k2 = k + 1;
          while (isP(k2, ",")) k2++;
          if (PLACE_LETTERS.has(a.t) && isL(k2)) baseAlts.push(key);
          key += a.t;
          k += 1;
          continue;
        }
      }
      // «10Б2» — буква и число слитно
      if (a.type === "L" && a.glued && a.t.length === 1 && !KORPUS.has(a.t) && !STROENIE.has(a.t) && isD(k + 1) && raw[k + 1].glued) {
        key += a.t + raw[k + 1].t;
        k += 2;
        continue;
      }
      // «2АП», «11лит» — несколько букв слитно
      if (a.type === "L" && a.glued && a.t.length <= 3 && !isD(k + 1) && !KORPUS.has(a.t) && !STROENIE.has(a.t)) {
        key += a.t;
        k += 1;
        continue;
      }
      // «88 сГ», «5 кБ» — строение/корпус с буквой (но не «кв.», «ст.» — служебные слова)
      if (a.type === "L" && /^[кс][а-я]$/.test(a.t) && !functionKind(a.t) && !isD(k + 1) && !isL(k + 1) && !(isP(k + 1, ".") && isL(k + 2))) {
        key += a.t;
        k += 1;
        continue;
      }
      // «литА», «литерБ», «литераО» слитно: «7литерБ», «сормовская7литераБ»
      const lit = a.type === "L" ? /^(?:лит|литер|литера)([а-я])$/.exec(a.t) : null;
      if (lit) {
        key += "лит" + lit[1];
        k += 1;
        continue;
      }
      break;
    }
    // одна литера — два написания: «131 литер А» = «131А», «242Г» = «242литГ» (так бывает в данных) — тот же дом
    const lk = lookalikesToRu(key);
    const lit = /^(\d+(?:\/\d+)?)лит([а-я])$/.exec(lk);
    const let1 = /^(\d+(?:\/\d+)?)([а-я])$/.exec(lk);
    if (lit) alts.unshift(lit[1] + lit[2]);
    else if (let1) {
      alts.unshift(`${let1[1]}лит${let1[2]}`);
      // «Красная 12О» — буква О вместо нуля: 120
      if (let1[2] === "о") alts.push(`${let1[1]}0`);
    }
    const houseAlts = [...new Set([...alts, ...baseAlts].map(lookalikesToRu))].filter((x) => x !== lk);
    push({
      kind: key === n ? "n" : "h", text: key, house: lookalikesToRu(key), fn: null,
      ...(houseAlts.length ? { houseAlts } : {}), ...(partial ? { partial: lookalikesToRu(partial) } : {}),
    });
    i = k - 1;
  }
  if (open && out.length) out[out.length - 1].prefix = true;
  return out;
}

/** Род порядкового по окончанию: «я», «ая», «яя» — f; «й», «ый», «ий», «ой», «го» — m; «е», «ое» — n. */
function ordGender(suffix: string): "f" | "m" | "n" | undefined {
  if (/^(я|ая|яя|ую|ей)$/.test(suffix)) return "f";
  if (/^(й|ый|ий|ой|го|ого|его|му|ому|ом|ым)$/.test(suffix)) return "m";
  if (/^(е|ое|ее)$/.test(suffix)) return "n";
  return undefined;
}

/** Слова запроса без вариантов раскладки — для тестов и отладки. */
export function tokenTexts(query: string): string[] {
  return tokenize(query).map((t) => t.text);
}

export { layoutToRu, translitToRu };
