import { describe, it, expect } from "vitest";
import {
  isSystemKind, requestNoteRows, systemMessageLine, systemMessageText,
  CHAT_SYSTEM_KINDS, type ChatSystemMeta,
} from "@/lib/chat/system-message";

// Неразрывные пробелы внутри дат сравнивать неудобно — нормализуем.
const flat = (s: string) => s.replace(/ /g, " ");

describe("isSystemKind", () => {
  it("реплика человека системной не считается", () => {
    expect(isSystemKind("user")).toBe(false);
  });

  it("все виды записей опознаются", () => {
    for (const kind of CHAT_SYSTEM_KINDS) expect(isSystemKind(kind)).toBe(true);
  });

  it("незнакомый вид системным не становится", () => {
    expect(isSystemKind("request_expired")).toBe(false);
  });
});

describe("systemMessageText", () => {
  const meta = { requestId: "01REQ", from: "2026-09-12", to: "2026-09-14", qty: 1 };

  it("даёт заголовок и период", () => {
    const r = systemMessageText("request_created", meta);
    expect(r.title).toBe("Заявка на бронь");
    expect(flat(r.detail ?? "")).toBe("12 сентября — 14 сентября");
  });

  it("один день не превращается в диапазон", () => {
    const r = systemMessageText("request_confirmed", { ...meta, from: "2026-09-12", to: "2026-09-12" });
    expect(flat(r.detail ?? "")).toBe("12 сентября");
  });

  it("количество показывается только когда его больше одного", () => {
    expect(flat(systemMessageText("request_created", { ...meta, qty: 3 }).detail ?? ""))
      .toContain("3 шт.");
    expect(systemMessageText("request_created", meta).detail).not.toContain("шт.");
  });

  /* Заявка живёт дольше своих данных: meta у старых записей может не быть, а
   * лента обязана дочитаться, а не упасть. */
  it("без meta остаётся один заголовок", () => {
    expect(systemMessageText("request_declined", null)).toEqual({
      title: "Заявка отклонена", detail: null, comment: null,
    });
    expect(systemMessageText("request_declined", { requestId: "01REQ" }).detail).toBeNull();
  });

  it("у каждого вида есть свой текст", () => {
    const titles = CHAT_SYSTEM_KINDS.map((k) => systemMessageText(k, null).title);
    expect(new Set(titles).size).toBe(CHAT_SYSTEM_KINDS.length);
    expect(titles.every(Boolean)).toBe(true);
  });
});

describe("systemMessageLine", () => {
  it("собирает превью одной строкой", () => {
    expect(flat(systemMessageLine("request_confirmed", { from: "2026-09-12", to: "2026-09-14" })))
      .toBe("Заявка подтверждена: 12 сентября — 14 сентября");
  });

  it("без периода — только заголовок, без двоеточия в пустоту", () => {
    expect(systemMessageLine("request_cancelled", null)).toBe("Бронь отменена");
  });
});

/* Комментарий клиента живёт в meta записи и показывается в переписке. В базе
 * он копия колонки заявки: колонку читает шторка в момент решения, эту —
 * тред. Записан один раз, одной транзакцией — разъехаться им негде. */
describe("systemMessageText: комментарий", () => {
  const meta = { requestId: "01REQ", from: "2026-09-12", to: "2026-09-14" };

  it("отдаётся отдельно от заголовка и периода", () => {
    const r = systemMessageText("request_created", { ...meta, comment: "Нужен к 9 утра" });
    expect(r.title).toBe("Заявка на бронь");
    expect(r.comment).toBe("Нужен к 9 утра");
  });

  it("пустой и пробельный комментарий — это его отсутствие", () => {
    expect(systemMessageText("request_created", { ...meta, comment: "" }).comment).toBeNull();
    expect(systemMessageText("request_created", { ...meta, comment: "   " }).comment).toBeNull();
    expect(systemMessageText("request_created", meta).comment).toBeNull();
  });

  // Записи старше этого изменения комментария не имеют — лента обязана их
  // дочитывать, а не падать.
  it("запись без комментария читается как раньше", () => {
    const r = systemMessageText("request_confirmed", meta);
    expect(r.comment).toBeNull();
    expect(flat(r.detail ?? "")).toBe("12 сентября — 14 сентября");
  });

  // Превью в списке переписок остаётся стабильным: комментарий бывает длинным,
  // и строка списка прыгала бы от заявки к заявке.
  it("в превью комментарий не попадает", () => {
    expect(systemMessageLine("request_created", { ...meta, comment: "Нужен к 9 утра" }))
      .not.toContain("9 утра");
  });
});

/* Строки карточки заявки. Порядок фиксируется намеренно: он и есть ответ на
 * вопрос «что человек прочитает первым», а перестановка строк местами —
 * молчаливое изменение смысла экрана.
 *
 * Условия сделки лежат в meta копией с колонок заявки: владелец меняет цену
 * когда захочет, а журнал на то и журнал, чтобы не переписываться задним
 * числом. Всё необязательно — meta приезжает из jsonb непроверенным кастом. */
describe("requestNoteRows", () => {
  const full: ChatSystemMeta = {
    requestId: "01R",
    from: "2026-09-12", to: "2026-09-14", qty: 2,
    priceDay: 500, depositType: "money", depositAmount: 2000,
  };
  const terms = (m: ChatSystemMeta | null) => requestNoteRows(m).map((r) => r.term);
  const value = (m: ChatSystemMeta | null, term: string) =>
    flat(requestNoteRows(m).find((r) => r.term === term)?.value ?? "");

  // Сумма — той же лестницей тарифов, что в шторке: 12–21 сентября — десять
  // суток по недельной доле, а у записи без суточной — только по неделе.
  it("стоимость по тарифам из снимка", () => {
    const long = { from: "2026-09-12", to: "2026-09-21", priceDay: 500, priceWeek: 1400 };
    expect(value(long, "Стоимость")).toBe("≈ 2 000 ₽");
    const weekOnly = { from: "2026-09-12", to: "2026-09-18", priceWeek: 2250 };
    expect(value(weekOnly, "Стоимость")).toBe("≈ 2 250 ₽");
  });

  it("полная запись даёт все четыре строки в заданном порядке", () => {
    expect(terms(full)).toEqual(["Даты", "Сколько", "Стоимость", "Залог"]);
  });

  /* Цифрами, а не словами: строка стоит в колонке рядом с подписью, и
   * «12 сентября — 14 сентября · 3 дня» переносится с висячим разделителем.
   * Диапазон включает обе границы: 12–14 сентября — трое суток. */
  it("даты цифрами, сутки — по включительным границам", () => {
    expect(value(full, "Даты")).toBe("12.09 — 14.09 · 3 дня");
  });

  // А плашка решений остаётся на словах: там строка одна и во всю ширину.
  it("плашку решения на цифры не переводит", () => {
    const detail = flat(systemMessageText("request_confirmed", full).detail ?? "");
    expect(detail).toContain("12 сентября — 14 сентября");
    expect(detail).not.toContain("12.09");
  });

  it("сумма считается по цене из записи, а не по сегодняшней цене вещи", () => {
    expect(value(full, "Стоимость")).toBe("≈ 3 000 ₽"); // 500 × 3 дня × 2 шт.
  });

  it("залог берётся оттуда же", () => {
    expect(value(full, "Залог")).toBe("2 000 ₽");
    expect(value({ ...full, depositType: "none", depositAmount: undefined }, "Залог"))
      .toBe("Не нужен");
  });

  // Единица — умолчание, а не ответ: строка «1 шт.» только занимала бы место.
  it("количество показывает только когда его больше одного", () => {
    expect(terms({ ...full, qty: 1 })).not.toContain("Сколько");
  });

  /* Записи, сделанные до появления снимка условий, обязаны дочитаться. Это не
   * гипотеза: такие строки есть в любой базе, пережившей выкладку. */
  it("старая запись без цены и залога читается без них", () => {
    const old: ChatSystemMeta = { requestId: "01R", from: "2026-09-12", to: "2026-09-14", qty: 2 };
    expect(terms(old)).toEqual(["Даты", "Сколько"]);
  });

  /* Главная ловушка: qty необязательно, и `priceDay * days * qty` без него дал
   * бы «≈ NaN ₽» прямо в ленте. Умолчание — одна единица. */
  it("без количества сумма считается на одну единицу, а не рушится в NaN", () => {
    const v = value({ from: "2026-09-12", to: "2026-09-14", priceDay: 500 }, "Стоимость");
    expect(v).toBe("≈ 1 500 ₽");
    expect(v).not.toContain("NaN");
  });

  /* Тип meta — обещание, а не гарантия: значения приезжают из jsonb
   * непроверенным кастом. Чужой вид залога не должен выдаваться за сумму, а
   * дата в чужом формате — за дату. */
  it("неизвестный вид залога не выдаётся за денежный", () => {
    const rows = requestNoteRows({ ...full, depositType: "cash" as never });
    expect(rows.map((r) => r.term)).not.toContain("Залог");
  });

  it("дата в чужом формате строки не рождает и NaN не печатает", () => {
    const rows = requestNoteRows({ from: "12.09.2026", to: "14.09.2026", priceDay: 500 } as never);
    expect(rows).toEqual([]);
  });

  it("пустая meta строк не даёт и не бросает", () => {
    expect(requestNoteRows(null)).toEqual([]);
    expect(requestNoteRows({})).toEqual([]);
  });

  /* Превью в списке переписок берёт только заголовок и даты. Условия сделки
   * туда попасть не должны: строка списка узкая, и цена вытеснила бы из неё
   * название события. */
  it("в превью списка переписок условия не просачиваются", () => {
    const line = systemMessageLine("request_created", full);
    expect(line).not.toContain("₽");
    expect(line).not.toContain("Залог");
  });
});
