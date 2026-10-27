import { describe, expect, it } from "vitest";
import { applyPhoneEdit, formatPhoneInput, isCompletePhone, nationalDigits } from "@/lib/booking/phone-mask";
import { normalizePhone } from "@/lib/booking/validation";

/** Набор по одному символу в конец, как с клавиатуры. */
function type(keys: string): string {
  let value = "";
  for (const ch of keys) value = applyPhoneEdit(value, value + ch, value.length + 1).value;
  return value;
}

describe("formatPhoneInput", () => {
  it("набор по цифре: без висящих разделителей", () => {
    expect(type("8")).toBe("+7");
    expect(type("89")).toBe("+7 (9");
    expect(type("8900")).toBe("+7 (900");
    expect(type("89001")).toBe("+7 (900) 1");
    expect(type("8900123")).toBe("+7 (900) 123");
    expect(type("89001234")).toBe("+7 (900) 123-4");
    expect(type("8900123456")).toBe("+7 (900) 123-45-6");
    expect(type("89001234567")).toBe("+7 (900) 123-45-67");
  });

  it("начать можно с 8, 7, +7, + или сразу с 9", () => {
    expect(type("79001234567")).toBe("+7 (900) 123-45-67");
    expect(type("+79001234567")).toBe("+7 (900) 123-45-67");
    expect(type("9001234567")).toBe("+7 (900) 123-45-67");
    expect(type("+")).toBe("+");
    expect(type("+7")).toBe("+7");
  });

  it("вставка и автозаполнение в любом виде", () => {
    for (const raw of ["+7 900 123-45-67", "89001234567", "9001234567", "8 (900) 123 45 67", "+7 900‑123‑45‑67"]) {
      expect(formatPhoneInput(raw)).toBe("+7 (900) 123-45-67");
    }
  });

  it("городские и 8-800: код страны отрезается один раз", () => {
    expect(formatPhoneInput("8 (861) 123-45-67")).toBe("+7 (861) 123-45-67");
    expect(formatPhoneInput("88005553535")).toBe("+7 (800) 555-35-35");
    expect(formatPhoneInput("8005553535")).toBe("+7 (800) 555-35-35");
    // Повторный разбор отформатированного не съедает ведущие 7/8 номера.
    expect(formatPhoneInput("+7 (800) 555-35-35")).toBe("+7 (800) 555-35-35");
    expect(formatPhoneInput("+7 (777) 123-45-67")).toBe("+7 (777) 123-45-67");
  });

  it("лишние цифры не вводятся", () => {
    expect(type("890012345678")).toBe("+7 (900) 123-45-67");
  });

  it("«+8 900…» — опечатка вместо 8: тоже +7", () => {
    expect(formatPhoneInput("+8 900 123-45-67")).toBe("+7 (900) 123-45-67");
    expect(type("+89001234567")).toBe("+7 (900) 123-45-67");
  });

  it("номер с 8 в коде города набирается: 8, затем 800…", () => {
    expect(type("88005553535")).toBe("+7 (800) 555-35-35");
    expect(type("8800")).toBe("+7 (800");
  });

  it("пусто — пусто; иностранный номер маска не трогает, и он не полный", () => {
    expect(formatPhoneInput("")).toBe("");
    expect(formatPhoneInput("+375 29 123 45 67")).toBe("+375 29 123 45 67");
    expect(nationalDigits("+375 29 123 45 67")).toBeNull();
    expect(isCompletePhone("+375 29 123 45 67")).toBe(false);
  });

  it("полный номер — 10 национальных цифр; сервер нормализует его к +7", () => {
    expect(isCompletePhone("+7 (900) 123-45-6")).toBe(false);
    expect(isCompletePhone("+7 (900) 123-45-67")).toBe(true);
    expect(normalizePhone("+7 (900) 123-45-67")).toBe("+79001234567");
  });
});

describe("applyPhoneEdit", () => {
  const full = "+7 (900) 123-45-67";

  it("Backspace в конце стирает цифру", () => {
    expect(applyPhoneEdit(full, full.slice(0, -1), full.length - 1)).toEqual({ value: "+7 (900) 123-45-6", caret: 17 });
    // После «+7 (900) 1» стёрли «1» — разделитель «) » не остаётся висеть.
    expect(applyPhoneEdit("+7 (900) 1", "+7 (900) ", 9).value).toBe("+7 (900");
  });

  it("Backspace по разделителю в середине уносит цифру слева", () => {
    // Каретка после «-» между 123 и 45 (позиция 13), стёрли сам «-».
    const raw = full.slice(0, 12) + full.slice(13);
    expect(applyPhoneEdit(full, raw, 12, "deleteContentBackward")).toEqual({ value: "+7 (900) 124-56-7", caret: 11 });
  });

  it("Delete по разделителю в середине уносит цифру справа", () => {
    const raw = full.slice(0, 12) + full.slice(13);
    const r = applyPhoneEdit(full, raw, 12, "deleteContentForward");
    expect(r.value).toBe("+7 (900) 123-56-7");
    expect(r.value.slice(0, r.caret)).toBe("+7 (900) 123-");
  });

  it("цифра, вставленная в середину, оставляет каретку сразу за собой", () => {
    // «+7 (900) 1|23-45-6» → вписали 9 после «1».
    const prev = "+7 (900) 123-45-6";
    const raw = prev.slice(0, 10) + "9" + prev.slice(10);
    const r = applyPhoneEdit(prev, raw, 11);
    expect(r.value).toBe("+7 (900) 192-34-56");
    expect(r.value.slice(0, r.caret)).toBe("+7 (900) 19");
  });

  it("стёртая в середине цифра — каретка остаётся на месте", () => {
    // «+7 (900) 12|3-45-67» → Backspace по «2».
    const raw = full.slice(0, 10) + full.slice(11);
    const r = applyPhoneEdit(full, raw, 10);
    expect(r.value).toBe("+7 (900) 134-56-7");
    expect(r.value.slice(0, r.caret)).toBe("+7 (900) 1");
  });

  it("вставка десяти цифр без кода — каретка в конце", () => {
    expect(applyPhoneEdit("", "9001234567", 10)).toEqual({ value: full, caret: full.length });
  });

  it("вставка того же номера поверх в другом виде не теряет цифр", () => {
    for (const pasted of ["+79001234567", "+7 900 1234567", "89001234567", "9001234567"]) {
      expect(applyPhoneEdit(full, pasted, pasted.length).value).toBe(full);
    }
  });

  it("вставка номера с кодом в «+7» и в «+» — номер целиком, без склейки", () => {
    expect(applyPhoneEdit("+7", "+789001234567", 13).value).toBe(full);
    expect(applyPhoneEdit("+7", "+7+7 900 123-45-67", 18).value).toBe(full);
    expect(applyPhoneEdit("+", "+89001234567", 12).value).toBe(full);
    expect(applyPhoneEdit("+", "+9001234567", 11).value).toBe(full);
  });

  it("код страны не стирается, пока в номере есть цифры", () => {
    const prev = "+7 (900) 123";
    // Backspace после «+7 (», после «+7 » и после «+7».
    expect(applyPhoneEdit(prev, "+7 900) 123", 3, "deleteContentBackward").value).toBe(prev);
    expect(applyPhoneEdit(prev, "+7(900) 123", 2, "deleteContentBackward").value).toBe(prev);
    expect(applyPhoneEdit(prev, "+ (900) 123", 1, "deleteContentBackward").value).toBe(prev);
    // Без цифр номера код стирается как обычно.
    expect(applyPhoneEdit("+7", "+", 1, "deleteContentBackward").value).toBe("+");
    expect(applyPhoneEdit("+", "", 0, "deleteContentBackward").value).toBe("");
  });

  it("нецифра в середине — значение то же, каретка на месте правки", () => {
    const r = applyPhoneEdit(full, "+7 (900) 12 3-45-67", 12);
    expect(r).toEqual({ value: full, caret: 11 });
  });

  it("иностранный номер: стёртый разделитель цифр не уносит", () => {
    expect(applyPhoneEdit("+375 29", "+37529", 4, "deleteContentBackward")).toEqual({ value: "+37529", caret: 4 });
  });
});
