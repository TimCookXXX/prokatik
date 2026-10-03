import { describe, it, expect, vi, beforeEach } from "vitest";

// Выдача /search в SQL: условие запроса (id из индекса или аварийный ILIKE),
// порядок «Подходящие» и то, что пустой запрос доходит до базы.
//
// Настоящего Postgres в тестах нет, поэтому drizzle собирается над фальшивым
// клиентом: запросы строятся и уходят ровно как в проде, клиент запоминает их
// текст и параметры и отвечает пустыми строками. Проверяется то, что уедет в
// базу, а не дерево объекта.
const { queries } = vi.hoisted(() => ({ queries: [] as Array<{ text: string; params: unknown[] }> }));

vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const client = {
    query: async (q: { text: string }, params: unknown[] = []) => {
      queries.push({ text: q.text, params });
      return { rows: [] };
    },
  };
  const db = drizzle({ client: client as never });
  return { getDb: () => db, getPool: () => ({}) };
});

import { searchListings, getSearchFacets } from "@/server/catalog";

const CITY = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

beforeEach(() => {
  queries.length = 0;
});

// Запрос карточек — тот, что с LIMIT; второй — счётчик.
const itemsQuery = () => queries.find((q) => /\blimit\b/.test(q.text))!;

describe("searchListings", () => {
  // Раньше пустой q возвращал заглушку, не заходя в базу, и /search без
  // запроса была пустой страницей.
  it("queries the database when the query is empty", async () => {
    const res = await searchListings(CITY, { text: "" });
    expect(queries.length).toBeGreaterThan(0);
    expect(res).toEqual({ items: [], total: 0 });
    expect(itemsQuery().text).not.toMatch(/ilike/);
  });

  it("narrows by the ranked ids with IN, not = ANY", async () => {
    await searchListings(CITY, { ids: ["B", "A", "C"] });
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
    await searchListings(CITY, { ids }, { sort: "relevance" });
    const { text, params } = itemsQuery();
    const m = text.match(/order by array_position\(\$(\d+)::text\[\], "listings"\."id"\), "listings"\."id" asc/);
    expect(m).not.toBeNull();
    expect(params[Number(m![1]) - 1]).toEqual(ids);
  });

  it("keeps other sorts on top of the same ids", async () => {
    await searchListings(CITY, { ids: ["B", "A"] }, { sort: "price_asc" });
    const { text } = itemsQuery();
    expect(text).toMatch(/"listings"\."id" in \(/);
    expect(text).not.toMatch(/array_position/);
    expect(text).toMatch(/order by "listings"\."price_day" asc/);
  });

  it("answers an empty id set without going to the database", async () => {
    const res = await searchListings(CITY, { ids: [] }, { sort: "relevance" });
    expect(res).toEqual({ items: [], total: 0 });
    expect(queries).toHaveLength(0);
  });

  // Аварийный путь: индекс не собрался — ILIKE, а релевантности нет, порядок
  // как у новых.
  it("falls back to ILIKE by text and orders by novelty", async () => {
    await searchListings(CITY, { text: "дрель" }, { sort: "relevance" });
    const { text, params } = itemsQuery();
    expect(text).toMatch(/"listings"\."title" ilike/);
    expect(params).toContain("%дрель%");
    expect(text).not.toMatch(/array_position/);
    expect(text).toMatch(/order by "listings"\."created_at" desc/);
  });
});

describe("getSearchFacets", () => {
  it("queries the database when the query is empty", async () => {
    await getSearchFacets(CITY, { text: "" });
    expect(queries.length).toBeGreaterThan(0);
  });

  it("counts facets over the ranked ids", async () => {
    await getSearchFacets(CITY, { ids: ["B", "A"] });
    expect(queries[0].text).toMatch(/"listings"\."id" in \(\$\d+, \$\d+\)/);
  });

  it("answers an empty id set without going to the database", async () => {
    const res = await getSearchFacets(CITY, { ids: [] });
    expect(res).toEqual({ countsByCategory: new Map(), minPriceDay: null, maxPriceDay: null });
    expect(queries).toHaveLength(0);
  });

  // Границы слайдера не должны учитывать сам ценовой фильтр, иначе диапазон
  // схлопывается к выбранному. Считаются они отдельным запросом — и только
  // тогда, когда фильтр цены действительно стоит.
  it("takes bounds from the counting query while no price filter is set", async () => {
    await getSearchFacets(CITY, { text: "" }, { deposit: "money" });
    expect(queries).toHaveLength(1);
  });

  it("counts bounds separately once a price filter narrows the feed", async () => {
    await getSearchFacets(CITY, { text: "" }, { priceMin: 100 });
    expect(queries).toHaveLength(2);
  });
});
