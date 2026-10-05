// @vitest-environment node
// Адрес объявления на сервере (src/server/listing-address.ts): выбранная в
// браузере подсказка находится заново у сервера по виду, тексту и точке, а
// записывается всё из серверного хита. Данные — фикстура движка
// (tests/geocoder/fixture.ts) вместо таблиц geo_*; города и их гео-контекст —
// моки.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE } from "../geocoder/fixture";
import { buildClientIndex, createClientGeocoder } from "@/lib/geocoder";
import type { AddressHit, GeoIndexData } from "@/lib/geocoder/types";
import type { CityGeoContext } from "@/lib/geo/context";
import type { PickedAddress } from "@/lib/owner/validation";

// Округ и пункт за 60 км — для отказов «весь округ» и «далеко от города».
const extraPlaces: GeoIndexData["places"] = [
  { id: "p-zap", name: "Западный", kind: "okrug", aliases: ["Западный округ"], parentId: "p-krd", lat: 45.04, lon: 38.95 },
  { id: "p-far", name: "Дальний", kind: "village", aliases: [], parentId: null, lat: 45.6, lon: 38.9 },
];
const fresh = (): GeoIndexData => ({
  ...FIXTURE, places: [...FIXTURE.places, ...extraPlaces], houses: [...FIXTURE.houses],
});

const state = vi.hoisted(() => ({
  data: null as GeoIndexData | null,
  geoDown: false,
  engineDown: false,
  geocoderCalls: 0,
}));

vi.mock("@/server/geocoder-index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/geocoder-index")>()),
  getGeoIndexData: async (region: string) => {
    state.geocoderCalls += 1;
    if (state.engineDown) throw new Error("db down");
    return region === "krasnodar" ? state.data : null;
  },
}));

const KRD_CENTRE = { lat: 45.0355, lon: 38.9753 };
const YAB_CENTRE = { lat: 44.988, lon: 38.9475 };
const citiesGeo = new Map<string, CityGeoContext | null>([
  ["krasnodar", { region: "krasnodar", centre: KRD_CENTRE, token: "krasnodar:test" }],
  ["yablonovskiy", { region: "krasnodar", centre: YAB_CENTRE, token: "krasnodar:test" }],
  ["kazan", null],
  // Регион задан, импорта нет.
  ["sochi", { region: "sochi", centre: { lat: 43.58, lon: 39.72 }, token: "sochi:x" }],
]);
vi.mock("@/server/city", () => ({
  getCitiesGeo: async (opts: { strict?: boolean } = {}) => {
    if (!state.geoDown) return citiesGeo;
    if (opts.strict) throw new Error("db down");
    return new Map();
  },
}));

const CITIES: Record<string, { id: string; slug: string; name: string; nameLocative: string }> = {
  "c-krd": { id: "c-krd", slug: "krasnodar", name: "Краснодар", nameLocative: "Краснодаре" },
  "c-yab": { id: "c-yab", slug: "yablonovskiy", name: "Яблоновский", nameLocative: "Яблоновском" },
  "c-kzn": { id: "c-kzn", slug: "kazan", name: "Казань", nameLocative: "Казани" },
  "c-sochi": { id: "c-sochi", slug: "sochi", name: "Сочи", nameLocative: "Сочи" },
};
vi.mock("@/server/catalog", () => ({
  getCityById: async (id: string) => CITIES[id] ?? null,
  getActiveCities: async () => Object.values(CITIES),
}));

const { resolveListingAddress } = await import("@/server/listing-address");
const { resetGeocoderEngines } = await import("@/server/geocoder");

const client = () => createClientGeocoder(buildClientIndex(fresh()));
const asPick = (h: AddressHit): PickedAddress => ({
  mode: "pick", kind: h.kind, title: h.title, subtitle: h.subtitle, lat: h.lat, lon: h.lon,
});
const create = (input: Parameters<typeof resolveListingAddress>[0], cityId = "c-krd") =>
  resolveListingAddress(input, { cityId, current: null });

beforeEach(() => {
  state.data = fresh();
  state.geoDown = false;
  state.engineDown = false;
  state.geocoderCalls = 0;
  resetGeocoderEngines();
});

describe("resolveListingAddress: pick", () => {
  // R12: у мини-индекса свои id (`cs…`, `cp…`), серверу они неизвестны —
  // сверка идёт по виду, тексту и точке.
  it("accepts a street picked in the browser mini-index by its client id", async () => {
    const hit = client().suggest("красная", { near: KRD_CENTRE })[0];
    expect(hit.id).toMatch(/^c/);
    expect(hit).toMatchObject({ kind: "street", title: "улица Красная" });

    const res = await create(asPick(hit));
    expect(res).toEqual({
      ok: true,
      cityId: "c-krd",
      fields: {
        address: "улица Красная, Краснодар", location: "улица Красная, Краснодар",
        lat: expect.any(Number), lon: expect.any(Number), geoPrecision: "street",
      },
    });
  });

  it("accepts a microdistrict and a POI from the mini-index as place precision", async () => {
    const yub = client().suggest("юмр", { near: KRD_CENTRE }).find((h) => h.title === "Юбилейный")!;
    expect(await create(asPick(yub))).toMatchObject({
      ok: true, fields: { address: "Юбилейный, Краснодар", location: "Юбилейный, Краснодар", geoPrecision: "place" },
    });

    const mall = client().suggest("галерея", { near: KRD_CENTRE }).find((h) => h.kind === "poi")!;
    expect(await create(asPick(mall))).toMatchObject({
      ok: true, fields: { address: "ТЦ Галерея, Краснодар", location: "ТЦ Галерея, Краснодар", geoPrecision: "place" },
    });
  });

  // Дом знает только сервер: полный адрес — владельцу, публично — улица без
  // номера. Пункт адреса — город объявления, поэтому в подписях он не повторяется.
  it("keeps the house number in address but not in the public location", async () => {
    const { suggestAddresses } = await import("@/server/geocoder");
    const [house] = await suggestAddresses("базовская 21к1", "yablonovskiy");
    expect(house).toMatchObject({ kind: "house", title: "улица Базовская, 21к1" });

    expect(await create(asPick(house), "c-yab")).toMatchObject({
      ok: true,
      cityId: "c-yab",
      fields: { address: "улица Базовская, 21к1, Яблоновский", location: "улица Базовская, Яблоновский", geoPrecision: "house" },
    });
  });

  // Город объявления определяет адрес: город формы при выборе подсказки задаёт
  // только регион поиска (решение 2026-10-03).
  it("takes the listing city from the address, not from the form", async () => {
    const { suggestAddresses } = await import("@/server/geocoder");
    const [house] = await suggestAddresses("базовская 21к1", "yablonovskiy");
    expect(await create(asPick(house), "c-krd")).toMatchObject({
      ok: true, cityId: "c-yab", fields: { address: "улица Базовская, 21к1, Яблоновский", location: "улица Базовская, Яблоновский" },
    });

    const krasnaya = client().suggest("красная", { near: KRD_CENTRE })[0];
    expect(await create(asPick(krasnaya), "c-yab")).toMatchObject({ ok: true, cityId: "c-krd" });

    // Микрорайон и объект Краснодара — Краснодар, откуда бы ни искали.
    const yub = client().suggest("юмр", { near: YAB_CENTRE }).find((h) => h.title === "Юбилейный")!;
    expect(await create(asPick(yub), "c-yab")).toMatchObject({ ok: true, cityId: "c-krd" });
    const mall = client().suggest("галерея", { near: YAB_CENTRE }).find((h) => h.kind === "poi")!;
    expect(await create(asPick(mall), "c-yab")).toMatchObject({ ok: true, cityId: "c-krd" });
  });

  // Пункт, который не город сервиса, — к ближайшему городу региона, а в
  // публичной подписи остаётся настоящий пункт.
  it("attaches a neighbouring settlement to the nearest city and keeps its name public", async () => {
    const sad = client().suggest("садовая новая адыгея", { near: KRD_CENTRE })
      .find((h) => h.subtitle.startsWith("Новая Адыгея"))!;
    expect(await create(asPick(sad), "c-yab")).toMatchObject({
      ok: true,
      cityId: "c-krd",
      fields: { address: "улица Садовая, Новая Адыгея", location: "улица Садовая, Новая Адыгея" },
    });

    const na = client().suggest("новая адыгея", { near: YAB_CENTRE }).find((h) => h.kind === "place")!;
    expect(await create(asPick(na), "c-yab")).toMatchObject({
      ok: true, cityId: "c-krd", fields: { location: "Новая Адыгея", geoPrecision: "place" },
    });
  });

  it("writes the server point, not the one the browser sent", async () => {
    const hit = client().suggest("красная", { near: KRD_CENTRE })[0];
    const res = await create({ ...asPick(hit), lat: hit.lat + 0.0002 });   // ≈ 22 м
    expect(res.ok).toBe(true);
    if (!res.ok || !res.fields) return;
    expect(res.fields.lat).toBeCloseTo(hit.lat, 6);
  });

  // Тот же текст с координатами в километре — подмена, а не тот же адрес.
  it("rejects the same text with coordinates moved further than 50 m", async () => {
    const hit = client().suggest("красная", { near: KRD_CENTRE })[0];
    expect(await create({ ...asPick(hit), lat: hit.lat + 0.01 }))
      .toEqual({ ok: false, error: "Выберите адрес из подсказок" });
  });

  it("rejects a hit the server does not know", async () => {
    expect(await create({
      mode: "pick", kind: "street", title: "улица Несуществующая", subtitle: "Краснодар", ...KRD_CENTRE,
    })).toEqual({ ok: false, error: "Выберите адрес из подсказок" });
  });

  it("rejects a whole city or okrug", async () => {
    const krd = client().suggest("краснодар", { near: KRD_CENTRE }).find((h) => h.kind === "place" && h.title === "Краснодар")!;
    expect(await create(asPick(krd))).toEqual({
      ok: false, error: "Уточните адрес — улица, ЖК, микрорайон или посёлок",
    });
    const okrug = client().suggest("западный округ", { near: KRD_CENTRE }).find((h) => h.kind === "place")!;
    expect(okrug.subtitle).toMatch(/^округ/);
    expect(await create(asPick(okrug))).toEqual({
      ok: false, error: "Уточните адрес — улица, ЖК, микрорайон или посёлок",
    });
  });

  it("rejects a point further than 40 km from the city centre", async () => {
    const far = client().suggest("дальний", { near: KRD_CENTRE }).find((h) => h.title === "Дальний")!;
    expect(await create(asPick(far)))
      .toEqual({ ok: false, error: "Адрес дальше 40 км от городов сервиса — такие объявления пока не принимаем" });
  });

  it("says the address search is unavailable when the engine or its data is down", async () => {
    const hit = client().suggest("красная", { near: KRD_CENTRE })[0];
    const unavailable = { ok: false, error: "Поиск адресов временно недоступен, попробуйте позже" };

    state.engineDown = true;
    expect(await create(asPick(hit))).toEqual(unavailable);
    state.engineDown = false;

    state.geoDown = true;
    expect(await create(asPick(hit))).toEqual(unavailable);
    state.geoDown = false;

    // Регион задан, а импорта нет.
    expect(await create(asPick(hit), "c-sochi")).toEqual(unavailable);
    // Город без геоданных: подсказку проверить нечем.
    expect(await create(asPick(hit), "c-kzn")).toEqual(unavailable);
  });
});

describe("resolveListingAddress: text", () => {
  it("takes free text in a city without geodata, without a point", async () => {
    expect(await create({ mode: "text", text: "ул. Баумана" }, "c-kzn")).toEqual({
      ok: true,
      cityId: "c-kzn",
      fields: { address: "ул. Баумана", location: "ул. Баумана", lat: null, lon: null, geoPrecision: "city" },
    });
  });

  it("clips the public label to the column length", async () => {
    const text = "а".repeat(180);
    const res = await create({ mode: "text", text }, "c-kzn");
    expect(res).toMatchObject({ ok: true, fields: { address: text } });
    if (res.ok && res.fields) expect(res.fields.location).toHaveLength(120);
  });

  it("refuses free text where the address can be picked", async () => {
    expect(await create({ mode: "text", text: "Красная 120" }, "c-krd"))
      .toEqual({ ok: false, error: "Выберите адрес из подсказок" });
  });
});

describe("resolveListingAddress: keep", () => {
  const stored = { cityId: "c-krd", address: "улица Красная, 120", geoPrecision: "house" as const };
  const keep = (current: typeof stored | { cityId: string; address: string | null; geoPrecision: "city" } | null, cityId = "c-krd") =>
    resolveListingAddress({ mode: "keep" }, { cityId, current });

  // keep не ходит в геокодер вовсе: точка переживает его недоступность.
  it("leaves a stored point untouched without touching the geocoder", async () => {
    state.engineDown = true;
    state.geoDown = true;
    expect(await keep(stored)).toEqual({ ok: true, fields: null, cityId: "c-krd" });
    expect(state.geocoderCalls).toBe(0);
  });

  it("requires an address on a new listing, a city change or a row without one", async () => {
    const required = { ok: false, error: "Укажите адрес" };
    expect(await keep(null)).toEqual(required);
    expect(await keep(stored, "c-yab")).toEqual(required);
    expect(await keep({ cityId: "c-krd", address: null, geoPrecision: "city" })).toEqual(required);
  });

  // Адрес без точки в городе с геоданными (не найден при backfill) кабинет
  // просит уточнить; в городе без геоданных он и есть нормальный адрес.
  it("asks to refine a point-less address only where one can be picked", async () => {
    expect(await keep({ cityId: "c-krd", address: "ул. Гагарина", geoPrecision: "city" }))
      .toEqual({ ok: false, error: "Укажите адрес" });
    expect(await keep({ cityId: "c-kzn", address: "Казань", geoPrecision: "city" }, "c-kzn"))
      .toEqual({ ok: true, fields: null, cityId: "c-kzn" });
  });
});
