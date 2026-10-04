import { describe, it, expect, vi, beforeEach } from "vitest";

// Приватность адреса: публичные чтения объявления не выбирают ни полный адрес
// (может быть с номером дома), ни точку — что не выбрано, не уедет ни в HTML,
// ни в RSC-payload. Проверяется текст запросов, ушедших в базу: drizzle
// собран над фальшивым клиентом, как в catalog-search.test.ts.
const { queries } = vi.hoisted(() => ({ queries: [] as string[] }));

vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const client = {
    query: async (q: { text: string }) => {
      queries.push(q.text);
      return { rows: [] };
    },
  };
  const db = drizzle({ client: client as never });
  return { getDb: () => db, getPool: () => ({}) };
});

import {
  getActiveListingById, getActiveListingCardsByOwner, getActiveListingsByOwner,
  getListingsForCategories, getNearbyListings, getRecentListings, publicListingColumns, searchListings,
} from "@/server/catalog";
import type { UserPoint } from "@/lib/geo/location";

const CITY = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
// С таблицей и без: запрос к одной таблице колонки не квалифицирует.
const PRIVATE = /"(address|lat|lon)"/;
const NEAR: UserPoint = { point: { lat: 45.035, lon: 38.975 }, label: null, source: "address", precision: "house" };

/**
 * Что уходит наружу — список выборки без расстояния. Чтения «рядом» считают
 * расстояние по точке объявления и фильтруют по ней, но саму точку не выбирают:
 * в выборку попадает только число (distanceKm).
 */
function projection(text: string): string {
  const list = text.slice(0, text.indexOf(" from "));
  return list.replace(/case when [\s\S]*? end/g, "");
}

beforeEach(() => {
  queries.length = 0;
});

describe("publicListingColumns", () => {
  it("has every listing column except address, lat and lon", () => {
    const keys = Object.keys(publicListingColumns);
    for (const k of ["address", "lat", "lon"]) expect(keys).not.toContain(k);
    // Публичная подпись и точность остаются: их показывают страница и «≈».
    for (const k of ["id", "title", "location", "geoPrecision", "photosJson"]) expect(keys).toContain(k);
  });
});

describe("public listing reads", () => {
  it.each([
    ["getActiveListingById", () => getActiveListingById("L1")],
    ["getActiveListingsByOwner", () => getActiveListingsByOwner("u1")],
    ["getActiveListingCardsByOwner", () => getActiveListingCardsByOwner("u1")],
    ["getRecentListings", () => getRecentListings(CITY)],
    ["getListingsForCategories", () => getListingsForCategories([CITY], ["cat"])],
    ["searchListings", () => searchListings([CITY], { text: "дрель" })],
    ["getNearbyListings", () => getNearbyListings([CITY], NEAR), projection],
  ])("%s selects neither the address nor the point", async (_name, run, view = (t: string) => t) => {
    await run();
    expect(queries.length).toBeGreaterThan(0);
    for (const text of queries) {
      expect(text).toMatch(/"location"|count\(/);
      expect(view(text)).not.toMatch(PRIVATE);
    }
  });
});

describe("getNearbyListings", () => {
  it("takes only listings with a point, nearest first then by id, without a count", async () => {
    await getNearbyListings([CITY], NEAR, 8);
    expect(queries).toHaveLength(1);
    const [text] = queries;
    expect(text).toMatch(/"lat" is not null/);
    expect(text).toMatch(/"status" = \$\d+/);
    expect(text).toMatch(/order by case when [\s\S]* end asc, "listings"\."id" asc/);
    expect(text).not.toMatch(/count\(/);
    expect(text).toMatch(/limit \$\d+/);
  });

  it("asks nothing for an empty set of cities", async () => {
    expect(await getNearbyListings([], NEAR)).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});
