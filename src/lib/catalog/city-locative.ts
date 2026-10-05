// Подсказка предложного падежа для админской формы города: «Казань» → «Казани».
//
// Это именно подсказка, а не источник правды. Падеж хранится колонкой
// `cities.name_locative`, потому что правилом русские топонимы не берутся:
// «Петропавловск-Камчатский» склоняется в обеих частях, «Санкт-Петербург» — в
// последней, «Ростов-на-Дону» — в первой, а «Сочи» не склоняется вовсе. Правило
// покрывает частые формы, редактор смотрит глазами и правит. Молча неверный
// падеж на страницу не попадает: пока колонка пуста, заголовок собирается без
// предлога.

// Одно слово. Прилагательные («Нижний», «Набережные») склоняются не так, как
// существительные, поэтому их окончания проверяются первыми.
function declineWord(word: string): string {
  const cut = (n: number, tail: string) => word.slice(0, -n) + tail;

  if (word.endsWith("ый")) return cut(2, "ом");           // Грозный → Грозном
  if (word.endsWith("ой")) return cut(2, "ом");           // Донской → Донском
  if (word.endsWith("ий")) {
    const stem = word.slice(0, -2);
    // После к/г/х окончание твёрдое: Великий → Великом, но Нижний → Нижнем.
    return stem + (/[кгх]$/u.test(stem) ? "ом" : "ем");
  }
  if (word.endsWith("ая")) return cut(2, "ой");           // Белая → Белой
  if (word.endsWith("ые")) return cut(2, "ых");           // Набережные → Набережных
  if (word.endsWith("ие")) return cut(2, "их");           // Верхние → Верхних

  if (word.endsWith("ия")) return cut(2, "ии");           // Феодосия → Феодосии
  if (word.endsWith("а") || word.endsWith("я")) return cut(1, "е");  // Москва → Москве
  if (word.endsWith("ь")) return cut(1, "и");             // Казань → Казани
  if (word.endsWith("о")) return cut(1, "е");             // Иваново → Иванове
  if (word.endsWith("ы") || word.endsWith("и")) return cut(1, "ах"); // Челны → Челнах
  if (word.endsWith("й")) return cut(1, "е");             // Ногинский-край → …
  return `${word}е`;                                      // Омск → Омске
}

// Часть названия между пробелами. Дефис ведёт себя двояко, поэтому разбирается
// отдельно от пробела.
function declineToken(token: string): string {
  // «Ростов-на-Дону», «Комсомольск-на-Амуре»: склоняется голова, хвост с
  // предлогом остаётся как есть.
  const onRiver = /^(.+?)(-на-.+)$/u.exec(token);
  if (onRiver) return declineWord(onRiver[1]!) + onRiver[2]!;

  // «Санкт-Петербург», «Гусь-Хрустальный»: склоняется последняя часть.
  const parts = token.split("-");
  if (parts.length > 1) {
    parts[parts.length - 1] = declineWord(parts[parts.length - 1]!);
    return parts.join("-");
  }

  return declineWord(token);
}

/** «Нижний Новгород» → «Нижнем Новгороде». Пустое имя даёт пустую строку. */
export function suggestLocative(name: string): string {
  const normalized = name.trim().replace(/\s+/gu, " ");
  if (!normalized) return "";
  return normalized.split(" ").map(declineToken).join(" ");
}

export interface CityNames {
  name: string;
  nameLocative: string | null;
}

/**
 * Город в заголовке и во фразе: «в Казани», а без падежа — «· Казань».
 *
 * Незаполненный падеж не выдумывается и не подставляется именительным: «Аренда:
 * дрели в Казань» — то, ради чего колонка и заводилась.
 *
 * Форма одна на все места. Отдельный вариант для середины фразы («, Казань»)
 * встречался с запятой шаблона и давал « , Казань».
 */
export function headingCity(city: CityNames): string {
  return city.nameLocative ? `в ${city.nameLocative}` : `· ${city.name}`;
}
