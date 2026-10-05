// Текстовые примитивы поиска «Что»: нормализация, раскладка, транслит, грубая
// основа слова и расстояние с опечатками. Перенесены из sravniprokat без
// изменения поведения — на них держатся и подсказки, и выдача `/search`, и
// подсветка на клиенте, поэтому модуль чистый и без зависимостей.

/** Кириллица, которую путают с латиницей в артикулах. */
const HOMOGLYPHS: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y",
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", х: "x", у: "y",
};

/** В слове есть латиница — кириллические двойники в нём тоже латиница: «НR2470» → «HR2470». */
export function fixHomoglyphs(word: string): string {
  if (!/[A-Za-z]/.test(word)) return word;
  return [...word].map((c) => HOMOGLYPHS[c] ?? c).join("");
}

/** Нижний регистр, ё → е, всё кроме букв и цифр — пробел. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
}

/** Слова нескольких строк подряд, уже нормализованные. */
export function words(...parts: (string | null | undefined)[]): string[] {
  return parts.flatMap((p) => (p ? normalize(p).split(" ").filter(Boolean) : []));
}

/** Слитно — «GBH 2-26» ищется и как «gbh226», «Puzzi 8/1» — как «puzzi81». */
export function compact(s: string): string {
  return normalize(s).replace(/ /g, "");
}

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = "йцукенгшщзхъфывапролджэячсмитьбюё";
const EN_TO_RU = new Map([...EN].map((c, i) => [c, RU[i]]));
const RU_TO_EN = new Map([...RU].map((c, i) => [c, EN[i]]));

/** Набрано не в той раскладке: «gthajhfnjh» → «перфоратор», «ьфлшеф» → «makita». */
export function switchLayout(s: string): string {
  const low = s.toLowerCase();
  const map = /[a-z]/.test(low) ? EN_TO_RU : RU_TO_EN;
  return [...low].map((c) => map.get(c) ?? c).join("");
}

const LAT_TO_CYR: [string, string][] = [
  ["shch", "щ"], ["sch", "щ"], ["zh", "ж"], ["ch", "ч"], ["sh", "ш"], ["kh", "х"], ["ts", "ц"],
  ["ya", "я"], ["yu", "ю"], ["yo", "е"], ["a", "а"], ["b", "б"], ["v", "в"], ["g", "г"], ["d", "д"],
  ["e", "е"], ["z", "з"], ["i", "и"], ["y", "ы"], ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"],
  ["o", "о"], ["p", "п"], ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["f", "ф"], ["h", "х"],
  ["c", "к"], ["w", "в"], ["x", "кс"], ["j", "дж"], ["q", "к"],
];
const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch",
  ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Транслит в обе стороны: «perforator» → «перфоратор», «макита» → «makita». */
export function transliterate(word: string): string {
  if (/[а-я]/.test(word)) return [...word].map((c) => CYR_TO_LAT[c] ?? c).join("");
  let out = "";
  for (let i = 0; i < word.length;) {
    const hit = LAT_TO_CYR.find(([lat]) => word.startsWith(lat, i));
    if (hit) { out += hit[1]; i += hit[0].length; } else { out += word[i]; i++; }
  }
  return out;
}

// Окончания для грубой основы: «перфоратора», «перфораторы», «моющего», «болгарку».
const ENDINGS = [
  "ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими", "ах", "ях", "ов", "ев", "ей", "ой", "ый", "ий",
  "ая", "яя", "ое", "ее", "ую", "юю", "ом", "ем", "ам", "ям", "а", "я", "ы", "и", "у", "ю", "е", "о",
];

/** Основа русского слова: окончание прочь, если остаётся не меньше 4 букв. */
export function stem(t: string): string {
  if (!/[а-я]/.test(t) || t.length < 5) return t;
  for (const e of ENDINGS) if (t.endsWith(e) && t.length - e.length >= 4) return t.slice(0, -e.length);
  return t;
}

// Три строки матрицы OSA вместо целой: расстояние считается на каждое слово
// словаря города, и матрица на каждый вызов была бы главной тратой времени.
// Результат тот же, что у полной матрицы (тест сверяет).
let rowA = new Int32Array(64);
let rowB = new Int32Array(64);
let rowC = new Int32Array(64);

/** Расстояние с перестановкой соседних букв (OSA), с отсечкой по max: больше max — значит max + 1. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length + 1;
  if (rowA.length < n) { rowA = new Int32Array(n); rowB = new Int32Array(n); rowC = new Int32Array(n); }
  // prev2 — строка i-2, prev — i-1, cur — i.
  let prev2 = rowA;
  let prev = rowB;
  let cur = rowC;
  for (let j = 0; j < n; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d;
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return max + 1;
    const t = prev2; prev2 = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}
