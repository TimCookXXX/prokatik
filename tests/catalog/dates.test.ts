import { describe, it, expect } from "vitest";
import {
  dateRangeLabel, daysLabel, shortRangeLabel, formatMonthYearGen, todayStr, formatDayMonthNum, formatTimeLeft,
  isDateStr, rangeDaysCount, weekdayShort,
} from "@/lib/catalog/dates";

describe("todayStr", () => {
  it("takes the calendar day in the business zone, not in UTC", () => {
    // Ночной кейс: в 00:45 МСК в UTC ещё вчера, и день брони уезжал на сутки
    // назад — вчерашняя дата оставалась выбираемой до 03:00. Днём разницы
    // между зонами не видно, поэтому граница проверяется именно ночью.
    expect(todayStr(new Date("2026-09-05T00:45:00+03:00"))).toBe("2026-09-05");
    expect(todayStr(new Date("2026-09-04T23:59:00+03:00"))).toBe("2026-09-04");
  });

  it("does not depend on the zone of the machine running it", () => {
    // Один и тот же инстант, записанный тремя способами: ответ обязан совпасть.
    expect(todayStr(new Date("2026-09-04T21:45:00Z"))).toBe("2026-09-05");
    expect(todayStr(new Date("2026-09-05T04:45:00+07:00"))).toBe("2026-09-05");
  });
});

describe("formatMonthYearGen", () => {
  it("puts the month into the genitive for «на сайте с …»", () => {
    expect(formatMonthYearGen(new Date(Date.UTC(2026, 7, 19)))).toBe("августа 2026");
    expect(formatMonthYearGen(new Date(Date.UTC(2024, 2, 1)))).toBe("марта 2024");
  });

  it("reads the month in the business zone", () => {
    // 31 августа 22:00 UTC = 1 сентября 01:00 МСК: регистрация в эту минуту
    // подписывалась как «на сайте с августа».
    expect(formatMonthYearGen(new Date(Date.UTC(2026, 7, 31, 22, 0)))).toBe("сентября 2026");
    expect(formatMonthYearGen(new Date(Date.UTC(2025, 11, 31, 22, 0)))).toBe("января 2026");
  });
});

/* Цифровой период для колонок: «8 сентября — 14 сентября» в парном виде не
 * влезает никуда. Ведущий ноль обязателен — в колонке даты выравниваются. */
describe("formatDayMonthNum", () => {
  it("день и месяц с ведущими нулями", () => {
    expect(formatDayMonthNum("2026-09-08")).toBe("08.09");
    expect(formatDayMonthNum("2026-12-31")).toBe("31.12");
    expect(formatDayMonthNum("2026-01-01")).toBe("01.01");
  });
});

/* Сколько осталось до протухания заявки. Функция не была покрыта ничем, хотя
 * от неё зависит единственный срочный сигнал в кабинете.
 *
 * Второй режим — «грубо» — появился для метки, стоящей вплотную к названию:
 * точность до минуты отнимала у названия ширину, а решение по ней всё равно
 * принимают по порядку величины. */
describe("formatTimeLeft", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 8, 11, 12, 0) + min * 60_000);
  const now = at(0);

  it("истёкшее не показывается вовсе", () => {
    expect(formatTimeLeft(at(0), now)).toBeNull();
    expect(formatTimeLeft(at(-5), now)).toBeNull();
  });

  it("меньше часа — в минутах", () => {
    expect(formatTimeLeft(at(45), now)).toBe("45 мин");
  });

  it("часы с минутами — подробно", () => {
    expect(formatTimeLeft(at(23 * 60 + 51), now)).toBe("23 ч 51 мин");
  });

  it("ровный час минут не дописывает", () => {
    expect(formatTimeLeft(at(180), now)).toBe("3 ч");
  });

  // Сутки и больше огрубляются всегда: в подробностях там смысла нет.
  it("сутки и больше — в днях, со склонением", () => {
    expect(formatTimeLeft(at(24 * 60), now)).toBe("1 день");
    expect(formatTimeLeft(at(50 * 60), now)).toBe("2 дня");
  });

  /* Грубый режим срезает младшую единицу. Без него метка у названия занимала
   * «23 ч 51 мин» вместо «23 ч» — почти вдвое шире, и название ломалось. */
  it("грубо: только старшая единица", () => {
    expect(formatTimeLeft(at(23 * 60 + 51), now, true)).toBe("23 ч");
    expect(formatTimeLeft(at(61), now, true)).toBe("1 ч");
  });

  // Минуты огрублять нечем — там старшая единица и есть минуты.
  it("грубо: меньше часа остаётся минутами", () => {
    expect(formatTimeLeft(at(45), now, true)).toBe("45 мин");
  });

  // Умолчание обязано совпадать с прежним поведением: режим добавлялся третьим
  // параметром, и все прежние вызывающие его не передают.
  it("без параметра ведёт себя как раньше", () => {
    expect(formatTimeLeft(at(23 * 60 + 51), now, false))
      .toBe(formatTimeLeft(at(23 * 60 + 51), now));
  });
});

/* Строгая проверка дня: регэкспа мало, а Date.parse молча переносит
 * 30 февраля на 2 марта. Обратный ход ловит такие дни. */
describe("isDateStr", () => {
  it("принимает существующий день", () => {
    expect(isDateStr("2026-10-03")).toBe(true);
    expect(isDateStr("2028-02-29")).toBe(true);
  });

  it("отвергает несуществующий день", () => {
    expect(isDateStr("2026-02-30")).toBe(false);
    expect(isDateStr("2027-02-29")).toBe(false);
    expect(isDateStr("2026-04-31")).toBe(false);
    expect(isDateStr("2026-13-01")).toBe(false);
    expect(isDateStr("2026-00-10")).toBe(false);
  });

  it("отвергает другой формат и не строки", () => {
    expect(isDateStr("2026-10-3")).toBe(false);
    expect(isDateStr("03.10.2026")).toBe(false);
    expect(isDateStr("2026-10-03T00:00:00Z")).toBe(false);
    expect(isDateStr("")).toBe(false);
    expect(isDateStr(undefined)).toBe(false);
    expect(isDateStr(20261003)).toBe(false);
  });
});

describe("weekdayShort", () => {
  it("день недели по календарному дню, без зоны", () => {
    expect(weekdayShort("2026-10-03")).toBe("сб");
    expect(weekdayShort("2026-10-05")).toBe("пн");
    expect(weekdayShort("2026-10-04")).toBe("вс");
  });
});

/* Подпись поля «Когда»: месяц один раз, если он общий. */
describe("dateRangeLabel", () => {
  it("один месяц — месяц справа", () => {
    expect(dateRangeLabel("2026-10-03", "2026-10-05")).toBe("сб 3 — пн 5 окт");
  });

  it("разные месяцы — у обеих границ", () => {
    expect(dateRangeLabel("2026-09-30", "2026-10-02")).toBe("ср 30 сен — пт 2 окт");
  });

  it("тот же месяц другого года — тоже у обеих границ", () => {
    expect(dateRangeLabel("2026-10-30", "2027-10-01")).toBe("пт 30 окт — пт 1 окт");
  });

  it("один день — без тире", () => {
    expect(dateRangeLabel("2026-10-03", "2026-10-03")).toBe("сб 3 окт");
  });
});

/* Обе границы включены: 3–5 октября — три дня аренды, а не две ночи. */
describe("daysLabel", () => {
  it("считает дни включительно и склоняет", () => {
    expect(daysLabel("2026-10-03", "2026-10-03")).toBe("1 день");
    expect(daysLabel("2026-10-03", "2026-10-05")).toBe("3 дня");
    expect(daysLabel("2026-10-03", "2026-10-07")).toBe("5 дней");
    expect(daysLabel("2026-10-03", "2026-10-23")).toBe("21 день");
    expect(daysLabel("2026-10-03", "2026-10-13")).toBe("11 дней");
  });

  it("переживает переход на другой год", () => {
    expect(rangeDaysCount("2026-12-30", "2027-01-02")).toBe(4);
  });
});

describe("shortRangeLabel", () => {
  it("writes the month once inside one month", () => {
    expect(shortRangeLabel("2026-10-10", "2026-10-12")).toBe("10–12 окт");
  });
  it("writes both months across a month boundary", () => {
    expect(shortRangeLabel("2026-09-30", "2026-10-02")).toBe("30 сен – 2 окт");
  });
  it("keeps the months apart across a year boundary", () => {
    expect(shortRangeLabel("2026-12-31", "2027-01-02")).toBe("31 дек – 2 янв");
  });
  it("gives a single day for a one-day range", () => {
    expect(shortRangeLabel("2026-10-10", "2026-10-10")).toBe("10 окт");
  });
});
