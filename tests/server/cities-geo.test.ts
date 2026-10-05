// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Гео-контекст городов для шапки и /api/geo/*: собирается из cities и
// geo_imports, кэшируется на 60 с и движок геокодера не трогает. БД мокается
// построителем, который отвечает данными теста по таблице запроса.
const db = vi.hoisted(() => ({
  cities: [] as { slug: string; lat: number | null; lon: number | null; geoRegion: string | null }[],
  imports: [] as { region: string; version: string; builtAt: Date }[],
  queries: 0,
  fail: false,
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@db/schema");
  const select = () => {
    let table: unknown = null;
    const chain: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (rows: unknown[]) => void, reject: (e: unknown) => void) => {
            db.queries++;
            if (db.fail) return reject(new Error("db down"));
            resolve(table === schema.geoImports ? db.imports : db.cities);
          };
        }
        return (...args: unknown[]) => {
          if (prop === "from") table = args[0];
          return chain;
        };
      },
    });
    return chain;
  };
  return { getDb: () => ({ select, selectDistinctOn: select }), getPool: () => ({}) };
});
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
// Движок геокодера гео-контекст грузить не должен ни при каких условиях.
vi.mock("@/server/geocoder", () => ({ getRegionGeocoder: vi.fn(() => { throw new Error("engine loaded"); }) }));

import { CITIES_GEO_TTL_MS, getCitiesGeo, invalidateCitiesGeo } from "@/server/city";
import { geoDataToken } from "@/server/geocoder-index";

const BUILT = new Date("2026-09-29T23:28:19Z");

beforeEach(() => {
  invalidateCitiesGeo();
  db.cities = [
    { slug: "krasnodar", lat: 45.0351532, lon: 38.9772396, geoRegion: "krasnodar" },
    { slug: "yablonovskiy", lat: 44.9864341, lon: 38.9382841, geoRegion: "krasnodar" },
    { slug: "kazan", lat: 55.79, lon: 49.12, geoRegion: null },
    { slug: "sochi", lat: 43.58, lon: 39.72, geoRegion: "sochi" },        // регион без импорта
    { slug: "maykop", lat: null, lon: null, geoRegion: "krasnodar" },     // регион без центра
  ];
  db.imports = [{ region: "krasnodar", version: "osm-2026-09-28+gar-2026-09-28", builtAt: BUILT }];
  db.queries = 0;
  db.fail = false;
});

afterEach(() => vi.useRealTimers());

describe("getCitiesGeo", () => {
  it("gives every active city its region, centre and data token", async () => {
    const geo = await getCitiesGeo();
    const token = geoDataToken("krasnodar", { version: "osm-2026-09-28+gar-2026-09-28", builtAt: "2026-09-29T23:28:19Z" });
    expect(geo.get("krasnodar")).toEqual({ region: "krasnodar", centre: { lat: 45.0351532, lon: 38.9772396 }, token });
    // Пригород — тот же регион и та же метка, но свой центр.
    expect(geo.get("yablonovskiy")).toEqual({ region: "krasnodar", centre: { lat: 44.9864341, lon: 38.9382841 }, token });
  });

  it("a city without region, without an import or without a centre has no geodata", async () => {
    const geo = await getCitiesGeo();
    expect(geo.get("kazan")).toBeNull();
    expect(geo.get("sochi")).toBeNull();
    expect(geo.get("maykop")).toBeNull();
    expect(geo.has("moskva")).toBe(false);
  });

  it("is cached for a minute and dropped by invalidateCitiesGeo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    const a = await getCitiesGeo();
    const queries = db.queries;
    expect(await getCitiesGeo()).toBe(a);
    expect(db.queries).toBe(queries);

    vi.setSystemTime(new Date(Date.parse("2026-10-03T12:00:00Z") + CITIES_GEO_TTL_MS + 1));
    expect(await getCitiesGeo()).not.toBe(a);

    const b = await getCitiesGeo();
    invalidateCitiesGeo();
    expect(await getCitiesGeo()).not.toBe(b);
  });

  it("a database error switches geodata off without caching the failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.fail = true;
    expect((await getCitiesGeo()).size).toBe(0);
    db.fail = false;
    expect((await getCitiesGeo()).get("krasnodar")).not.toBeNull();
    spy.mockRestore();
  });

  it("strict mode (the /api/geo/* path) rethrows a database error and caches nothing", async () => {
    db.fail = true;
    await expect(getCitiesGeo({ strict: true })).rejects.toThrow("db down");
    db.fail = false;
    expect((await getCitiesGeo({ strict: true })).get("krasnodar")).not.toBeNull();
  });
});
