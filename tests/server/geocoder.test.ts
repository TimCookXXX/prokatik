// @vitest-environment node
// Свой геокодер на сайте (src/server/geocoder.ts и /api/geo/*): подсказки сразу
// с координатами, обратный геокодер, мини-индекс с ETag. Данные — маленькая
// фикстура (tests/geocoder/fixture.ts) вместо таблиц geo_*; гео-контекст
// городов — мок getCitiesGeo.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FIXTURE } from "../geocoder/fixture";
import type { GeoIndexData } from "@/lib/geocoder/types";
import type { CityGeoContext } from "@/lib/geo/context";

// Копия: сервер отпускает дома из данных после сборки движка (data.houses = []).
const fresh = (over: Partial<GeoIndexData> = {}): GeoIndexData => ({ ...FIXTURE, houses: [...FIXTURE.houses], ...over });
const state = vi.hoisted(() => ({
  data: null as GeoIndexData | null,
  regions: [] as string[],
  dbDown: false,
}));

vi.mock("@/server/geocoder-index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/geocoder-index")>()),
  getGeoIndexData: async (region: string) => {
    state.regions.push(region);
    return region === "krasnodar" ? state.data : null;
  },
}));

const YAB_CENTRE = { lat: 44.988, lon: 38.9475 };
const KRD_CENTRE = { lat: 45.0355, lon: 38.9753 };
const TOKEN = "krasnodar:test";

// Краснодар и Яблоновский — один регион геоданных; Казань без геоданных;
// у Сочи регион задан, но импорта нет.
const citiesGeo = new Map<string, CityGeoContext | null>([
  ["krasnodar", { region: "krasnodar", centre: KRD_CENTRE, token: TOKEN }],
  ["yablonovskiy", { region: "krasnodar", centre: YAB_CENTRE, token: TOKEN }],
  ["kazan", null],
  ["sochi", { region: "sochi", centre: { lat: 43.58, lon: 39.72 }, token: "sochi:x" }],
]);
// Как настоящий getCitiesGeo: сбой БД глушится для страниц, а в strict — летит наверх.
vi.mock("@/server/city", () => ({
  getCitiesGeo: async (opts: { strict?: boolean } = {}) => {
    if (!state.dbDown) return citiesGeo;
    if (opts.strict) throw new Error("db down");
    return new Map();
  },
}));

const geocoder = await import("@/server/geocoder");
const { geoDataToken } = await import("@/server/geocoder-index");
const suggestRoute = await import("@/app/api/geo/suggest/route");
const reverseRoute = await import("@/app/api/geo/reverse/route");
const clientIndexRoute = await import("@/app/api/geo/client-index/route");
const { _resetForTests: resetLimits } = await import("@/lib/rate-limit");

const req = (path: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { headers });
const q = (s: string) => encodeURIComponent(s);

beforeEach(() => {
  state.data = fresh();
  state.regions = [];
  state.dbDown = false;
  geocoder.resetGeocoderEngines();
  resetLimits();
});

describe("server geocoder", () => {
  it("suggests houses with coordinates and precision in one call", async () => {
    const [first] = await geocoder.suggestAddresses("красная 120", "krasnodar");
    expect(first).toMatchObject({ kind: "house", title: "улица Красная, 120", precision: "house" });
    expect(first.lat).toBeCloseTo(45.0348, 3);
    expect(first.lon).toBeCloseTo(39.005, 3);
  });

  it("understands typos and the wrong keyboard layout", async () => {
    expect((await geocoder.suggestAddresses("базовкая 21к1", "krasnodar"))[0]?.subtitle).toMatch(/Яблоновский/);
    expect((await geocoder.suggestAddresses(",fpjdcrfz 21", "krasnodar")).map((h) => h.title)).toContain("улица Базовская, 21");
  });

  it("answers nothing for an unknown city or a one-letter query", async () => {
    expect(await geocoder.suggestAddresses("красная", "moskva")).toEqual([]);
    expect(await geocoder.suggestAddresses("к", "krasnodar")).toEqual([]);
  });

  it("keeps one engine per data version and rebuilds when the data changes", async () => {
    const a = await geocoder.getRegionGeocoder("krasnodar");
    expect(await geocoder.getRegionGeocoder("krasnodar")).toBe(a);
    state.data = fresh({ builtAt: "2026-10-01T00:00:00Z" });
    const b = await geocoder.getRegionGeocoder("krasnodar");
    expect(b).not.toBe(a);
    expect(b!.token).not.toBe(a!.token);
  });

  it("releases house objects after the build but still finds houses", async () => {
    const data = state.data!;
    await geocoder.getRegionGeocoder("krasnodar");
    expect(data.houses).toEqual([]);
    expect((await geocoder.suggestAddresses("чукотская 23к2", "krasnodar"))[0]?.title).toBe("улица Чукотская, 23к2");
  });

  it("reverse-geocodes a point next to a house", async () => {
    const h = FIXTURE.houses.find((x) => x.number === "120")!;
    const hit = await geocoder.reverseGeocode({ lat: h.lat + 0.0001, lon: h.lon }, "krasnodar");
    expect(hit).toMatchObject({ kind: "house", title: "улица Красная, 120" });
  });
});

describe("region of the city", () => {
  // Яблоновский — свой город в inrenta, но данные у него краснодарские: один
  // движок на регион, а не на город.
  it("serves a suburb from its region's engine", async () => {
    const [hit] = await geocoder.suggestAddresses("базовская 21к1", "yablonovskiy");
    expect(hit).toMatchObject({ title: "улица Базовская, 21к1" });
    expect(hit.subtitle).toMatch(/Яблоновский/);
    expect(state.regions.every((r) => r === "krasnodar")).toBe(true);
    // Движок тот же, что у Краснодара.
    const engine = await geocoder.getRegionGeocoder("krasnodar");
    await geocoder.suggestAddresses("красная", "krasnodar");
    expect(await geocoder.getRegionGeocoder("krasnodar")).toBe(engine);
  });

  // Без near движок взял бы центр самого крупного пункта индекса — Краснодара,
  // и в Яблоновском одноимённая краснодарская улица выигрывала бы.
  it("ranks from the centre of the requesting city when near is not given", async () => {
    const [inKrd] = await geocoder.suggestAddresses("базовская", "krasnodar");
    const [inYab] = await geocoder.suggestAddresses("базовская", "yablonovskiy");
    expect(inKrd.subtitle).not.toMatch(/Яблоновский/);
    expect(inYab.subtitle).toMatch(/Яблоновский/);
  });

  it("an explicit near wins over the city centre", async () => {
    const [hit] = await geocoder.suggestAddresses("вишнёвая 5", "yablonovskiy", { near: { lat: 45.13, lon: 39.05 } });
    expect(hit.subtitle).toMatch(/Кубаночка/);
  });

  it("a city without geodata answers [] / null and does not load anything", async () => {
    expect(await geocoder.suggestAddresses("красная 120", "kazan")).toEqual([]);
    expect(await geocoder.reverseGeocode(KRD_CENTRE, "kazan")).toBeNull();
    expect(await geocoder.clientIndexJson("kazan")).toBeNull();
    expect(state.regions).toEqual([]);
  });

  it("a region without an import answers [] / null", async () => {
    expect(await geocoder.suggestAddresses("красная 120", "sochi")).toEqual([]);
    expect(await geocoder.reverseGeocode({ lat: 43.58, lon: 39.72 }, "sochi")).toBeNull();
    expect(await geocoder.clientIndexJson("sochi")).toBeNull();
  });

  it("the engine token is the one getCitiesGeo would compute from geo_imports", async () => {
    const engine = await geocoder.getRegionGeocoder("krasnodar");
    expect(engine!.token).toBe(geoDataToken("krasnodar", FIXTURE));
    expect(engine!.token).toMatch(/^krasnodar:/);
  });
});

describe("/api/geo/suggest", () => {
  it("returns hits with coordinates", async () => {
    const res = await suggestRoute.GET(req(`/api/geo/suggest?city=krasnodar&q=${q("красная 120")}`));
    expect(res.status).toBe(200);
    // Только браузер: в адресе бывает точка пользователя (near).
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    const { items } = await res.json();
    expect(items[0]).toMatchObject({ title: "улица Красная, 120", precision: "house" });
    expect(typeof items[0].lat).toBe("number");
  });

  it("rejects a bad or missing city and limits the request rate", async () => {
    expect((await suggestRoute.GET(req("/api/geo/suggest?city=%3Cx%3E&q=abc"))).status).toBe(400);
    expect((await suggestRoute.GET(req("/api/geo/suggest?q=abc"))).status).toBe(400);
    let last = 200;
    for (let i = 0; i < 301; i++) {
      last = (await suggestRoute.GET(req("/api/geo/suggest?city=krasnodar&q=kr", { "x-forwarded-for": "1.2.3.4" }))).status;
    }
    expect(last).toBe(429);
    // Другой адрес лимит не делит.
    expect((await suggestRoute.GET(req("/api/geo/suggest?city=krasnodar&q=kr", { "x-forwarded-for": "5.6.7.8" }))).status).toBe(200);
  });

  it("uses near to rank namesakes", async () => {
    const res = await suggestRoute.GET(req(`/api/geo/suggest?city=krasnodar&q=${q("вишнёвая 5")}&near=45.13,39.05`));
    const { items } = await res.json();
    expect(items[0].subtitle).toMatch(/Кубаночка/);
  });

  it("without near ranks from the city's centre", async () => {
    const res = await suggestRoute.GET(req(`/api/geo/suggest?city=yablonovskiy&q=${q("базовская")}`));
    const { items } = await res.json();
    expect(items[0].subtitle).toMatch(/Яблоновский/);
  });

  it("a city without geodata gets an empty list", async () => {
    const res = await suggestRoute.GET(req(`/api/geo/suggest?city=kazan&q=${q("красная")}`));
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });
});

describe("/api/geo/reverse", () => {
  it("validates the point", async () => {
    expect((await reverseRoute.GET(req("/api/geo/reverse?city=krasnodar&lat=abc&lon=1"))).status).toBe(400);
    expect((await reverseRoute.GET(req("/api/geo/reverse?city=krasnodar&lat=95&lon=1"))).status).toBe(400);
    expect((await reverseRoute.GET(req("/api/geo/reverse?lat=45&lon=39"))).status).toBe(400);
  });

  it("returns the nearest address", async () => {
    const h = FIXTURE.houses.find((x) => x.number === "21к1")!;
    const res = await reverseRoute.GET(req(`/api/geo/reverse?city=yablonovskiy&lat=${h.lat}&lon=${h.lon}`));
    expect((await res.json()).hit).toMatchObject({ kind: "house", title: "улица Базовская, 21к1" });
  });

  it("is rate-limited as geo", async () => {
    let last = 200;
    for (let i = 0; i < 301; i++) {
      last = (await reverseRoute.GET(req("/api/geo/reverse?city=krasnodar&lat=45&lon=39", { "x-forwarded-for": "9.9.9.9" }))).status;
    }
    expect(last).toBe(429);
  });
});

describe("/api/geo/client-index", () => {
  it("serves the mini index with an ETag and 304 on revalidation", async () => {
    const token = geoDataToken("krasnodar", FIXTURE);
    const res = await clientIndexRoute.GET(req(`/api/geo/client-index?city=krasnodar&v=${q(token)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe(`"${token}"`);
    expect(res.headers.get("cache-control")).toContain("immutable");
    const body = await res.json();
    expect(body.streets.length).toBe(FIXTURE.streets.length);
    expect(JSON.stringify(body)).not.toContain("21к1"); // без домов
    // выборка производной от OSM базы раздаётся по ODbL: лицензия и источники — в самих данных
    expect(body.license).toMatch(/^ODbL-1\.0/);
    expect(body.attribution).toContain("OpenStreetMap");
    expect(body.attribution).toContain("ГАР ФНС");
    expect(res.headers.get("link")).toContain('rel="license"');

    const again = await clientIndexRoute.GET(req("/api/geo/client-index?city=krasnodar", { "if-none-match": `"${token}"` }));
    expect(again.status).toBe(304);
    expect(again.headers.get("cache-control")).not.toContain("immutable");
  });

  it("is one per region: a suburb gets the same index and token", async () => {
    const a = await clientIndexRoute.GET(req("/api/geo/client-index?city=krasnodar"));
    const b = await clientIndexRoute.GET(req("/api/geo/client-index?city=yablonovskiy"));
    expect(b.headers.get("etag")).toBe(a.headers.get("etag"));
    expect(await b.text()).toBe(await a.text());
  });

  it("a stale v is served but not cached forever", async () => {
    const res = await clientIndexRoute.GET(req("/api/geo/client-index?city=krasnodar&v=krasnodar:old"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("must-revalidate");
  });

  it("404 when the city has no addresses, 400 for a bad city", async () => {
    expect((await clientIndexRoute.GET(req("/api/geo/client-index?city=kazan"))).status).toBe(404);
    expect((await clientIndexRoute.GET(req("/api/geo/client-index?city=..%2F"))).status).toBe(400);
  });
});

describe("/api/geo/* when the database is down", () => {
  it("answers an uncached 503, not a cached «no addresses»", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.dbDown = true;
    const s = await suggestRoute.GET(req(`/api/geo/suggest?city=krasnodar&q=${q("красная 120")}`));
    expect(s.status).toBe(503);
    expect(s.headers.get("cache-control") ?? "").not.toMatch(/public|max-age=[1-9]/);
    expect((await reverseRoute.GET(req("/api/geo/reverse?city=krasnodar&lat=45.03&lon=38.97"))).status).toBe(503);
    expect((await clientIndexRoute.GET(req("/api/geo/client-index?city=krasnodar"))).status).toBe(503);
    spy.mockRestore();
  });
});
