import { describe, it, expect, vi, beforeEach } from "vitest";

// Выдача /search в SQL: условие запроса (id из индекса или аварийный ILIKE),
// порядок «Подходящие» и то, что пустой запрос доходит до базы.
//
// Настоящего Postgres в тестах нет, поэтому drizzle собирается над фальшивым
// клиентом: запросы строятся и уходят ровно как в проде, клиент запоминает их
// текст и параметры и отвечает пустыми строками. Проверяется то, что уедет в
// базу, а не дерево объекта.
// `replies` — ответы по очереди (строки в форме rowMode: "array", как их
// просит drizzle); кончились — пусто.
const { queries, replies } = vi.hoisted(() => ({
  queries: [] as Array<{ text: string; params: unknown[] }>,
  replies: [] as unknown[][][],
}));

vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const client = {
    query: async (q: { text: string }, params: unknown[] = []) => {
      queries.push({ text: q.text, params });
      return { rows: replies.shift() ?? [] };
    },
  };
  const db = drizzle({ client: client as never });
  return { getDb: () => db, getPool: () => ({}) };
});

import {
  getFreeListingIds, getListingCountsByCategory, getListingDistance, getListingsForCategories,
  getSearchFacets, searchListings,
} from "@/server/catalog";
import type { UserPoint } from "@/lib/geo/location";
import { haversineKm } from "@/lib/geo/point";

const CITY = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

beforeEach(() => {
  queries.length = 0;
  replies.length = 0;
});

// Запрос карточек — тот, что с LIMIT; второй — счётчик.
const itemsQuery = () => queries.find((q) => /\blimit\b/.test(q.text))!;

describe("searchListings", () => {
  // Раньше пустой q возвращал заглушку, не заходя в базу, и /search без
  // запроса была пустой страницей.
  it("queries the database when the query is empty", async () => {
    const res = await searchListings([CITY], { text: "" });
    expect(queries.length).toBeGreaterThan(0);
    expect(res).toEqual({ items: [], total: 0 });
    expect(itemsQuery().text).not.toMatch(/ilike/);
  });

  it("narrows by the ranked ids with IN, not = ANY", async () => {
    await searchListings([CITY], { ids: ["B", "A", "C"] });
    const { text, params } = itemsQuery();
    expect(text).toMatch(/"listings"\."id" in \(\$\d+, \$\d+, \$\d+\)/);
    expect(text).not.toMatch(/any\(/i);
    expect(text).not.toMatch(/ilike/);
    expect(params).toEqual(expect.arrayContaining(["B", "A", "C"]));
  });

  // Порядок «Подходящие» — позиция id в массиве индекса. Массив уходит одним
  // параметром с приведением к text[]: `${ids}` в шаблоне развернулся бы в
  // список, и array_position получил бы не массив.
  it("orders by the position in the ranked ids for relevance", async () => {
    const ids = ["B", "A", "C"];
    await searchListings([CITY], { ids }, { sort: "relevance" });
    const { text, params } = itemsQuery();
    const m = text.match(/order by array_position\(\$(\d+)::text\[\], "listings"\."id"\), "listings"\."id" asc/);
    expect(m).not.toBeNull();
    expect(params[Number(m![1]) - 1]).toEqual(ids);
  });

  it("keeps other sorts on top of the same ids", async () => {
    await searchListings([CITY], { ids: ["B", "A"] }, { sort: "price_asc" });
    const { text } = itemsQuery();
    expect(text).toMatch(/"listings"\."id" in \(/);
    expect(text).not.toMatch(/array_position/);
    expect(text).toMatch(/order by "listings"\."price_day" asc/);
  });

  it("answers an empty id set without going to the database", async () => {
    const res = await searchListings([CITY], { ids: [] }, { sort: "relevance" });
    expect(res).toEqual({ items: [], total: 0 });
    expect(queries).toHaveLength(0);
  });

  // Аварийный путь: индекс не собрался — ILIKE, а релевантности нет, порядок
  // как у новых.
  it("falls back to ILIKE by text and orders by novelty", async () => {
    await searchListings([CITY], { text: "дрель" }, { sort: "relevance" });
    const { text, params } = itemsQuery();
    expect(text).toMatch(/"listings"\."title" ilike/);
    expect(params).toContain("%дрель%");
    expect(text).not.toMatch(/array_position/);
    expect(text).toMatch(/order by "listings"\."created_at" desc/);
  });
});

// Подсказки «Что» с датами отсеивают занятых getFreeListingIds, выдача — фильтром
// дат. Условие обязано быть одним, иначе верх выдачи разошёлся бы с подсказками.
describe("getFreeListingIds", () => {
  it("uses the same free-in-range condition as the results", async () => {
    const notExists = (text: string) => text.match(/not exists \([\s\S]*?\)/)?.[0].replace(/\$\d+/g, "$");

    await getFreeListingIds(["A", "B"], "2026-10-05", "2026-10-07");
    const free = queries[0]!;
    queries.length = 0;
    await searchListings([CITY], { ids: ["A", "B"] }, { availableFrom: "2026-10-05", availableTo: "2026-10-07" });
    const results = itemsQuery();

    expect(notExists(free.text)).toBeDefined();
    expect(notExists(free.text)).toBe(notExists(results.text));
    expect(free.params).toEqual(expect.arrayContaining(["2026-10-05", "2026-10-07"]));
  });

  it("answers an empty id set without going to the database", async () => {
    expect(await getFreeListingIds([], "2026-10-05", "2026-10-07")).toEqual(new Set());
    expect(queries).toHaveLength(0);
  });
});

describe("getSearchFacets", () => {
  it("queries the database when the query is empty", async () => {
    await getSearchFacets([CITY], { text: "" });
    expect(queries.length).toBeGreaterThan(0);
  });

  it("counts facets over the ranked ids", async () => {
    await getSearchFacets([CITY], { ids: ["B", "A"] });
    expect(queries[0].text).toMatch(/"listings"\."id" in \(\$\d+, \$\d+\)/);
  });

  it("answers an empty id set without going to the database", async () => {
    const res = await getSearchFacets([CITY], { ids: [] });
    expect(res).toEqual({ countsByCategory: new Map(), minPriceDay: null, maxPriceDay: null });
    expect(queries).toHaveLength(0);
  });

  // Границы слайдера не должны учитывать сам ценовой фильтр, иначе диапазон
  // схлопывается к выбранному. Считаются они отдельным запросом — и только
  // тогда, когда фильтр цены действительно стоит.
  it("takes bounds from the counting query while no price filter is set", async () => {
    await getSearchFacets([CITY], { text: "" }, { deposit: "money" });
    expect(queries).toHaveLength(1);
  });

  it("counts bounds separately once a price filter narrows the feed", async () => {
    await getSearchFacets([CITY], { text: "" }, { priceMin: 100 });
    expect(queries).toHaveLength(2);
  });
});

// Расстояние и «Ближе» (план поиска, §3): гаверсинус в SQL, строки без точки —
// последними, точка объявления наружу не уходит.
describe("distance to the «Где» point", () => {
  const near: UserPoint = {
    point: { lat: 45.035, lon: 38.975 }, label: null, source: "address", precision: "house",
  };
  // Выражение distanceKm, как его собирает drizzle: колонки квалифицированы
  // таблицей, кроме запроса к одной таблице; точка — параметрами.
  const col = (c: string) => `(?:"listings"\\.)?"${c}"`;
  const DISTANCE = new RegExp([
    `case when ${col("lat")} is null then null else\\s+2 \\* 6371 \\* asin\\(least\\(1, sqrt\\(\\s+`,
    `power\\(sin\\(radians\\(${col("lat")} - \\$(\\d+)\\) / 2\\), 2\\)\\s+`,
    `\\+ cos\\(radians\\(\\$(\\d+)\\)\\) \\* cos\\(radians\\(${col("lat")}\\)\\) `,
    `\\* power\\(sin\\(radians\\(${col("lon")} - \\$(\\d+)\\) / 2\\), 2\\)\\s+\\)\\)\\) end`,
  ].join(""));

  it("selects the haversine distance with the point as parameters", async () => {
    await searchListings(["C"], { text: "" }, { near });
    const { text, params } = itemsQuery();
    const m = text.match(DISTANCE);
    expect(m).not.toBeNull();
    expect([m![1], m![2], m![3]].map((n) => params[Number(n) - 1])).toEqual([45.035, 45.035, 38.975]);
  });

  // Точка объявления участвует только внутри выражения: голой колонки lat/lon
  // в выборке нет, наружу уходит одно число.
  it("never selects the listing point itself", async () => {
    await searchListings(["C"], { text: "" }, { near, sort: "near" });
    const rest = itemsQuery().text.replace(new RegExp(DISTANCE, "g"), "<distance>");
    expect(rest).not.toMatch(/"(lat|lon|address)"/);
    expect(rest).toContain("<distance>");
  });

  it("selects no distance without a point", async () => {
    await searchListings(["C"], { text: "" });
    expect(itemsQuery().text).not.toMatch(/asin|"lat"/);
  });

  it("orders nearest first, rows without a point last, then by id", async () => {
    await getListingsForCategories(["C"], ["cat"], { near, sort: "near" });
    const { text } = itemsQuery();
    const order = text.slice(text.indexOf(" order by "));
    expect(order).toMatch(/^ order by case when "listings"\."lat" is null then null else[\s\S]+ end asc nulls last, "listings"\."id" asc limit/);
  });

  it("falls back to novelty for sort=near without a point", async () => {
    await searchListings(["C"], { text: "" }, { sort: "near" });
    expect(itemsQuery().text).toMatch(/order by "listings"\."created_at" desc, "listings"\."id" asc/);
  });

  // Тот же гаверсинус, что haversineKm: текст выражения, который уходит в
  // базу, переводится в JS один к одному (функции Postgres → Math) и
  // считается на точках объявления. Расходись формулы — разошлись бы
  // расстояние на карточке и «Ближе» с подписью точности в форме.
  it("computes the same distance as haversineKm", async () => {
    await getListingDistance("L1", near);
    const { text, params } = queries[0]!;
    const expr = text.match(DISTANCE)![0];
    const toJs = (lat: number, lon: number) => expr
      .replace(/^case when [\s\S]*? else/, "").replace(/ end$/, "")
      .replace(new RegExp(col("lat"), "g"), String(lat))
      .replace(new RegExp(col("lon"), "g"), String(lon))
      .replace(/\$(\d+)/g, (_, n: string) => String(params[Number(n) - 1]))
      .replace(/\basin\(/g, "Math.asin(").replace(/\bleast\(/g, "Math.min(")
      .replace(/\bsqrt\(/g, "Math.sqrt(").replace(/\bpower\(/g, "Math.pow(")
      .replace(/\bsin\(/g, "Math.sin(").replace(/\bcos\(/g, "Math.cos(")
      .replace(/\bradians\(/g, "rad(");
    const sqlKm = (lat: number, lon: number) =>
      new Function("rad", `return (${toJs(lat, lon)});`)((d: number) => (d * Math.PI) / 180) as number;

    for (const [lat, lon] of [[45.035, 38.975], [44.9913, 38.9412], [45.1102, 39.0507], [45.2, 38.5]]) {
      expect(sqlKm(lat, lon)).toBeCloseTo(haversineKm(near.point, { lat, lon }), 9);
    }
  });

  // Правило «≈» (план поиска, §3): приблизительно, если хоть одна из точек не
  // дом — точка «Где» до улицы или места (lp=s|t) или адрес объявления.
  it("marks the distance approximate unless both points are houses", async () => {
    const cases: Array<[UserPoint["precision"], string, boolean]> = [
      ["house", "house", false],
      ["street", "house", true],
      ["place", "house", true],
      ["house", "street", true],
      ["house", "place", true],
    ];
    for (const [userPrecision, listingPrecision, approx] of cases) {
      replies.push([["1.25", listingPrecision]]);
      expect(await getListingDistance("L1", { ...near, precision: userPrecision }))
        .toEqual({ km: 1.25, approx });
    }
    // Нет точки у объявления — расстояния нет.
    replies.push([[null, "city"]]);
    expect(await getListingDistance("L1", near)).toBeNull();
  });

  it("getListingDistance reads only the computed distance and the precision", async () => {
    expect(await getListingDistance("L1", near)).toBeNull();
    const { text, params } = queries[0]!;
    expect(text).toMatch(DISTANCE);
    expect(text.replace(DISTANCE, "")).not.toMatch(/"(lat|lon|address)"/);
    expect(text).toMatch(/"geo_precision"/);
    expect(params).toContain("L1");
  });
});

// С точкой «Где» выдача идёт по всем городам региона (getCityScope): условие
// по городу — `in` по набору; один город — по-прежнему `=`.
describe("city set", () => {
  it("one city stays an equality", async () => {
    await searchListings(["C1"], { text: "" });
    expect(itemsQuery().text).toMatch(/"listings"\."city_id" = \$\d+/);
  });

  it("the region narrows results, facets and counts by IN", async () => {
    const IN = /"listings"\."city_id" in \(\$\d+, \$\d+\)/;
    await searchListings(["C1", "C2"], { ids: ["A"] });
    expect(itemsQuery().text).toMatch(IN);
    expect(itemsQuery().params).toEqual(expect.arrayContaining(["C1", "C2"]));
    // Счётчик выдачи — тем же условием.
    expect(queries.find((q) => !/\blimit\b/.test(q.text))!.text).toMatch(IN);

    queries.length = 0;
    await getSearchFacets(["C1", "C2"], { ids: ["A"] });
    expect(queries[0].text).toMatch(IN);

    queries.length = 0;
    await getListingCountsByCategory(["C1", "C2"]);
    expect(queries[0].text).toMatch(IN);

    queries.length = 0;
    await getListingsForCategories(["C1", "C2"], ["cat"]);
    expect(itemsQuery().text).toMatch(IN);
  });

  it("an empty set answers nothing without going to the database", async () => {
    expect(await searchListings([], { text: "" })).toEqual({ items: [], total: 0 });
    expect(await getListingsForCategories([], ["cat"])).toEqual({ items: [], total: 0 });
    expect(await getListingCountsByCategory([])).toEqual(new Map());
    expect(queries).toHaveLength(0);
  });
});
