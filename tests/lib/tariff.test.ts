import { describe, it, expect } from "vitest";
import {
  effectiveDayPrice, formatUnitPrice, formatUnitPriceSlash, minDaysLabel, minDaysShort,
  priceSummary, primaryPrice, priceTiers, quote, requiredMinDays,
} from "@/lib/catalog/tariff";

const flat = (s: string) => s.replace(/[  ]/g, " ");
const t = (priceDay: number | null, priceWeek: number | null = null, priceMonth: number | null = null) =>
  ({ priceDay, priceWeek, priceMonth });

describe("primaryPrice и priceTiers", () => {
  it("сутки, если есть, иначе неделя, иначе месяц", () => {
    expect(primaryPrice(t(500, 2250, 7000))).toEqual({ amount: 500, unit: "day" });
    expect(primaryPrice(t(null, 2250, 7000))).toEqual({ amount: 2250, unit: "week" });
    expect(primaryPrice(t(null, null, 7000))).toEqual({ amount: 7000, unit: "month" });
    expect(primaryPrice(t(null))).toBeNull();
  });

  it("плитки — заданные цены по возрастанию срока", () => {
    expect(priceTiers(t(500, null, 7000)).map((p) => p.unit)).toEqual(["day", "month"]);
  });

  it("форматы с единицей", () => {
    expect(flat(formatUnitPrice({ amount: 2250, unit: "week" }))).toBe("2 250 ₽ в неделю");
    expect(flat(formatUnitPriceSlash({ amount: 500, unit: "day" }))).toBe("500 ₽/сутки");
    expect(flat(formatUnitPriceSlash({ amount: 7000, unit: "month" }))).toBe("7 000 ₽/месяц");
  });
});

describe("effectiveDayPrice", () => {
  it("суточная как есть, неделя и месяц — доля на день с округлением вверх", () => {
    expect(effectiveDayPrice(t(500, 2250))).toBe(500);
    expect(effectiveDayPrice(t(null, 2250))).toBe(322);
    expect(effectiveDayPrice(t(null, null, 7000))).toBe(234);
  });
});

describe("requiredMinDays", () => {
  it("без суточной — неделя, без суточной и недельной — месяц", () => {
    expect(requiredMinDays(t(500))).toBe(1);
    expect(requiredMinDays(t(null, 2250))).toBe(7);
    expect(requiredMinDays(t(null, null, 7000))).toBe(30);
  });
});

describe("quote", () => {
  it("посуточно — цена × дни × количество", () => {
    expect(quote(t(500), 3, 2)).toEqual({ ok: true, total: 3000, unit: "day", rate: 500, capped: false });
  });

  it("от 7 дней — недельная доля, от 30 — месячная", () => {
    // 2250 × 10 / 7 = 3214,28… — округление одно, на сумму.
    expect(quote(t(500, 2250), 10)).toMatchObject({ ok: true, total: 3214, unit: "week" });
    expect(quote(t(500, 2250, 7000), 31)).toMatchObject({ ok: true, total: 7233, unit: "month" });
    expect(quote(t(500, 2250, 7000), 7)).toMatchObject({ total: 2250, unit: "week", capped: false });
  });

  it("без скачков вниз: короче ступени не дороже её цены", () => {
    // 6 суток по 500 = 3000 > недели 2250.
    expect(quote(t(500, 2250), 6)).toEqual({ ok: true, total: 2250, unit: "week", rate: 2250, capped: true });
    // 29 дней по недельной доле = 9321 > месяца 7000.
    expect(quote(t(500, 2250, 7000), 29)).toMatchObject({ total: 7000, unit: "month", capped: true });
    // Ниже порога — обычная сумма.
    expect(quote(t(500, 2250), 4)).toMatchObject({ total: 2000, capped: false });
  });

  it("округление до количества: × qty после рубля", () => {
    expect(quote(t(null, 2250), 10, 3)).toMatchObject({ total: 3214 * 3 });
  });

  it("срок короче минимального — отказ с минимумом", () => {
    expect(quote({ ...t(null, 2250), minDays: 7 }, 3)).toEqual({ ok: false, error: "min_days", minDays: 7 });
    expect(quote({ ...t(null, 2250), minDays: 7 }, 7)).toMatchObject({ ok: true, total: 2250 });
  });

  it("без минимума в снимке короткий срок считается долей самой короткой ступени", () => {
    expect(quote(t(null, 2100), 3)).toMatchObject({ ok: true, total: 900, unit: "week" });
  });

  it("без цен и без дней суммы нет", () => {
    expect(quote(t(null), 3)).toEqual({ ok: false, error: "no_price" });
    expect(quote(t(500), 0)).toEqual({ ok: false, error: "no_price" });
  });
});

describe("подписи срока", () => {
  it("«от N дней» в родительном падеже", () => {
    expect(minDaysLabel(7)).toBe("от 7 дней");
    expect(minDaysLabel(3)).toBe("от 3 дней");
    expect(minDaysLabel(21)).toBe("от 21 дня");
    expect(minDaysLabel(30)).toBe("от 30 дней");
    expect(minDaysShort(7)).toBe("от 7 дн.");
  });
});

describe("priceSummary", () => {
  const none = { dayMin: null, dayMax: null, weekMin: null, weekMax: null, monthMin: null, monthMax: null };
  it("суточные важнее: недельные без суточной в заголовок не идут", () => {
    expect(priceSummary({ ...none, dayMin: 300, dayMax: 900, weekMin: 2250, weekMax: 2250 }))
      .toEqual({ unit: "day", min: 300, max: 900 });
  });
  it("без суточных — неделя, без недельных — месяц, без цен — null", () => {
    expect(priceSummary({ ...none, weekMin: 2000, weekMax: 2500 })).toEqual({ unit: "week", min: 2000, max: 2500 });
    expect(priceSummary({ ...none, monthMin: 7000, monthMax: 7000 })).toEqual({ unit: "month", min: 7000, max: 7000 });
    expect(priceSummary(none)).toBeNull();
  });
});
