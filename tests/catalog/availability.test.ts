import { describe, it, expect } from "vitest";
import {
  assertDateString, eachDate, freeQty, canBook, applyBookingDelta, unavailableDates,
  type AvailabilityMap,
} from "@/lib/catalog/availability";

describe("eachDate()", () => {
  it("включает обе границы", () => {
    expect(eachDate("2026-07-20", "2026-07-22")).toEqual([
      "2026-07-20", "2026-07-21", "2026-07-22",
    ]);
  });

  it("один день = одна дата", () => {
    expect(eachDate("2026-07-20", "2026-07-20")).toEqual(["2026-07-20"]);
  });

  it("переживает границу месяца и года", () => {
    expect(eachDate("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02",
    ]);
  });

  it("бросает на инвертированном диапазоне", () => {
    expect(() => eachDate("2026-07-22", "2026-07-20")).toThrow("date_range_inverted");
  });

  it("бросает на мусорной дате", () => {
    expect(() => eachDate("2026-13-40", "2026-07-20")).toThrow(/invalid date/);
    expect(() => eachDate("garbage", "2026-07-20")).toThrow(/invalid date/);
  });
});

// Разбор дня стал строже: Date.parse переносил несуществующий день на
// следующий месяц, и бронь на «30 февраля» уходила на 2 марта.
describe("assertDateString()", () => {
  it("пропускает существующий день", () => {
    expect(() => assertDateString("2026-02-28")).not.toThrow();
    expect(() => assertDateString("2028-02-29")).not.toThrow();
  });

  it("бросает на несуществующем дне", () => {
    expect(() => assertDateString("2026-02-30")).toThrow(/invalid date/);
    expect(() => assertDateString("2027-02-29")).toThrow(/invalid date/);
    expect(() => assertDateString("2026-06-31")).toThrow(/invalid date/);
  });

  it("eachDate не перескакивает через несуществующий день в март", () => {
    expect(() => eachDate("2026-02-27", "2026-02-30")).toThrow(/invalid date/);
  });
});

describe("freeQty()", () => {
  it("без строки availability день полностью свободен", () => {
    expect(freeQty(3, undefined)).toBe(3);
  });

  it("вычитает booked и blocked", () => {
    expect(freeQty(3, { bookedQty: 1, blockedQty: 1 })).toBe(1);
  });

  it("не уходит ниже нуля при переброни", () => {
    expect(freeQty(1, { bookedQty: 2, blockedQty: 0 })).toBe(0);
  });
});

describe("canBook()", () => {
  const map: AvailabilityMap = new Map([
    ["2026-07-21", { bookedQty: 2, blockedQty: 0 }],
    ["2026-07-22", { bookedQty: 0, blockedQty: 3 }],
  ]);

  it("true, когда qty влезает во все дни диапазона", () => {
    expect(canBook(3, map, "2026-07-20", "2026-07-21", 1)).toBe(true);
  });

  it("false, если хотя бы один день диапазона занят", () => {
    // 2026-07-22: всё заблокировано вручную
    expect(canBook(3, map, "2026-07-20", "2026-07-22", 1)).toBe(false);
  });

  it("false для qty больше свободного остатка", () => {
    expect(canBook(3, map, "2026-07-21", "2026-07-21", 2)).toBe(false);
  });

  it("false для qty < 1", () => {
    expect(canBook(3, map, "2026-07-20", "2026-07-20", 0)).toBe(false);
  });
});

describe("unavailableDates()", () => {
  const map: AvailabilityMap = new Map([
    ["2026-07-17", { bookedQty: 1, blockedQty: 0 }], // занята единственная единица
    ["2026-07-18", { bookedQty: 1, blockedQty: 0 }],
    ["2026-07-19", { bookedQty: 1, blockedQty: 0 }],
  ]);

  it("возвращает занятые дни диапазона", () => {
    expect(unavailableDates(1, map, "2026-07-16", "2026-07-20", 1)).toEqual([
      "2026-07-17", "2026-07-18", "2026-07-19",
    ]);
  });

  it("пустой массив, когда всё свободно", () => {
    expect(unavailableDates(1, map, "2026-07-21", "2026-07-25", 1)).toEqual([]);
  });

  it("учитывает qty: две единицы при quantity=2 и одной занятой не влезают", () => {
    expect(unavailableDates(2, map, "2026-07-17", "2026-07-17", 2)).toEqual(["2026-07-17"]);
    expect(unavailableDates(2, map, "2026-07-17", "2026-07-17", 1)).toEqual([]);
  });
});

describe("applyBookingDelta()", () => {
  it("подтверждение занимает каждый день диапазона", () => {
    const next = applyBookingDelta(new Map(), "2026-07-20", "2026-07-21", 2);
    expect(next.get("2026-07-20")).toEqual({ bookedQty: 2, blockedQty: 0 });
    expect(next.get("2026-07-21")).toEqual({ bookedQty: 2, blockedQty: 0 });
  });

  it("освобождение возвращает единицы и не трогает blocked", () => {
    const map: AvailabilityMap = new Map([
      ["2026-07-20", { bookedQty: 2, blockedQty: 1 }],
    ]);
    const next = applyBookingDelta(map, "2026-07-20", "2026-07-20", -2);
    expect(next.get("2026-07-20")).toEqual({ bookedQty: 0, blockedQty: 1 });
  });

  it("bookedQty не уходит ниже нуля при двойном release", () => {
    const map: AvailabilityMap = new Map([
      ["2026-07-20", { bookedQty: 1, blockedQty: 0 }],
    ]);
    const once = applyBookingDelta(map, "2026-07-20", "2026-07-20", -1);
    const twice = applyBookingDelta(once, "2026-07-20", "2026-07-20", -1);
    expect(twice.get("2026-07-20")!.bookedQty).toBe(0);
  });

  it("не мутирует входную карту", () => {
    const map: AvailabilityMap = new Map([
      ["2026-07-20", { bookedQty: 0, blockedQty: 0 }],
    ]);
    applyBookingDelta(map, "2026-07-20", "2026-07-20", 1);
    expect(map.get("2026-07-20")).toEqual({ bookedQty: 0, blockedQty: 0 });
  });
});
