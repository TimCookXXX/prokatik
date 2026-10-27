import { describe, it, expect } from "vitest";
import { bookingFormSchema, bookingSelectionSchema, normalizePhone } from "@/lib/booking/validation";

describe("normalizePhone()", () => {
  it("нормализует российские форматы к +7", () => {
    expect(normalizePhone("+7 900 111-22-33")).toBe("+79001112233");
    expect(normalizePhone("8 (900) 111 22 33")).toBe("+79001112233");
    expect(normalizePhone("79001112233")).toBe("+79001112233");
  });

  it("иностранные номера сохраняются как есть с +", () => {
    expect(normalizePhone("+375 29 123 45 67")).toBe("+375291234567");
  });

  it("мусор и короткие номера — пустая строка", () => {
    expect(normalizePhone("нет")).toBe("");
    expect(normalizePhone("12345")).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("bookingFormSchema", () => {
  const valid = {
    listingId: "01ABC",
    from: "2026-07-20",
    to: "2026-07-22",
    qty: "2",
    priceDay: "500",
    phone: "8 900 111-22-33",
    comment: "  Привезите к подъезду  ",
  };

  it("парсит валидную форму, нормализует телефон и trim'ит комментарий", () => {
    const r = bookingFormSchema.parse(valid);
    expect(r.phone).toBe("+79001112233");
    expect(r.qty).toBe(2);
    expect(r.comment).toBe("Привезите к подъезду");
    expect(r.website).toBe("");
  });

  it("отклоняет пустой/мусорный телефон", () => {
    expect(bookingFormSchema.safeParse({ ...valid, phone: "" }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, phone: "позвоните" }).success).toBe(false);
  });

  /* Цена ездит с формой, чтобы поймать её сдвиг. Но НЕобязательна: страница,
   * открытая до выкладки этого поля, шлёт форму без него, и обязательное поле
   * рвало бы бронь всем, кто не перезагрузился. Это не гипотеза — ровно так и
   * сломалось на первой же живой заявке. */
  it("форма без цены остаётся валидной — старая вкладка не должна ломаться", () => {
    const { priceDay: _drop, ...without } = valid;
    const r = bookingFormSchema.safeParse(without);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.priceDay).toBeUndefined();
  });

  // А присланный мусор проезжать не должен: сверка сравнивает числа.
  it("отклоняет мусорную цену", () => {
    expect(bookingFormSchema.safeParse({ ...valid, priceDay: "0" }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, priceDay: "-100" }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, priceDay: "дорого" }).success).toBe(false);
  });

  it("отклоняет кривые даты и qty", () => {
    expect(bookingFormSchema.safeParse({ ...valid, from: "20.07.2026" }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, qty: "0" }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...valid, qty: "1.5" }).success).toBe(false);
  });

  it("комментарий длиннее 500 — отказ", () => {
    expect(bookingFormSchema.safeParse({ ...valid, comment: "x".repeat(501) }).success).toBe(false);
  });
});

describe("bookingSelectionSchema", () => {
  it("выбор без телефона и комментария; лишние поля отбрасываются", () => {
    const r = bookingSelectionSchema.parse({
      listingId: "01ABC", from: "2026-07-20", to: "2026-07-22", qty: "1", priceDay: "500", priceWeek: "", phone: "x",
    });
    expect(r).toEqual({ listingId: "01ABC", from: "2026-07-20", to: "2026-07-22", qty: 1, priceDay: 500, priceWeek: null });
  });

  it("форма заявки — его расширение: те же поля выбора плюс телефон", () => {
    const selectionKeys = Object.keys(bookingSelectionSchema.shape);
    expect(Object.keys(bookingFormSchema.shape)).toEqual(expect.arrayContaining(selectionKeys));
    expect(bookingSelectionSchema.safeParse({ listingId: "x", from: "2026-07-20", to: "bad", qty: 1 }).success).toBe(false);
  });
});
