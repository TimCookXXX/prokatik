import { describe, it, expect } from "vitest";
import {
  carryParams, defaultSort, filterParams, parseDateRange, parseFilters, sortContextOf, sortOptionsFor,
} from "@/lib/catalog/filters";

describe("parseFilters()", () => {
  it("пустые параметры — без фильтров, страница 1, сортировка по умолчанию", () => {
    expect(parseFilters({})).toEqual({
      priceMin: undefined, priceMax: undefined, deposit: undefined,
      verifiedOnly: undefined, sort: "new", page: 1,
    });
  });

  it("пустые строки из незаполненной формы — НЕ ноль", () => {
    // Браузер шлёт ?price_min=&price_max=&sort= при пустых полях.
    const f = parseFilters({ price_min: "", price_max: "", sort: "" });
    expect(f.priceMin).toBeUndefined();
    expect(f.priceMax).toBeUndefined();
    expect(f.sort).toBe("new");
  });

  it("валидные числа проходят, дробные floor-ятся", () => {
    const f = parseFilters({ price_min: "400", price_max: "700.9" });
    expect(f.priceMin).toBe(400);
    expect(f.priceMax).toBe(700);
  });

  it("мусор и отрицательные — игнорируются", () => {
    const f = parseFilters({ price_min: "abc", price_max: "-5", page: "xx" });
    expect(f.priceMin).toBeUndefined();
    expect(f.priceMax).toBeUndefined();
    expect(f.page).toBe(1);
  });

  it("sort только из белого списка, иначе умолчание", () => {
    expect(parseFilters({ sort: "price_asc" }).sort).toBe("price_asc");
    expect(parseFilters({ sort: "price_desc" }).sort).toBe("price_desc");
    expect(parseFilters({ sort: "evil" }).sort).toBe("new");
  });

  it("page парсится, невалидная — 1", () => {
    expect(parseFilters({ page: "3" }).page).toBe(3);
    expect(parseFilters({ page: "0" }).page).toBe(1);
    expect(parseFilters({ page: "" }).page).toBe(1);
  });

  it("deposit только из белого списка", () => {
    expect(parseFilters({ deposit: "money" }).deposit).toBe("money");
    expect(parseFilters({ deposit: "document" }).deposit).toBe("document");
    expect(parseFilters({ deposit: "none" }).deposit).toBe("none");
    expect(parseFilters({ deposit: "evil" }).deposit).toBeUndefined();
  });

  it("handover только из белого списка", () => {
    expect(parseFilters({ handover: "pickup" }).handover).toBe("pickup");
    expect(parseFilters({ handover: "delivery" }).handover).toBe("delivery");
    expect(parseFilters({ handover: "any" }).handover).toBeUndefined();
    expect(parseFilters({ handover: "evil" }).handover).toBeUndefined();
    expect(parseFilters({}).handover).toBeUndefined();
  });

  // Незажатый checkbox браузер не отправляет вовсе, поэтому включает только
  // явная «1»: любое другое значение считаем выключенным.
  it("verified включается только значением 1", () => {
    expect(parseFilters({ verified: "1" }).verifiedOnly).toBe(true);
    expect(parseFilters({ verified: "0" }).verifiedOnly).toBeUndefined();
    expect(parseFilters({ verified: "on" }).verifiedOnly).toBeUndefined();
    expect(parseFilters({}).verifiedOnly).toBeUndefined();
  });
});

describe("filterParams()", () => {
  it("переносит заполненные фильтры и опускает пустые", () => {
    const qs = filterParams({
      price_min: "300", price_max: "", deposit: "money", verified: "1", sort: "price_asc",
    }).toString();
    expect(qs).toBe("price_min=300&deposit=money&verified=1&sort=price_asc");
  });

  // Регрессия: ключ, забытый в filterParams, слетает при переходе на вторую
  // страницу, смене вида и сортировки — фильтр молча перестаёт действовать.
  it("переносит способ получения", () => {
    expect(filterParams({ handover: "delivery" }).toString()).toBe("handover=delivery");
  });

  // page в ссылки фильтров не попадает: пагинация дописывает его сама, иначе
  // смена страницы тащила бы за собой прежний номер.
  it("не тащит page и контекст поиска", () => {
    const qs = filterParams({ page: "3", q: "дрель", city: "kazan" }).toString();
    expect(qs).toBe("");
  });
});

// Сортировка, которую возвращает parseFilters, — уже действующая: её и
// подсвечивает меню. Раньше при пустом `sort` меню показывало первый пункт
// («свободные»), а порядок был «новые».
describe("действующая сортировка", () => {
  it("при запросе по умолчанию — подходящие, без запроса — новые", () => {
    expect(defaultSort({ q: "дрель" })).toBe("relevance");
    expect(defaultSort({})).toBe("new");
    expect(parseFilters({}, { q: "дрель" }).sort).toBe("relevance");
    expect(parseFilters({}).sort).toBe("new");
  });

  // При запросе новизна больше не умолчание, поэтому `sort=new` в адресе
  // теперь значимо и не отбрасывается.
  it("явное sort=new допустимо", () => {
    expect(parseFilters({ sort: "new" }, { q: "дрель" }).sort).toBe("new");
    expect(parseFilters({ sort: "new" }).sort).toBe("new");
  });

  it("relevance без запроса отбрасывается к умолчанию", () => {
    expect(parseFilters({ sort: "relevance" }).sort).toBe("new");
    expect(parseFilters({ sort: "relevance" }, { q: "дрель" }).sort).toBe("relevance");
  });

  it("sortOptionsFor предлагает «Подходящие» только при запросе", () => {
    const withQ = sortOptionsFor({ q: "дрель" }).map((o) => o.value);
    const without = sortOptionsFor({}).map((o) => o.value);
    expect(withQ).toEqual(["relevance", "free", "new", "price_asc", "price_desc"]);
    expect(without).toEqual(["free", "new", "price_asc", "price_desc"]);
  });
});

// Точка «Где» (lib/geo/location.ts) действует только в городе с геоданными
// (region): там у объявлений есть точки, и есть от чего считать «Ближе».
describe("«Где» и «Ближе»", () => {
  const loc = { loc: "p:45.035,38.975", la: "ул. Красная", lp: "s" };

  it("точка из адреса попадает в фильтры только в городе с геоданными", () => {
    expect(parseFilters(loc, { region: true }).near).toEqual({
      point: { lat: 45.035, lon: 38.975 }, label: "ул. Красная", source: "address", precision: "street",
    });
    expect(parseFilters(loc).near).toBeUndefined();
    expect(parseFilters(loc, { region: false }).near).toBeUndefined();
  });

  it("мусор, район и округ — без точки", () => {
    for (const bad of ["p:abc", "d:yubileynyy", "o:zapadnyy", ""]) {
      expect(parseFilters({ loc: bad }, { region: true }).near).toBeUndefined();
    }
  });

  it("без запроса с точкой по умолчанию — ближе; запрос важнее", () => {
    expect(defaultSort({ near: true })).toBe("near");
    expect(defaultSort({ q: "дрель", near: true })).toBe("relevance");
    expect(parseFilters(loc, { region: true }).sort).toBe("near");
    expect(parseFilters(loc, { q: "дрель", region: true }).sort).toBe("relevance");
  });

  it("sort=near допустим только с точкой и регионом, иначе молча отбрасывается", () => {
    expect(parseFilters({ ...loc, sort: "near" }, { q: "дрель", region: true }).sort).toBe("near");
    expect(parseFilters({ sort: "near" }, { region: true }).sort).toBe("new");
    expect(parseFilters({ ...loc, sort: "near" }).sort).toBe("new");
    expect(parseFilters({ ...loc, sort: "near" }, { q: "дрель" }).sort).toBe("relevance");
  });

  it("явная сортировка с точкой остаётся", () => {
    expect(parseFilters({ ...loc, sort: "price_asc" }, { region: true }).sort).toBe("price_asc");
    expect(parseFilters({ ...loc, sort: "new" }, { region: true }).sort).toBe("new");
  });

  it("sortOptionsFor предлагает «Ближе» только с действующей точкой", () => {
    expect(sortOptionsFor({ near: true }).map((o) => o.value))
      .toEqual(["near", "free", "new", "price_asc", "price_desc"]);
    expect(sortOptionsFor({ q: "дрель", near: true }).map((o) => o.value))
      .toEqual(["relevance", "near", "free", "new", "price_asc", "price_desc"]);
    expect(sortOptionsFor({}).map((o) => o.value)).not.toContain("near");
  });

  it("sortContextOf берёт точку из готовых фильтров", () => {
    expect(sortContextOf(parseFilters(loc, { region: true }))).toEqual({ q: undefined, near: true });
    expect(sortContextOf(parseFilters(loc), "дрель")).toEqual({ q: "дрель", near: false });
  });
});

// Даты выдачи разбираются строго, по правилам брони (docs/domain.md): мусор и
// половинка — фильтра нет, прошлое начало подтягивается к сегодня, горизонт —
// 180 дней. «Сегодня» передаётся явно: иначе тест зависел бы от дня прогона.
describe("диапазон дат", () => {
  const today = "2026-10-03";
  const range = (from?: string, to?: string) => parseDateRange({ from, to }, today);

  it("валидный диапазон проходит как есть, один день — тоже диапазон", () => {
    expect(range("2026-10-10", "2026-10-12")).toEqual({ from: "2026-10-10", to: "2026-10-12" });
    expect(range("2026-10-10", "2026-10-10")).toEqual({ from: "2026-10-10", to: "2026-10-10" });
  });

  // Date.parse переносит 30 февраля на 2 марта; раньше такой «день» проходил.
  it("несуществующий день — фильтра нет", () => {
    expect(range("2027-02-30", "2027-03-02")).toBeUndefined();
    expect(range("2026-10-10", "2026-10-32")).toBeUndefined();
  });

  it("мусор и половинка — фильтра нет", () => {
    expect(range("garbage", "2026-10-12")).toBeUndefined();
    expect(range("2026-10-10", undefined)).toBeUndefined();
    expect(range(undefined, "2026-10-12")).toBeUndefined();
    expect(range("", "")).toBeUndefined();
  });

  it("перевёрнутый диапазон не чинится, а отбрасывается", () => {
    expect(range("2026-10-12", "2026-10-10")).toBeUndefined();
  });

  it("начало в прошлом подтягивается к сегодня", () => {
    expect(range("2026-09-28", "2026-10-05")).toEqual({ from: today, to: "2026-10-05" });
    expect(range("2026-09-28", today)).toEqual({ from: today, to: today });
  });

  it("диапазон целиком в прошлом — фильтра нет", () => {
    expect(range("2026-09-28", "2026-10-02")).toBeUndefined();
  });

  it("граница за горизонтом брони — фильтра нет, а не кламп", () => {
    // today + 180 = 2027-04-01
    expect(range("2027-03-25", "2027-04-01")).toEqual({ from: "2027-03-25", to: "2027-04-01" });
    expect(range("2027-03-25", "2027-04-02")).toBeUndefined();
    expect(range("2027-04-02", "2027-04-05")).toBeUndefined();
  });

  it("длина не ограничена", () => {
    expect(range(today, "2027-04-01")).toEqual({ from: today, to: "2027-04-01" });
  });

  it("parseFilters отдаёт нормализованный диапазон", () => {
    const f = parseFilters({ from: "2026-09-28", to: "2026-10-05" }, { today });
    expect(f).toMatchObject({ availableFrom: today, availableTo: "2026-10-05" });
    const bad = parseFilters({ from: "2027-02-30", to: "2027-03-02" }, { today });
    expect(bad.availableFrom).toBeUndefined();
    expect(bad.availableTo).toBeUndefined();
  });
});

// Ссылки несут те же даты, что применены к выдаче, — нормализованные, а не
// сырые из адреса: иначе человек видел бы в ссылке одно, а в выдаче другое.
describe("carryParams()", () => {
  const today = "2026-10-03";

  it("переносит нормализованные даты", () => {
    expect(carryParams({ from: "2026-09-28", to: "2026-10-05" }, { today }).toString())
      .toBe("from=2026-10-03&to=2026-10-05");
  });

  it("без валидного диапазона ничего не переносит", () => {
    expect(carryParams({}, { today }).toString()).toBe("");
    expect(carryParams({ from: "2026-10-10" }, { today }).toString()).toBe("");
    expect(carryParams({ from: "2027-02-30", to: "2027-03-02" }, { today }).toString()).toBe("");
  });

  it("filterParams включает переносимые параметры", () => {
    const qs = filterParams({ price_min: "300", from: "2026-09-28", to: "2026-10-05" }, { today });
    expect(qs.toString()).toBe("price_min=300&from=2026-10-03&to=2026-10-05");
  });

  it("filterParams не тащит битые даты", () => {
    const qs = filterParams({ deposit: "none", from: "2026-10-10", to: "garbage" }, { today });
    expect(qs.toString()).toBe("deposit=none");
  });

  // «Где» едет так же, как даты, — уже через кодек: три знака, мусор отброшен.
  it("переносит «Где» нормализованным", () => {
    const qs = carryParams({
      from: "2026-10-10", to: "2026-10-12",
      loc: "p:45.062115,38.95201", la: " рядом: улица Красная ", src: "geo", lp: "s",
    }, { today });
    expect(Object.fromEntries(qs)).toEqual({
      from: "2026-10-10", to: "2026-10-12",
      loc: "p:45.062,38.952", la: "рядом: улица Красная", src: "geo", lp: "s",
    });
  });

  it("без точки не переносит ни подпись, ни точность", () => {
    expect(carryParams({ loc: "d:yubileynyy", la: "Юбилейный", lp: "t" }, { today }).toString()).toBe("");
    expect(carryParams({ la: "ул. Красная", src: "geo" }, { today }).toString()).toBe("");
  });

  it("повторённый loc не роняет разбор: берётся первое значение", () => {
    const sp = { loc: ["p:45.035,38.975", "x"], la: ["ул. Красная", "y"] } as unknown as { loc: string; la: string };
    expect(Object.fromEntries(carryParams(sp, { today }))).toEqual({ loc: "p:45.035,38.975", la: "ул. Красная" });
    expect(parseFilters(sp, { today, region: true }).near?.point).toEqual({ lat: 45.035, lon: 38.975 });
  });

  it("filterParams включает «Где» вместе с sort=near", () => {
    const qs = filterParams({ price_max: "900", sort: "near", loc: "p:45.035,38.975", lp: "t" }, { today });
    expect(qs.toString()).toBe("price_max=900&sort=near&loc=p%3A45.035%2C38.975&lp=t");
  });
});
