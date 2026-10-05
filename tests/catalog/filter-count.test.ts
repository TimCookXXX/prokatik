import { describe, it, expect } from "vitest";
import { activeFilterCount } from "@/lib/catalog/filter-count";

describe("activeFilterCount", () => {
  it("без фильтров — ноль", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ deposit: "", handover: "", verifiedOnly: false })).toBe(0);
  });

  // Слайдер один, и чип не должен говорить «2», когда человек тронул одну ручку.
  it("цена — одно условие, сколько бы границ ни было задано", () => {
    expect(activeFilterCount({ priceMin: 100 })).toBe(1);
    expect(activeFilterCount({ priceMax: 900 })).toBe(1);
    expect(activeFilterCount({ priceMin: 100, priceMax: 900 })).toBe(1);
  });

  // Нулевая граница — тоже заданная: «от 0» пришло из адреса.
  it("нулевая граница цены считается", () => {
    expect(activeFilterCount({ priceMin: 0 })).toBe(1);
  });

  it("каждое условие панели — по единице", () => {
    expect(activeFilterCount({ deposit: "money" })).toBe(1);
    expect(activeFilterCount({ handover: "pickup" })).toBe(1);
    expect(activeFilterCount({ verifiedOnly: true })).toBe(1);
    expect(activeFilterCount({
      priceMin: 100, priceMax: 900, deposit: "none", handover: "delivery", verifiedOnly: true,
    })).toBe(4);
  });

  // У сортировки свой чип в ленте: в число фильтров она не входит.
  it("сортировку не считает", () => {
    expect(activeFilterCount({ sort: "price_asc" } as Parameters<typeof activeFilterCount>[0])).toBe(0);
  });

  // Граница на краю раздела ничего не отсекает: такой адрес оставляют старые
  // ссылки и форма без JS, и чип не должен считать её фильтром.
  describe("с границами раздела", () => {
    const bounds = { min: 100, max: 900 };

    it("цена на краях или шире — не фильтр", () => {
      expect(activeFilterCount({ priceMin: 100, priceMax: 900, deposit: "none" }, bounds)).toBe(1);
      expect(activeFilterCount({ priceMin: 50, priceMax: 1000 }, bounds)).toBe(0);
      expect(activeFilterCount({ priceMin: 0 }, bounds)).toBe(0);
    });

    it("цена, сужающая раздел, — одно условие", () => {
      expect(activeFilterCount({ priceMin: 101 }, bounds)).toBe(1);
      expect(activeFilterCount({ priceMax: 899 }, bounds)).toBe(1);
      expect(activeFilterCount({ priceMin: 200, priceMax: 800 }, bounds)).toBe(1);
      expect(activeFilterCount({ priceMin: 100, priceMax: 800 }, bounds)).toBe(1);
    });
  });
});
