// Набор по буквам, частичные номера, одноимённые улицы, обратное геокодирование, причины отказа geocode,
// клиентский мини-индекс.

import { describe, expect, it } from "vitest";
import { buildClientIndex, createClientGeocoder, createGeocoder, GEOCODE_MESSAGES } from "@/lib/geocoder";
import { haversineKm } from "@/lib/geo/point";
import { tokenize } from "@/lib/geocoder/query";
import type { GeoIndexData } from "@/lib/geocoder/types";
import { FIXTURE, KRD_CENTER } from "./fixture";

const g = createGeocoder(FIXTURE);
const near = KRD_CENTER;
const lines = (q: string, limit = 5) => g.suggest(q, { near, limit }).map((h) => `${h.title} — ${h.subtitle}`);
const titles = (q: string, limit = 5) => g.suggest(q, { near, limit }).map((h) => h.title);

describe("разбор недонабранного номера", () => {
  it("«125/», «23 корп», «6 стр» — начало номера для подсказок", () => {
    expect(tokenize("Крупской 125/").at(-1)).toMatchObject({ kind: "n", text: "125", partial: "125/", prefix: true });
    expect(tokenize("Чукотская 23 корп").at(-1)).toMatchObject({ text: "23", partial: "23к" });
    expect(tokenize("Кондратенко 6 стр").at(-1)).toMatchObject({ text: "6", partial: "6с" });
    // запрос закончен (пробел или запятая в конце) — номер целый
    expect(tokenize("Крупской 125/ ").at(-1)?.partial).toBeUndefined();
  });

  it("род порядкового числа: «1-я» — f, «1-й» — m, «1-е» — n", () => {
    expect(tokenize("1-я Заречная")[0]).toMatchObject({ kind: "o", gender: "f" });
    expect(tokenize("1-й Заречный")[0]).toMatchObject({ kind: "o", gender: "m" });
    expect(tokenize("1-е отделение")[0]).toMatchObject({ kind: "o", gender: "n" });
  });
});

describe("набор по буквам", () => {
  it("улица появляется по первым буквам", () => {
    for (const q of ["Став", "Ставр", "Ставроп", "ул Ставр", "улица Ставропольск"]) expect(titles(q)[0], q).toBe("улица Ставропольская");
    expect(titles("Круп")[0]).toBe("улица Крупской");
  });

  it("первое слово многословного названия: «Никол» → «Николая Кондратенко» в подсказках", () => {
    expect(titles("Никол")).toEqual(expect.arrayContaining(["улица Николая Кондратенко", "улица Николаевская"]));
    expect(titles("Николая")[0]).toBe("улица Николая Кондратенко");
    expect(titles("Николая К")[0]).toBe("улица Николая Кондратенко");
  });

  it("порядковое с родом: «1-я Заречн» — улица, «1-й Заречн» — проезд", () => {
    expect(titles("1-я Заречн")[0]).toBe("улица 1-я Заречная");
    expect(titles("1-й Заречн")[0]).toBe("1-й Заречный проезд");
  });

  it("недонабранное слово, которому ничего не подошло, не отдаёт первое место чужой улице", () => {
    // «1-й Л» — «1-й Линейный проезд», а не любой «1-й …»
    expect(titles("1-й Ли")[0]).toBe("1-й Линейный проезд");
  });

  it("номер набирается: дома с этим началом", () => {
    // «Ставропольская 10» — дома 100…110 этой улицы
    const t = titles("Ставропольская 10");
    expect(t.slice(0, 3)).toEqual(expect.arrayContaining(["улица Ставропольская, 100", "улица Ставропольская, 101", "улица Ставропольская, 102"]));
  });

  it("номер оборван на «/»: сначала дроби, дом без дроби — ниже", () => {
    const t = titles("Крупской 125/");
    expect(t.slice(0, 3)).toEqual(["улица Крупской, 125/1", "улица Крупской, 125/2", "улица Крупской, 125/3"]);
    expect(t.indexOf("улица Крупской, 125")).toBeGreaterThan(2);
  });

  it("корпус и строение набираются: «23 к», «23 корп», «6 стр» → «23к1», «6с1»", () => {
    expect(titles("Чукотская 23 к")[0]).toBe("улица Чукотская, 23к1");
    expect(titles("Чукотская 23 корп").slice(0, 2)).toEqual(["улица Чукотская, 23к1", "улица Чукотская, 23к2"]);
    expect(titles("Николая Кондратенко 6 стр").slice(0, 2)).toEqual(["улица Николая Кондратенко, 6с1", "улица Николая Кондратенко, 6с2"]);
    // «≈23К» не выдумывается, когда есть настоящие корпуса
    expect(titles("Чукотская 23 к").some((x) => x.includes("≈"))).toBe(false);
  });

  it("опечатка в первых трёх буквах — запасной ход вместо пустого списка", () => {
    expect(g.suggest("Сьа", { near }).length).toBeGreaterThan(0); // «Сьа…» — хоть что-то на «Ста…/Са…»
  });
});

describe("одноимённые улицы без пункта", () => {
  it("«Вишнёвая 5»: все варианты в пятёрке, подписи различимы, ближайший к near первым", () => {
    const l = lines("Вишнёвая 5");
    expect(l.slice(0, 2)).toEqual(expect.arrayContaining(["улица Вишнёвая, 5 — Краснодар", "улица Вишнёвая, 5 — СНТ Кубаночка"]));
    expect(l[0]).toBe("улица Вишнёвая, 5 — Краснодар");
    expect(new Set(l).size).toBe(l.length);
    const nearSnt = g.suggest("Вишнёвая 5", { near: { lat: 45.13, lon: 39.05 } })[0];
    expect(nearSnt.subtitle).toBe("СНТ Кубаночка");
  });

  it("«≈» ниже настоящего дома тёзки в другом пункте", () => {
    // «Базовская 23»: дом 23 есть только в Яблоновском; в Краснодаре — лишь «≈23»
    const l = lines("Базовская 23 ");
    expect(l[0]).toBe("улица Базовская, 23 — Яблоновский");
  });
});

describe("обратное геокодирование", () => {
  it("рядом дом (≤ 60 м) — дом", () => {
    const h120 = FIXTURE.houses.find((x) => x.streetId === "s-krasnaya" && x.number === "120")!;
    const h = g.reverse(h120.lat + 0.0002, h120.lon)!; // ≈ 22 м
    expect(h.kind).toBe("house");
    expect(h.title).toBe("улица Красная, 120");
    expect(h.parts).toEqual({ place: "Краснодар", street: "улица Красная", house: "120" });
    expect(h.lat).toBe(h120.lat);
  });

  it("дом дальше 60 м — улица, точка — переданная", () => {
    const h120 = FIXTURE.houses.find((x) => x.streetId === "s-krasnaya" && x.number === "120")!;
    const at = { lat: h120.lat + 0.0011, lon: h120.lon }; // ≈ 120 м
    const h = g.reverse(at.lat, at.lon)!;
    expect(h.kind).toBe("street");
    expect(h.title).toBe("улица Красная");
    expect(h.precision).toBe("street");
    expect(h).toMatchObject(at);
  });

  it("вне улиц — пункт; далеко от всего — null", () => {
    const h = g.reverse(44.97, 38.9475)!; // южнее Яблоновского, домов рядом нет
    expect(h.kind).toBe("place");
    expect(h.parts?.place).toBe("Яблоновский");
    expect(g.reverse(46.5, 41)).toBeNull();
    expect(g.reverse(Number.NaN, 38.9)).toBeNull();
  });

  it("радиус дома настраивается", () => {
    const h120 = FIXTURE.houses.find((x) => x.streetId === "s-krasnaya" && x.number === "120")!;
    expect(g.reverse(h120.lat + 0.0002, h120.lon, { houseM: 10 })?.kind).toBe("street");
  });
});

describe("geocode для импорта: причина отказа", () => {
  it("пункт не назван, адрес есть в двух пунктах — «уточните пункт» и варианты", () => {
    const r = g.geocodeDetailed("Садовая 3", { near });
    expect(r.hit).toBeNull();
    expect(r.reason).toBe("ambiguous_place");
    expect(r.message).toBe(GEOCODE_MESSAGES.ambiguous_place);
    expect(r.alternatives.map((h) => h.subtitle)).toEqual(expect.arrayContaining(["Яблоновский", "Новая Адыгея"]));
    expect(g.geocodeDetailed("Садовая 3, Новая Адыгея", { near }).hit?.subtitle).toBe("Новая Адыгея");
  });

  it("однозначный адрес — ответ без причины", () => {
    const r = g.geocodeDetailed("г. Краснодар, ул. Красная, 120", { near });
    expect(r.reason).toBeNull();
    expect(r.hit?.title).toBe("улица Красная, 120");
  });

  it("пустой, ненайденный, чужой пункт", () => {
    expect(g.geocodeDetailed("  ").reason).toBe("empty");
    expect(g.geocodeDetailed("Зеленоградская 5", { near }).reason).not.toBeNull();
    expect(g.geocodeDetailed("Ставропольская 100, Яблоновский", { near }).reason).toBe("place_mismatch");
    expect(g.geocode("Садовая 3", { near })).toBeNull(); // geocode — тот же ответ без причины
  });
});

describe("клиентский мини-индекс", () => {
  const ci = buildClientIndex(FIXTURE);
  const cg = createClientGeocoder(JSON.parse(JSON.stringify(ci)));

  it("без домов и компактный", () => {
    expect(ci.streets).toHaveLength(FIXTURE.streets.length);
    expect(JSON.stringify(ci)).not.toContain("21к1");
    expect(ci.version).toBe(FIXTURE.version);
  });

  it("улицы, пункты и объекты — как на сервере", () => {
    for (const q of ["Став", "Базовская", "ЮМР", "Яблоновский", "Галерея", "Никол", "rhfcyfz", "Вишнёвая"]) {
      const a = cg.suggest(q, { near }).map((h) => `${h.title} — ${h.subtitle}`);
      const b = g.suggest(q, { near }).map((h) => `${h.title} — ${h.subtitle}`);
      expect(a, q).toEqual(b);
    }
  });

  it("запрос с номером — улица с точкой улицы (дом догрузит сервер), без выдуманного «≈»", () => {
    const h = cg.suggest("Красная 120", { near })[0];
    expect(h.kind).toBe("street");
    expect(h.title).toBe("улица Красная");
    expect(h.id.startsWith("c")).toBe(true);
    const st = FIXTURE.streets.find((s) => s.id === "s-krasnaya")!;
    expect(haversineKm(h, st)).toBeLessThan(0.01);
  });
});

describe("набор по буквам: улицы и пункты выше объектов", () => {
  // Красная — главная улица (много домов), рядом тёзки поменьше и объекты, чьи названия или синонимы
  // начинаются так же: «ТРЦ Красная Площадь», «Учебный корпус КубГТУ» (синоним «Женская учительская
  // семинария» → сокращение «женус»; у КубГТУ — «Краснодарский политехнический институт»).
  const extraHouses = Array.from({ length: 120 }, (_, i) => ({
    streetId: "s-krasnaya", placeId: "p-krd", number: String(i + 1), lat: 45.03 + i * 0.0001, lon: 38.97,
    precision: "house" as const, source: "osm" as const,
  }));
  const small = (id: string, name: string, lat: number, lon: number, n = 3) => ({
    street: { id, placeId: "p-krd", name, type: "улица", aliases: [], lat, lon, houses: n },
    houses: Array.from({ length: n }, (_, i) => ({ streetId: id, placeId: "p-krd", number: String(i + 1), lat, lon: lon + i * 0.0003, precision: "house" as const, source: "osm" as const })),
  });
  const more = [
    small("s-krasina", "улица Красина", 45.013, 38.963),
    small("s-krasnoarm", "улица Красноармейская", 45.029, 38.974),
    small("s-zhel", "улица Железнодорожная", 45.022, 38.99, 20),
    small("s-zhemch", "улица Жемчужная", 45.12, 38.99),
  ];
  const data: GeoIndexData = {
    ...FIXTURE,
    streets: [...FIXTURE.streets, ...more.map((m) => m.street)],
    // «Базовская, 21» есть и в Яблоновском — дом ГАР с точкой «≈» (как в данных)
    houses: [
      ...FIXTURE.houses, ...extraHouses, ...more.flatMap((m) => m.houses),
      { streetId: "s-baz-yab", placeId: "p-yab", number: "21", lat: 45.0106, lon: 38.9363, precision: "street" as const, source: "gar" as const },
    ],
    pois: [
      ...(FIXTURE.pois ?? []),
      { id: "o-krpl", name: "ТРЦ Красная Площадь", kind: "mall", aliases: ["Красная Площадь"], placeId: "p-krd", lat: 45.102, lon: 38.9842, address: "улица Дзержинского, 100" },
      { id: "o-kubgtu", name: "Кубанский государственный технологический университет", kind: "university", aliases: ["КубГТУ", "Краснодарский политехнический институт"], placeId: "p-krd", lat: 45.0433, lon: 38.9756, address: "улица Красная, 135" },
      { id: "o-uk", name: "Учебный корпус КубГТУ", kind: "university", aliases: ["Женская учительская семинария"], placeId: "p-krd", lat: 45.041, lon: 38.9769, address: "улица Красная, 166" },
    ],
  };
  const gg = createGeocoder(data);
  const cg = createClientGeocoder(JSON.parse(JSON.stringify(buildClientIndex(data))));
  const top = (q: string, at = near) => gg.suggest(q, { near: at, limit: 5 });

  it("«кра», «крас», «красная» → первой улица Красная, а не пункт или объект", () => {
    for (const q of ["кра", "крас", "красн", "красная"]) {
      const h = top(q)[0];
      expect(`${h.title} — ${h.subtitle}`, q).toBe("улица Красная — Краснодар");
    }
  });

  it("короткое начало — без случайных объектов: «же» не даёт КубГТУ, «кра» — университет", () => {
    for (const q of ["же", "жел"]) {
      const t = top(q).map((h) => h.title);
      expect(t[0], q).toBe("улица Железнодорожная");
      expect(t.some((x) => x.includes("КубГТУ")), q).toBe(false);
    }
    expect(top("кра").some((h) => h.kind === "poi")).toBe(false);
  });

  it("объект, названный целиком, — первым: «красная площадь», сокращение «кубгту», «галерея»", () => {
    expect(top("красная площадь")[0]).toMatchObject({ kind: "poi", title: "ТРЦ Красная Площадь" });
    expect(top("кубгту")[0].title).toBe("Кубанский государственный технологический университет");
    expect(top("галерея")[0].title).toBe("ТЦ Галерея");
  });

  it("мини-индекс браузера ранжирует так же", () => {
    for (const q of ["кр", "кра", "крас", "красная", "же", "жел", "красная площадь", "кубгту"]) {
      expect(cg.suggest(q, { near }).map((h) => `${h.title} — ${h.subtitle}`), q).toEqual(gg.suggest(q, { near }).map((h) => `${h.title} — ${h.subtitle}`));
    }
  });

  it("«базовская 21»: без места — Краснодар, у Яблоновского — Яблоновский", () => {
    expect(top("базовская 21")[0].subtitle).toBe("Краснодар");
    const yab = { lat: 44.988, lon: 38.9475 }; // выбран посёлок — его центр
    expect(top("базовская 21", yab)[0].subtitle).toBe("Яблоновский");
  });
});
