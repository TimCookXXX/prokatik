import { describe, it, expect } from "vitest";
import {
  buildBookingQuery, isSelectionShifted, mergeBookingQuery, parseBookingParams, rentalDaysCount,
} from "@/lib/booking/params";

const TODAY = "2026-07-16";
const OPTS = { today: TODAY, maxQty: 3 };

describe("parseBookingParams()", () => {
  it("пустой ввод — дефолты: сегодня, 1 шт", () => {
    expect(parseBookingParams({}, OPTS)).toEqual({ from: TODAY, to: TODAY, qty: 1 });
  });

  it("валидный выбор проходит как есть", () => {
    const sel = parseBookingParams({ from: "2026-07-20", to: "2026-07-22", qty: "2" }, OPTS);
    expect(sel).toEqual({ from: "2026-07-20", to: "2026-07-22", qty: 2 });
  });

  it("прошлое подтягивается к сегодня", () => {
    const sel = parseBookingParams({ from: "2026-07-01", to: "2026-07-02" }, OPTS);
    expect(sel.from).toBe(TODAY);
    expect(sel.to).toBe(TODAY);
  });

  it("to раньше from — схлопывается в from", () => {
    const sel = parseBookingParams({ from: "2026-07-20", to: "2026-07-18" }, OPTS);
    expect(sel.to).toBe("2026-07-20");
  });

  it("за горизонтом 180 дней — кламп к горизонту", () => {
    const sel = parseBookingParams({ from: "2027-06-01", to: "2027-07-01" }, OPTS);
    expect(sel.from).toBe("2027-01-12"); // today + 180
    expect(sel.to).toBe("2027-01-12");
  });

  it("qty ограничен наличием и не меньше 1", () => {
    expect(parseBookingParams({ qty: "99" }, OPTS).qty).toBe(3);
    expect(parseBookingParams({ qty: "0" }, OPTS).qty).toBe(1);
    expect(parseBookingParams({ qty: "-2" }, OPTS).qty).toBe(1);
  });

  it("несуществующий день — как мусор", () => {
    const sel = parseBookingParams({ from: "2027-02-30", to: "2027-03-02" }, OPTS);
    expect(sel.from).toBe(TODAY);
  });

  it("мусор в датах и qty — дефолты", () => {
    const sel = parseBookingParams({ from: "garbage", to: "2026-99-99", qty: "abc" }, OPTS);
    expect(sel).toEqual({ from: TODAY, to: TODAY, qty: 1 });
  });
});

describe("isSelectionShifted()", () => {
  it("выбор, переживший кламп, сдвигом не считается", () => {
    const requested = { from: "2026-07-20", to: "2026-07-22" };
    expect(isSelectionShifted(requested, parseBookingParams(requested, OPTS))).toBe(false);
  });

  it("форма, пролежавшая через полночь, ловится", () => {
    // Карточка открыта 15 июля: человек выбрал 15–17. Отправка ушла уже 16-го,
    // кламп подтянул from к новому «сегодня» — заявка была бы на 16–17.
    const requested = { from: "2026-07-15", to: "2026-07-17" };
    expect(isSelectionShifted(requested, parseBookingParams(requested, OPTS))).toBe(true);
  });

  it("qty клампу не мешаем — он к датам отношения не имеет", () => {
    const requested = { from: "2026-07-20", to: "2026-07-22" };
    const clamped = parseBookingParams({ ...requested, qty: "99" }, OPTS);
    expect(clamped.qty).toBe(3);
    expect(isSelectionShifted(requested, clamped)).toBe(false);
  });
});

describe("buildBookingQuery()", () => {
  it("дефолтный выбор — пустой query", () => {
    expect(buildBookingQuery({ from: TODAY, to: TODAY, qty: 1 }, TODAY)).toBe("");
  });

  it("выбранные даты и qty попадают в query", () => {
    const qs = buildBookingQuery({ from: "2026-07-20", to: "2026-07-22", qty: 2 }, TODAY);
    expect(qs).toContain("from=2026-07-20");
    expect(qs).toContain("to=2026-07-22");
    expect(qs).toContain("qty=2");
  });

  it("roundtrip: parse(build(sel)) == sel", () => {
    const sel = { from: "2026-07-20", to: "2026-07-25", qty: 3 };
    const qs = new URLSearchParams(buildBookingQuery(sel, TODAY));
    const back = parseBookingParams({
      from: qs.get("from") ?? undefined,
      to: qs.get("to") ?? undefined,
      qty: qs.get("qty") ?? undefined,
    }, OPTS);
    expect(back).toEqual(sel);
  });
});

describe("rentalDaysCount()", () => {
  it("границы включительно", () => {
    expect(rentalDaysCount({ from: "2026-07-20", to: "2026-07-22", qty: 1 })).toBe(3);
    expect(rentalDaysCount({ from: "2026-07-20", to: "2026-07-20", qty: 1 })).toBe(1);
  });
});

// Виджет брони пишет адрес через replaceState. Сборка query с нуля стирала бы
// чужие параметры («Где», метки перехода) из перезагрузки и callbackUrl входа.
describe("mergeBookingQuery()", () => {
  const sel = { from: "2026-07-20", to: "2026-07-22", qty: 2 };

  it("заменяет только from/to/qty и оставляет остальное", () => {
    const qs = mergeBookingQuery("?loc=p:45.035,38.975&from=2026-07-18&to=2026-07-19&utm=x", sel, TODAY);
    const p = new URLSearchParams(qs);
    expect(p.get("loc")).toBe("p:45.035,38.975");
    expect(p.get("utm")).toBe("x");
    expect(p.get("from")).toBe("2026-07-20");
    expect(p.get("to")).toBe("2026-07-22");
    expect(p.get("qty")).toBe("2");
  });

  it("дефолты убираются из адреса, чужое остаётся", () => {
    const qs = mergeBookingQuery("from=2026-07-20&to=2026-07-22&qty=2&la=x", { from: TODAY, to: TODAY, qty: 1 }, TODAY);
    expect(qs).toBe("la=x");
  });

  it("незаконченный выбор (null) снимает даты и количество", () => {
    expect(mergeBookingQuery("from=2026-07-20&to=2026-07-22&qty=2&src=geo", null, TODAY)).toBe("src=geo");
  });

  it("пустой адрес — то же, что buildBookingQuery", () => {
    expect(mergeBookingQuery("", sel, TODAY)).toBe(buildBookingQuery(sel, TODAY));
  });
});
