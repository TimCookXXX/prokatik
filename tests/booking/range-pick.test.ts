import { describe, it, expect } from "vitest";
import { pickRange } from "@/lib/booking/range-pick";

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
