// Маска телефона в запасной форме заявки: «+7 (900) 123-45-67» по мере ввода,
// как у операторов, — чтобы номер с ошибкой не уходил в группу. Только
// российские номера: иностранный («+» и не 7/8) маска не трогает, и форма его
// не примет (isCompletePhone). Сервер маске не доверяет — нормализует сам
// (normalizePhone).
//
// Правка разбирается как замена куска строки: что стёрто и что вставлено —
// по общему началу и концу прежнего и нового значения. Отсюда три правила:
// - висящих разделителей в конце нет («+7 (90», а не «+7 (90) »), и Backspace
//   в конце строки всегда стирает цифру;
// - стёртый разделитель уносит цифру рядом: слева при Backspace, справа при
//   Delete, — иначе маска вернула бы его на место;
// - код страны не стирается, пока в номере есть цифры: без него номер стал бы
//   «иностранным», и человек не понял бы, чего от него хочет форма.

export const PHONE_NATIONAL_DIGITS = 10;

const digitsOf = (s: string) => s.replace(/\D/g, "");

/**
 * Национальные цифры номера; null — иностранный номер («+» и не 7/8). Код
 * страны 7 или 8 отрезается один раз: после «+» — всегда («+8 900…» — частая
 * опечатка вместо 8 900…), у голых цифр — если их не ровно десять (десять —
 * это номер без кода: «9001234567», «8005553535»).
 */
export function nationalDigits(raw: string): string | null {
  const digits = digitsOf(raw);
  const plus = raw.trimStart().startsWith("+");
  const lead = digits[0];
  if (plus && lead !== undefined && lead !== "7" && lead !== "8") return null;
  const withCode = plus || (digits.length !== PHONE_NATIONAL_DIGITS && (lead === "7" || lead === "8"));
  return (withCode ? digits.slice(1) : digits).slice(0, PHONE_NATIONAL_DIGITS);
}

/** «+7 (900) 123-45-67» из национальных цифр, без висящих разделителей. */
function formatNational(n: string): string {
  let out = "+7";
  if (n.length > 0) out += ` (${n.slice(0, 3)}`;
  if (n.length > 3) out += `) ${n.slice(3, 6)}`;
  if (n.length > 6) out += `-${n.slice(6, 8)}`;
  if (n.length > 8) out += `-${n.slice(8, 10)}`;
  return out;
}

/** Отформатированное значение из любого ввода; пусто — пусто, один «+» — «+». */
export function formatPhoneInput(raw: string): string {
  const n = nationalDigits(raw);
  if (n === null) return raw;
  // Один «+» оставляем как есть: следующей человек наберёт 7 — это код.
  if (digitsOf(raw) === "") return raw.includes("+") ? "+" : "";
  return formatNational(n);
}

/** Номер набран полностью: десять национальных цифр. */
export function isCompletePhone(value: string): boolean {
  return nationalDigits(value)?.length === PHONE_NATIONAL_DIGITS;
}

/** Позиция перед национальной цифрой k (k = длине — конец строки). */
function beforeNational(value: string, k: number): number {
  let seen = -1; // первая цифра значения — код страны
  for (let i = 0; i < value.length; i++) {
    if (!/\d/.test(value[i])) continue;
    if (seen === k) return i;
    seen++;
  }
  return value.length;
}

/** Сколько национальных цифр стоит в отформатированном значении до позиции i. */
function nationalBefore(value: string, i: number): number {
  return Math.max(0, digitsOf(value.slice(0, i)).length - 1);
}

/**
 * Правка поля: прежнее значение, то, что оказалось в поле, каретка и
 * `inputType` события. Возвращает отформатированное значение и куда поставить
 * каретку — после того же числа цифр, что стояли перед ней: React ставит её в
 * конец, и правка в середине номера уводила бы следующую цифру не туда.
 */
export function applyPhoneEdit(
  prev: string,
  raw: string,
  caret: number,
  inputType = "",
): { value: string; caret: number } {
  const prevN = nationalDigits(prev);
  // Иностранный номер маска не трогает, пока он им остаётся.
  if (prevN === null) {
    return nationalDigits(raw) === null ? { value: raw, caret } : whole(raw);
  }
  const rawN = nationalDigits(raw);

  // Что заменено: общее начало и конец прежнего и нового значения.
  let p = 0;
  while (p < prev.length && p < raw.length && prev[p] === raw[p]) p++;
  let s = 0;
  while (s < prev.length - p && s < raw.length - p && prev[prev.length - 1 - s] === raw[raw.length - 1 - s]) s++;
  const inserted = raw.slice(p, raw.length - s);
  const insDigits = digitsOf(inserted);
  // Вставлен целый номер (десять цифр и больше или с «+») — он заменяет
  // прежний, а не вклеивается в него: иначе «89001234567», вставленный после
  // «+7», дал бы «+7 (890)…».
  const pastedWhole = inserted.trimStart().startsWith("+") || insDigits.length >= PHONE_NATIONAL_DIGITS;

  // Кода ещё нет (пусто или «+») — первый символ, вставка, автозаполнение.
  if (digitsOf(prev) === "") {
    if (rawN !== null) return whole(raw);
    if (pastedWhole && nationalDigits(inserted) !== null) return whole(inserted);
    return { value: raw, caret };
  }
  // Правка задела код страны и дала целый номер — выделили всё и вставили
  // или подставило автозаполнение. Совпавший с прежним хвост тут случаен.
  if (p < 2 && rawN !== null && digitsOf(raw).length >= PHONE_NATIONAL_DIGITS) return whole(raw);
  if (pastedWhole) {
    return nationalDigits(inserted) === null ? { value: raw, caret } : whole(inserted);
  }
  // Цифр номера нет — «+7» стирается как обычный текст.
  if (prevN === "" && insDigits === "") return whole(raw);

  let start = nationalBefore(prev, p);
  let end = nationalBefore(prev, prev.length - s);
  if (start === end && insDigits === "") {
    // Стёрт только разделитель (или код страны) — уходит цифра рядом.
    if (inputType === "deleteContentForward") end = Math.min(end + 1, prevN.length);
    else if (inputType === "deleteContentBackward" && start > 0) start -= 1;
    else return { value: prev, caret: Math.min(p, prev.length) };
  }
  const n = (prevN.slice(0, start) + insDigits + prevN.slice(end)).slice(0, PHONE_NATIONAL_DIGITS);
  const value = formatNational(n);
  const k = Math.min(start + insDigits.length, n.length);
  return { value, caret: beforeNational(value, k) };
}

function whole(raw: string): { value: string; caret: number } {
  const value = formatPhoneInput(raw);
  return { value, caret: value.length };
}
