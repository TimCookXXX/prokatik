// @vitest-environment node
// Город объявления по адресу (решение 2026-10-03): пункты адреса из движка
// (Geocoder.settlementOf) и выбор города сервиса по ним (listingCityOf).
// Данные — фикстура движка: Краснодар с микрорайоном Юбилейный, Яблоновский,
// Новая Адыгея и СНТ Кубаночка — оба без города над ними.
import { describe, expect, it } from "vitest";
import { FIXTURE } from "../geocoder/fixture";
import { buildClientIndex, createClientGeocoder, createGeocoder } from "@/lib/geocoder";
import type { GeoIndexData, HitSettlement } from "@/lib/geocoder/types";
import { hitLabel, listingCityOf, publicLabel } from "@/lib/geo/address";

const data = (): GeoIndexData => ({ ...FIXTURE, places: [...FIXTURE.places], houses: [...FIXTURE.houses] });
const server = createGeocoder(data());
const client = createClientGeocoder(buildClientIndex(data()));

const KRD = { id: "krd", name: "Краснодар", nameLocative: "Краснодаре", centre: { lat: 45.0355, lon: 38.9753 } };
const YAB = { id: "yab", name: "Яблоновский", nameLocative: "Яблоновском", centre: { lat: 44.988, lon: 38.9475 } };
const CITIES = [KRD, YAB];

const settlementOf = (q: string, pick: (h: { title: string; subtitle: string; kind: string }) => boolean = () => true) => {
  const hit = server.suggest(q, { near: KRD.centre, limit: 10 }).find(pick)!;
  return { hit, settlement: server.settlementOf(hit) };
};

describe("Geocoder.settlementOf", () => {
  it("skips microdistricts: a Krasnodar microdistrict and a POI belong to Krasnodar", () => {
    const yub = settlementOf("юмр", (h) => h.title === "Юбилейный");
    expect(yub.settlement?.names).toEqual(["Краснодар"]);
    const mall = settlementOf("галерея", (h) => h.kind === "poi");
    expect(mall.settlement?.names).toEqual(["Краснодар"]);
  });

  it("takes the house's own place and the street's place", () => {
    const house = settlementOf("базовская 21к1");
    expect(house.hit).toMatchObject({ kind: "house", title: "улица Базовская, 21к1" });
    expect(house.settlement).toMatchObject({ names: ["Яблоновский"], lat: 44.988, lon: 38.9475 });
    const sad = settlementOf("садовая новая адыгея", (h) => h.subtitle.startsWith("Новая Адыгея"));
    expect(sad.settlement?.names).toEqual(["Новая Адыгея"]);
  });

  it("lists every place up the hierarchy, from the SNT to the city above it", () => {
    const g = createGeocoder({
      ...data(),
      places: data().places.map((p) => (p.id === "p-kub" ? { ...p, parentId: "p-krd" } : p)),
    });
    const [snt] = g.suggest("снт кубаночка", { near: KRD.centre });
    expect(g.settlementOf(snt)).toMatchObject({ names: ["СНТ Кубаночка", "Краснодар"], kinds: ["snt", "city"], lat: 45.0355, lon: 38.9753 });
  });

  // Мини-индекс браузера: свои id, тот же ответ — по ним форма показывает город до сохранения.
  it("comes with the browser mini-index hits under their own ids", () => {
    const yub = client.suggest("юмр", { near: KRD.centre }).find((h) => h.title === "Юбилейный")!;
    expect(yub.id).toMatch(/^c/);
    expect(yub.settlement?.names).toEqual(["Краснодар"]);
  });

  it("falls back to the place by the point for an id it does not know", () => {
    expect(server.settlementOf({ id: "cs0", lat: 44.9885, lon: 38.948 })?.names).toEqual(["Яблоновский"]);
    expect(server.settlementOf({ id: "x", lat: 60, lon: 30 })).toBeNull();
  });
});

describe("listingCityOf", () => {
  const at = (names: string[], lat: number, lon: number): HitSettlement => ({ names, kinds: names.map(() => "village"), lat, lon });

  it("picks the city named like the address's place, even far from its centre", () => {
    // Окраина Краснодара ближе к центру Яблоновского — город всё равно по имени.
    expect(listingCityOf(at(["Краснодар"], 45.0355, 38.9753), { lat: 44.995, lon: 38.95 }, CITIES)).toBe(KRD);
    expect(listingCityOf(at(["Яблоновский"], 44.988, 38.9475), { lat: 44.99, lon: 38.95 }, CITIES)).toBe(YAB);
  });

  it("matches names normalised and by the locative case", () => {
    expect(listingCityOf(at(["яблоновский"], 44.988, 38.9475), KRD.centre, CITIES)).toBe(YAB);
    expect(listingCityOf(at(["Краснодаре"], 0, 0), YAB.centre, CITIES)).toBe(KRD);
  });

  it("takes the first named city up the hierarchy", () => {
    expect(listingCityOf(at(["СНТ Кубаночка", "Краснодар"], 45.0355, 38.9753), YAB.centre, CITIES)).toBe(KRD);
  });

  // Козет, Новая Адыгея, Энем — не города сервиса: к ближайшему по центру
  // пункта, а не по самой точке, чтобы весь посёлок отходил к одному городу.
  it("attaches a settlement that is not a city to the nearest city by its centre", () => {
    const na = at(["Новая Адыгея"], 45.025, 38.938);
    expect(listingCityOf(na, { lat: 44.99, lon: 38.948 }, CITIES)).toBe(KRD);
    expect(listingCityOf(at(["Энем"], 44.9231, 38.9071), KRD.centre, CITIES)).toBe(YAB);
    // Пункта нет вовсе — по точке.
    expect(listingCityOf(null, { lat: 44.99, lon: 38.948 }, CITIES)).toBe(YAB);
  });

  it("breaks an exact tie the same way whatever the order of cities", () => {
    const a = { id: "a", name: "Альфа", centre: { lat: 45, lon: 39.01 } };
    const b = { id: "b", name: "Бета", centre: { lat: 45, lon: 38.99 } };
    const mid = { lat: 45, lon: 39 };
    expect(listingCityOf(null, mid, [a, b])).toBe(a);
    expect(listingCityOf(null, mid, [b, a])).toBe(a);
  });

  it("skips cities without a centre and gives null when none has one", () => {
    const blind = { id: "z", name: "Зеро", centre: null };
    expect(listingCityOf(null, KRD.centre, [blind, YAB])).toBe(YAB);
    expect(listingCityOf(null, KRD.centre, [blind])).toBeNull();
  });
});

describe("publicLabel and hitLabel: the real place of an object or microdistrict", () => {
  // Подпись называет свой пункт, а не город объявления: «Мега» — в Новой
  // Адыгее, даже когда объявление отошло Краснодару.
  it("names the hit's own place whatever the listing's city", () => {
    const mega = { kind: "place" as const, title: "Мега", parts: { place: "Мега", street: null, house: null }, settlement: at(["Новая Адыгея"]) };
    for (const city of ["Краснодар", "Новая Адыгея"]) {
      expect(publicLabel(mega, city)).toBe("Мега, Новая Адыгея");
      expect(hitLabel(mega, city)).toBe("Мега, Новая Адыгея");
    }
    expect(publicLabel({ ...mega, kind: "poi", title: "ЖК Радуга", settlement: at(["Краснодар"]) }, "Краснодар")).toBe("ЖК Радуга, Краснодар");
  });

  it("does not repeat a place already in the title, names the one above it", () => {
    expect(publicLabel({ kind: "place", title: "Новая Адыгея", settlement: at(["Новая Адыгея"]) }, "Краснодар")).toBe("Новая Адыгея");
    expect(publicLabel({ kind: "place", title: "Лазурный, 1-е отделение", settlement: at(["Лазурный", "Краснодар"]) }, "Краснодар"))
      .toBe("Лазурный, 1-е отделение, Краснодар");
  });

  // Пункт — из движка (settlementOf): микрорайон пропущен, подпись — «Юбилейный, Краснодар».
  it("labels real engine hits with their settlement", () => {
    const yub = settlementOf("юмр", (h) => h.title === "Юбилейный");
    expect(publicLabel({ ...yub.hit, settlement: yub.settlement ?? undefined }, "Яблоновский")).toBe("Юбилейный, Краснодар");
    const house = settlementOf("базовская 21к1");
    expect(publicLabel({ ...house.hit, settlement: house.settlement ?? undefined }, "Краснодар")).toBe("улица Базовская, Яблоновский");
  });

  function at(names: string[]): HitSettlement {
    return { names, kinds: names.map(() => "village"), lat: 45, lon: 39 };
  }
});
