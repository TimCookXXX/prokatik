// @vitest-environment node
// Импорт геоданных (scripts/geo-import.ts): файл → строки таблиц, размер пачки
// по лимиту параметров Postgres и порядок записи в одной транзакции. БД — фейк,
// который запоминает операции.
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { geoHouses, geoImports, geoPlaces, geoPois, geoStreets } from "@db/schema";
import type { GeoIndexData } from "@/lib/geocoder/types";
import { FIXTURE } from "../geocoder/fixture";
import {
  MAX_PARAMS, batchSize, geoIndexToRows, importRegion,
} from "../../scripts/geo-import";

const data = (over: Partial<GeoIndexData> = {}): GeoIndexData => ({ ...FIXTURE, ...over });

describe("geoIndexToRows", () => {
  it("maps every record of the file to a row of its region", () => {
    const rows = geoIndexToRows(data(), "krasnodar");
    expect(rows.places).toHaveLength(FIXTURE.places.length);
    expect(rows.streets).toHaveLength(FIXTURE.streets.length);
    expect(rows.houses).toHaveLength(FIXTURE.houses.length);
    expect(rows.pois).toHaveLength(FIXTURE.pois!.length);
    for (const list of Object.values(rows) as { region: string }[][]) {
      for (const row of list) expect(row.region).toBe("krasnodar");
    }
    expect(rows.places[2]).toEqual({
      id: "p-yab", region: "krasnodar", kind: "town", name: "Яблоновский",
      aliases: ["пгт Яблоновский"], parentId: null, lat: 44.988, lon: 38.9475,
    });
  });

  // text[] передаётся построчно JS-массивом: у каждой строки свой, разной
  // длины, — поэтому и вставка многострочным insert, а не unnest.
  it("keeps aliases as text arrays, empty ones included", () => {
    const rows = geoIndexToRows(data(), "krasnodar");
    expect(rows.places[1].aliases).toEqual(["ЮМР", "Юбилейка"]);
    expect(rows.streets.find((s) => s.id === "s-krasnaya")?.aliases).toEqual(["Красная улица"]);
    expect(rows.streets.find((s) => s.id === "s-stavr")?.aliases).toEqual([]);
    expect(rows.pois[0].aliases).toEqual(["Галерея Краснодар"]);
  });

  it("keeps the order of houses and gives them no id (identity keeps the order)", () => {
    const rows = geoIndexToRows(data(), "krasnodar");
    expect(rows.houses.map((h) => `${h.streetId}|${h.number}`))
      .toEqual(FIXTURE.houses.map((h) => `${h.streetId}|${h.number}`));
    expect(rows.houses[0]).not.toHaveProperty("id");
  });

  it("writes empty optional fields as null, so every row of a table has the same columns", () => {
    const rows = geoIndexToRows(data({
      streets: [{ ...FIXTURE.streets[0], line: [[[38.97, 45.03], [38.98, 45.04]]] }, FIXTURE.streets[1]],
    }), "krasnodar");
    expect(rows.streets[0].line).toEqual([[[38.97, 45.03], [38.98, 45.04]]]);
    expect(rows.streets[1].line).toBeNull();
    expect(rows.houses[0].postcode).toBeNull();
    for (const list of Object.values(rows) as Record<string, unknown>[][]) {
      const widths = new Set(list.map((r) => Object.keys(r).length));
      expect(widths.size).toBeLessThanOrEqual(1);
    }
  });

  it("accepts a file without pois", () => {
    expect(geoIndexToRows(data({ pois: undefined }), "krasnodar").pois).toEqual([]);
  });

  it("rejects a bad region, a malformed file and unknown enums", () => {
    expect(() => geoIndexToRows(data(), "Krasnodar")).toThrow(/регион/);
    expect(() => geoIndexToRows(data(), "")).toThrow(/регион/);
    expect(() => geoIndexToRows(data({ version: "" }), "krasnodar")).toThrow(/version/);
    expect(() => geoIndexToRows(data({ builtAt: "вчера" }), "krasnodar")).toThrow(/builtAt/);
    expect(() => geoIndexToRows({ ...FIXTURE, houses: undefined } as never, "krasnodar")).toThrow(/houses/);
    expect(() => geoIndexToRows(data({
      houses: [{ ...FIXTURE.houses[0], precision: "exact" as never }],
    }), "krasnodar")).toThrow(/точность/);
    expect(() => geoIndexToRows(data({
      places: [{ ...FIXTURE.places[0], kind: "metropolis" as never }],
    }), "krasnodar")).toThrow(/вид места/);
  });
});

describe("batchSize", () => {
  it("fits a batch into the Postgres parameter limit", () => {
    const rows = geoIndexToRows(data(), "krasnodar");
    const houseColumns = Object.keys(rows.houses[0]).length;
    expect(houseColumns).toBe(9);
    expect(batchSize(houseColumns)).toBe(7281);
    for (const cols of [8, 9, 10]) {
      expect(batchSize(cols) * cols).toBeLessThanOrEqual(MAX_PARAMS);
      expect((batchSize(cols) + 1) * cols).toBeGreaterThan(MAX_PARAMS);
    }
  });
});

// Фейк drizzle: транзакция исполняет колбэк на себе же и записывает операции.
function fakeDb() {
  const ops: { op: string; table: string; rows?: number; params?: number }[] = [];
  const tx = {
    delete: (table: Parameters<typeof getTableName>[0]) => ({
      where: async () => { ops.push({ op: "delete", table: getTableName(table) }); },
    }),
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: async (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const list = Array.isArray(v) ? v : [v];
        ops.push({
          op: "insert", table: getTableName(table), rows: list.length,
          params: list.reduce((n, r) => n + Object.keys(r).length, 0),
        });
      },
    }),
  };
  const db = { transaction: async (cb: (t: typeof tx) => Promise<void>) => cb(tx) };
  return { db: db as never, ops };
}

describe("importRegion", () => {
  it("replaces the region in one transaction: delete, insert, then the import row", async () => {
    const { db, ops } = fakeDb();
    const counts = await importRegion(db, data(), "krasnodar");
    expect(counts).toEqual({
      places: FIXTURE.places.length, streets: FIXTURE.streets.length,
      houses: FIXTURE.houses.length, pois: FIXTURE.pois!.length,
    });
    const deletes = ops.filter((o) => o.op === "delete").map((o) => o.table);
    expect(deletes.sort()).toEqual(
      [geoHouses, geoImports, geoPlaces, geoPois, geoStreets].map((t) => getTableName(t)).sort());
    // Все удаления — до первой вставки, строка импорта — последней.
    const firstInsert = ops.findIndex((o) => o.op === "insert");
    expect(ops.slice(0, firstInsert).every((o) => o.op === "delete")).toBe(true);
    expect(ops.at(-1)).toMatchObject({ op: "insert", table: "geo_imports", rows: 1 });
  });

  it("splits large tables into batches within the parameter limit", async () => {
    const many = Array.from({ length: 20_000 }, (_, i) => ({ ...FIXTURE.houses[i % FIXTURE.houses.length] }));
    const { db, ops } = fakeDb();
    await importRegion(db, data({ houses: many }), "krasnodar");
    const houseBatches = ops.filter((o) => o.table === "geo_houses" && o.op === "insert");
    expect(houseBatches.map((b) => b.rows)).toEqual([7281, 7281, 20_000 - 2 * 7281]);
    expect(houseBatches.every((b) => b.params! <= MAX_PARAMS)).toBe(true);
  });
});
