// Номер дома: ключ сравнения и разбор на части.
// «21к1» = «21 к1» = «21 корп.1» = «21, корпус 1»; «7Б» = «7 б» = «7-Б» = «7"Б"»; «151 стр 2» = «151с2»;
// «97 лит. Л» = «97литл»; «78/1A» (латиница) = «78/1а».

import { fold, lookalikesToRu } from "./text";

/** Ключ номера — одинаковый для всех написаний одного дома. */
export function houseKey(raw: string): string {
  let s = lookalikesToRu(fold(raw)).replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  s = s.replace(/^(?:дом|д|№)\.?\s*/, "");
  s = s.replace(/корпус|корп\.?/g, "к").replace(/строение|стр\.?/g, "с").replace(/литера|литер|лит\.?/g, "лит");
  s = s.replace(/[\s,."'«»„“”()]+/g, "");
  s = s.replace(/(\d)-(?=[а-я])/g, "$1"); // «15-а» → «15а», но «482-483» остаётся
  return s;
}

export interface HouseParts {
  /** Ведущее число: «21к1» → 21, «7Б» → 7; нет числа — −1. */
  num: number;
  /** Буква сразу после числа: «7б» → «б». */
  letter: string;
  /** Всё после ведущего числа и буквы: «/1», «к1», «с2», «лит л». */
  rest: string;
}

export function houseParts(key: string): HouseParts {
  const m = /^(\d+)([а-я](?![а-я0-9]))?(.*)$/.exec(key);
  if (!m) return { num: -1, letter: "", rest: key };
  return { num: Number(m[1]), letter: m[2] ?? "", rest: m[3] ?? "" };
}

/** Показ номера как в адресе: «21к1», «7Б», «12с2», «97литЛ» (буквы-литеры — заглавные). */
export function displayHouse(raw: string): string {
  const k = houseKey(raw);
  return k.replace(/^(\d+(?:\/\d+)?)([а-я])(?![а-я0-9])/, (_, n: string, l: string) => n + l.toUpperCase());
}
