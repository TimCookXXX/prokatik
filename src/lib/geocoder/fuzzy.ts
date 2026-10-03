// Расстояние Дамерау–Левенштейна (вариант OSA: вставка, удаление, замена, перестановка соседних)
// с отсечкой по max. Буферы переиспользуются — функция вызывается тысячи раз на запрос.

let prev2 = new Int32Array(64);
let prev = new Int32Array(64);
let cur = new Int32Array(64);

function ensure(n: number): void {
  if (prev.length >= n) return;
  const size = Math.max(n, prev.length * 2);
  prev2 = new Int32Array(size);
  prev = new Int32Array(size);
  cur = new Int32Array(size);
}

/** Расстояние между a и b, но не больше max + 1 (дальше не считаем). */
export function damerau(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  ensure(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ca === cb ? 0 : 1);
      const del = prev[j] + 1;
      if (del < v) v = del;
      const ins = cur[j - 1] + 1;
      if (ins < v) v = ins;
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        const tr = prev2[j - 2] + 1;
        if (tr < v) v = tr;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  return prev[lb];
}

let dlRows = new Int32Array(0);
const lastRow = new Int32Array(2048);

/**
 * Полное расстояние Дамерау–Левенштейна (Лоуренс–Вагнер): перестановка соседних букв с правкой между ними —
 * «дзержсикого» → «дзержинского» = 2 (у OSA — 3). Сначала быстрый OSA с отсечкой; полный — только если OSA
 * больше max, а слово длинное (от 7 букв). Не больше max + 1.
 */
export function damerauFull(a: string, b: string, max: number): number {
  const osa = damerau(a, b, max);
  if (osa <= max || max < 2 || a.length < 7) return osa;
  const la = a.length;
  const lb = b.length;
  const w = lb + 2;
  if (dlRows.length < (la + 2) * w) dlRows = new Int32Array((la + 2) * w * 2);
  const H = dlRows;
  const INF = la + lb;
  H[0] = INF;
  for (let i = 0; i <= la; i++) {
    H[(i + 1) * w] = INF;
    H[(i + 1) * w + 1] = i;
  }
  for (let j = 0; j <= lb; j++) {
    H[j + 1] = INF;
    H[w + j + 1] = j;
  }
  for (let i = 1; i <= la; i++) {
    let db = 0;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      const i1 = lastRow[cb & 2047];
      const j1 = db;
      let cost = 1;
      if (ca === cb) {
        cost = 0;
        db = j;
      }
      let v = H[i * w + j] + cost;
      const ins = H[(i + 1) * w + j] + 1;
      if (ins < v) v = ins;
      const del = H[i * w + j + 1] + 1;
      if (del < v) v = del;
      const tr = H[i1 * w + j1] + (i - i1 - 1) + 1 + (j - j1 - 1);
      if (tr < v) v = tr;
      H[(i + 1) * w + j + 1] = v;
    }
    lastRow[ca & 2047] = i;
  }
  for (let i = 0; i < la; i++) lastRow[a.charCodeAt(i) & 2047] = 0;
  return Math.min(H[(la + 1) * w + lb + 1], max + 1);
}

/**
 * Лучшее расстояние от `prefix` до какого-нибудь начала `word` (опечатка в недонабранном слове):
 * «кабзекск» → «казбекская» = 1. Не больше max + 1.
 */
export function prefixDamerau(prefix: string, word: string, max: number): number {
  let best = max + 1;
  const lo = Math.max(1, prefix.length - max);
  const hi = Math.min(word.length, prefix.length + max);
  for (let len = lo; len <= hi; len++) {
    const d = damerau(prefix, word.slice(0, len), max);
    if (d < best) best = d;
    if (best === 0) break;
  }
  return best;
}

/** Маска букв слова (кириллица и латиница по модулю 32): у слов на расстоянии k различаются ≤ 2k бит. */
export function letterMask(w: string): number {
  let m = 0;
  for (let i = 0; i < w.length; i++) m |= 1 << (w.charCodeAt(i) & 31);
  return m >>> 0;
}

export function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
