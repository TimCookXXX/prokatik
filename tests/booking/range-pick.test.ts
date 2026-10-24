import { describe, it, expect } from "vitest";
import { extendToMin, isTooShortEnd, latestStart, pickRange } from "@/lib/booking/range-pick";

// Перенос сценария выбора дат из сравнения прокатов под семантику inrenta:
// обе границы включены, длина не ограничена (границу задаёт горизонт
// календаря), пустая строка — то же, что «не выбрано» (так хранит виджет брони).
describe("pickRange", () => {
  it("first click picks one day, second closes the range in either order", () => {
    const one = pickRange({ from: null, to: null }, "2026-09-26");
    expect(one).toEqual({ from: "2026-09-26", to: null });
    expect(pickRange(one, "2026-09-28")).toEqual({ from: "2026-09-26", to: "2026-09-28" });
    expect(pickRange(one, "2026-09-24")).toEqual({ from: "2026-09-24", to: "2026-09-26" });
  });

  it("a second click on the same day is a one-day rental", () => {
    expect(pickRange({ from: "2026-09-26", to: null }, "2026-09-26"))
      .toEqual({ from: "2026-09-26", to: "2026-09-26" });
  });

  it("a click on a finished range starts over; the range is not capped", () => {
    expect(pickRange({ from: "2026-09-24", to: "2026-09-25" }, "2026-09-26")).toEqual({ from: "2026-09-26", to: null });
    expect(pickRange({ from: "2026-09-24", to: null }, "2027-03-20")).toEqual({ from: "2026-09-24", to: "2027-03-20" });
  });

  it("treats empty strings as nothing picked", () => {
    expect(pickRange({ from: "", to: "" }, "2026-09-26")).toEqual({ from: "2026-09-26", to: null });
    expect(pickRange({ from: "2026-09-26", to: "" }, "2026-09-28")).toEqual({ from: "2026-09-26", to: "2026-09-28" });
  });
});

describe("минимальный срок", () => {
  it("короткий замкнутый диапазон растягивается вперёд до минимума", () => {
    expect(extendToMin({ from: "2026-09-12", to: "2026-09-14" }, 7, "2027-03-01"))
      .toEqual({ from: "2026-09-12", to: "2026-09-18", extended: true });
  });

  it("ровно минимум и длиннее не трогаются, незамкнутый — тоже", () => {
    expect(extendToMin({ from: "2026-09-12", to: "2026-09-18" }, 7, "2027-03-01").extended).toBe(false);
    expect(extendToMin({ from: "2026-09-12", to: null }, 7, "2027-03-01"))
      .toEqual({ from: "2026-09-12", to: null, extended: false });
    expect(extendToMin({ from: "2026-09-12", to: "2026-09-12" }, 1, "2027-03-01").extended).toBe(false);
  });

  it("растяжение упирается в горизонт", () => {
    expect(extendToMin({ from: "2026-09-27", to: "2026-09-28" }, 7, "2026-09-30").to).toBe("2026-09-30");
  });

  it("последний возможный старт и дни короче минимума", () => {
    expect(latestStart("2026-09-30", 7)).toBe("2026-09-24");
    expect(latestStart("2026-09-30", 1)).toBe("2026-09-30");
    expect(isTooShortEnd("2026-09-12", "2026-09-17", 7)).toBe(true);
    expect(isTooShortEnd("2026-09-12", "2026-09-18", 7)).toBe(false);
    expect(isTooShortEnd("2026-09-12", "2026-09-10", 7)).toBe(false);
  });
});
