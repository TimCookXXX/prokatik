// @vitest-environment node
// Загрузка данных своего геокодера из БД (src/server/geocoder-index.ts):
// строки таблиц → GeoIndexData, кэш процесса по региону и перезагрузка по
// версии импорта. Перенос SP tests/geocoder/import-index.test.ts без запасного
// JSON-файла: в inrenta его нет.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type HouseRow = import("@/server/geocoder-index").HouseRow;

interface FakeDb {
  version: string | null;
  builtAt: Date;
  houses: HouseRow[];
  calls: string[];
  values: unknown[][];
}

const db = vi.hoisted((): FakeDb => ({ version: null, builtAt: new Date(0), houses: [], calls: [], values: [] }));
const released = vi.hoisted((): boolean[] => []);

// Пул-заглушка: отвечает по тексту запроса — как настоящие запросы загрузки.
vi.mock("@/lib/db", () => {
  const query = async (q: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
    const text = typeof q === "string" ? q : q.text;
    db.calls.push(text.replace(/\s+/g, " ").trim());
    db.values.push(typeof q === "string" ? values ?? [] : q.values ?? []);
    if (text.includes("from geo_imports")) {
      return { rows: db.version ? [{ version: db.version, built_at: db.builtAt }] : [] };
    }
    if (text.includes("from geo_places")) {
      return {
        rows: [
          ["p_krd", "city", "Краснодар", ["г. Краснодар"], null, 45.035, 38.977],
          ["p_jmr", "microdistrict", "Юбилейный", ["ЮМР"], "p_zap", 45.031, 38.912],
          ["p_yab", "town", "Яблоновский", null, null, 45.009, 38.941],
        ],
      };
    }
    if (text.includes("from geo_streets")) {
      return { rows: [["s_bz", "p_yab", "улица Базовская", "улица", ["Базовская улица"], 45.0057, 38.9322, 9, null]] };
    }
    if (text.includes("from geo_houses")) return { rows: db.houses };
    if (text.includes("from geo_pois")) {
      return { rows: [["o_tc", "ТЦ Красная Площадь", "mall", ["Красная Площадь"], "p_krd", 45.02, 39.03, null]] };
    }
    throw new Error(`unexpected query: ${text}`);
  };
  // Загрузка берёт своё соединение (pool.connect) и закрывает его: release(true).
  const pool = {
    query,
    connect: async () => ({ query, release: (destroy?: boolean) => { released.push(!!destroy); } }),
  };
  return { getPool: () => pool };
});

const mod = await import("@/server/geocoder-index");

beforeEach(() => {
  mod.resetGeoIndexCache();
  db.version = "osm-2026-09-27+gar-2026-09-28";
  db.builtAt = new Date("2026-09-30T10:00:00Z");
  db.houses = [
    ["s_bz", "p_yab", "21к1", 45.0106, 38.9363, "house", "osm+gar", "385140"],
    ["s_bz", "p_yab", "21к2", 45.0106, 38.9363, "interpolated", "gar", null],
    [null, "p_snt", "615", 45.1, 39.0, "place", "gar", null],
  ];
  db.calls = [];
  db.values = [];
  released.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rowsToGeoIndex", () => {
  it("maps table rows to the GeoIndexData contract", () => {
    const places: import("@/server/geocoder-index").PlaceRow[] = [
      ["p_jmr", "microdistrict", "Юбилейный", ["ЮМР", "Юбилейка"], "p_zap", 45.031, 38.912],
    ];
    const streets: import("@/server/geocoder-index").StreetRow[] = [
      ["s_1", null, "улица Красная", "улица", null, 45.03, 38.97, 553],
      ["s_2", "p_krd", "улица Ставропольская", "улица", ["ул. Ставропольская"], 45.02, 38.99, 800,
        [[[38.98, 45.01], [38.99, 45.02]], [[39.0, 45.03], [39.01, 45.04]]]],
      ["s_3", "p_krd", "улица Новая", "улица", null, 45.0, 39.0, 3, null],
    ];
    const houses: HouseRow[] = [
      ["s_1", "p_krd", "15", 45.018, 38.968, "interpolated", "gar", null],
      [null, "p_snt", "615", 45.1, 39.0, "place", "gar", "350000"],
    ];
    const pois: import("@/server/geocoder-index").PoiRow[] = [
      ["o_1", "ЖК Панорама", "residential_complex", null, null, 45.0, 39.0, "улица Стасова, 10"],
    ];
    const data = mod.rowsToGeoIndex(
      { version: "v1", region: "krasnodar", builtAt: "2026-09-30T10:00:00Z" }, places, streets, houses, pois,
    );
    // Ключ данных — регион; поле называется citySlug по формату выгрузки.
    expect(data).toMatchObject({ version: "v1", citySlug: "krasnodar", builtAt: "2026-09-30T10:00:00Z" });
    expect(data.places[0]).toEqual({
      id: "p_jmr", kind: "microdistrict", name: "Юбилейный", aliases: ["ЮМР", "Юбилейка"],
      parentId: "p_zap", lat: 45.031, lon: 38.912,
    });
    // NULL в массиве синонимов → пустой список; число домов — поле houses
    expect(data.streets[0]).toEqual({
      id: "s_1", placeId: null, name: "улица Красная", type: "улица", aliases: [], lat: 45.03, lon: 38.97, houses: 553,
    });
    // линия улицы (для обратного геокодирования) — куски [lon, lat]; NULL — поля нет
    expect(data.streets[1].line).toEqual([[[38.98, 45.01], [38.99, 45.02]], [[39.0, 45.03], [39.01, 45.04]]]);
    expect(data.streets[2]).not.toHaveProperty("line");
    // индекс без значения не попадает в объект; дом без улицы — адрес по месту (СНТ)
    expect(data.houses[0]).toEqual({
      streetId: "s_1", placeId: "p_krd", number: "15", lat: 45.018, lon: 38.968, precision: "interpolated", source: "gar",
    });
    expect(data.houses[1]).toMatchObject({ streetId: null, placeId: "p_snt", precision: "place", postcode: "350000" });
    expect(data.pois?.[0]).toMatchObject({ kind: "residential_complex", aliases: [], address: "улица Стасова, 10" });
  });
});

describe("version and token", () => {
  it("reads built_at back in the file's format", async () => {
    expect(await mod.getGeoImportVersion((await import("@/lib/db")).getPool(), "krasnodar"))
      .toEqual({ version: "osm-2026-09-27+gar-2026-09-28", builtAt: "2026-09-30T10:00:00Z" });
  });

  // Пересборка из тех же выгрузок версию не меняет, а мини-индекс по старой
  // ссылке кэшируется навсегда — метка обязана смениться и от времени сборки.
  it("changes the token with the build time, not only with the version", () => {
    const a = mod.geoDataToken("krasnodar", { version: "v1", builtAt: "2026-09-30T10:00:00Z" });
    expect(a).toMatch(/^krasnodar:[\w-]+$/);
    expect(mod.geoDataToken("krasnodar", { version: "v1", builtAt: "2026-10-01T10:00:00Z" })).not.toBe(a);
    expect(mod.geoDataToken("krasnodar", { version: "v2", builtAt: "2026-09-30T10:00:00Z" })).not.toBe(a);
    expect(mod.geoDataToken("sochi", { version: "v1", builtAt: "2026-09-30T10:00:00Z" })).not.toBe(a);
  });
});

describe("getGeoIndexData", () => {
  it("loads the region from the tables once and serves the cached copy within a minute", async () => {
    const a = await mod.getGeoIndexData("krasnodar");
    expect(a?.version).toBe("osm-2026-09-27+gar-2026-09-28");
    expect(a?.citySlug).toBe("krasnodar");
    expect(a?.houses).toHaveLength(3);
    expect(a?.streets[0].name).toBe("улица Базовская");
    const loads = db.calls.filter((c) => c.includes("geo_houses")).length;
    const b = await mod.getGeoIndexData("krasnodar");
    expect(b).toBe(a);
    expect(db.calls.filter((c) => c.includes("geo_houses")).length).toBe(loads);
  });

  it("queries every table by region and reads houses in file order", async () => {
    await mod.getGeoIndexData("krasnodar");
    const tables = db.calls.filter((c) => /from geo_(places|streets|houses|pois)/.test(c));
    expect(tables).toHaveLength(4);
    for (const text of tables) expect(text).toMatch(/where region = \$1 order by id$/);
    expect(db.values.every((v) => v[0] === "krasnodar")).toBe(true);
  });

  it("loads over its own connection and closes it (pg keeps the last result while a connection lives)", async () => {
    await mod.getGeoIndexData("krasnodar");
    expect(released).toEqual([true]);
  });

  it("shares the cache through globalThis", async () => {
    const a = await mod.getGeoIndexData("krasnodar");
    const g = globalThis as { __inrentaGeoIndex?: { entries: Map<string, { data: unknown }> } };
    expect(g.__inrentaGeoIndex?.entries.get("krasnodar")?.data).toBe(a);
  });

  it("reloads after a new import (version check at most once a minute)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const a = await mod.getGeoIndexData("krasnodar");

    // та же версия через минуту — данные не перечитываются
    vi.setSystemTime(new Date("2026-09-30T12:01:30Z"));
    const same = await mod.getGeoIndexData("krasnodar");
    await Promise.resolve();
    expect(same).toBe(a);
    expect(await mod.getGeoIndexData("krasnodar")).toBe(a);

    // новый импорт: пока грузится — прежние данные, затем новые
    db.version = "osm-2026-10-27+gar-2026-10-26";
    db.houses = [["s_bz", "p_yab", "21к1", 45.0106, 38.9363, "house", "osm+gar", null]];
    vi.setSystemTime(new Date("2026-09-30T12:03:00Z"));
    const stale = await mod.getGeoIndexData("krasnodar");
    expect(stale).toBe(a);
    await vi.waitFor(async () => {
      const next = await mod.getGeoIndexData("krasnodar");
      expect(next?.version).toBe("osm-2026-10-27+gar-2026-10-26");
      expect(next?.houses).toHaveLength(1);
    });
  });

  it("reloads after a rebuild with the same version but a new build time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const a = await mod.getGeoIndexData("krasnodar");
    db.builtAt = new Date("2026-10-01T10:00:00Z");
    vi.setSystemTime(new Date("2026-09-30T12:02:00Z"));
    await mod.getGeoIndexData("krasnodar");
    await vi.waitFor(async () => {
      const next = await mod.getGeoIndexData("krasnodar");
      expect(next).not.toBe(a);
      expect(next?.builtAt).toBe("2026-10-01T10:00:00Z");
    });
  });

  it("returns null without an import", async () => {
    db.version = null;
    expect(await mod.getGeoIndexData("krasnodar")).toBeNull();
  });
});
