import { describe, expect, it } from "vitest";
import { createGeocoder } from "@/lib/geocoder";
import { haversineKm } from "@/lib/geo/point";
import { FIXTURE, KRD_CENTER } from "./fixture";

const g = createGeocoder(FIXTURE);
const near = KRD_CENTER;
const top = (q: string) => g.suggest(q, { near })[0];
const line = (q: string) => {
  const h = top(q);
  return h ? `${h.title} — ${h.subtitle}` : null;
};

describe("порядок слов, пункт, номер", () => {
  it("«Базовская 21к1 Яблоновский» в любом порядке и написании", () => {
    for (const q of [
      "Базовская 21к1 Яблоновский",
      "пгт Яблоновский, ул Базовская, д. 21 корп 1",
      "Яблоновский Базовская 21 к.1",
      "21к1 Базовская, Яблоновский",
      "ул. Базовская, 21, корпус 1, пгт Яблоновский",
    ]) {
      expect(line(q), q).toBe("улица Базовская, 21к1 — Яблоновский");
      expect(top(q).kind).toBe("house");
      expect(top(q).precision).toBe("house");
    }
  });

  it("дом с номером выше улицы; улица без номера — улица", () => {
    expect(line("красная 120")).toBe("улица Красная, 120 — Краснодар");
    expect(top("красная 120").parts).toEqual({ place: "Краснодар", street: "улица Красная", house: "120" });
    expect(top("Красная").kind).toBe("street");
  });

  it("названный пункт важнее близости: Базовская в Краснодаре и в Яблоновском", () => {
    expect(line("Базовская 21")).toBe("улица Базовская, 21 — Краснодар");
    expect(top("Базовская 21 Яблоновский").subtitle).toBe("Яблоновский");
  });
});

describe("раскладка, транслит, опечатки, падежи", () => {
  it("английская раскладка", () => {
    expect(line(",fpjdcrfz 21r1 zf,kjyjdcrbq")).toBe("улица Базовская, 21к1 — Яблоновский");
    expect(line("Rhfcyfz 120")).toBe("улица Красная, 120 — Краснодар");
  });

  it("транслит", () => {
    expect(line("ulitsa Krasnaya 120")).toBe("улица Красная, 120 — Краснодар");
    expect(line("Stavropolskaya 100")).toBe("улица Ставропольская, 100 — Краснодар");
  });

  it("опечатки до двух букв в словах от 5 букв", () => {
    expect(line("Базовкая 21к1 Яблоновский")).toBe("улица Базовская, 21к1 — Яблоновский");
    expect(line("Ставропльская 100")).toBe("улица Ставропольская, 100 — Краснодар");
    expect(line("Ставорпльская 100")).toBe("улица Ставропольская, 100 — Краснодар");
  });

  it("падежи: «на Красной», «Ставропольской»", () => {
    expect(line("на Красной 120")).toBe("улица Красная, 120 — Краснодар");
    expect(line("Ставропольской 100")).toBe("улица Ставропольская, 100 — Краснодар");
  });

  it("после предлога «-ой» — скорее женский род: «на Кольцевой» — улица, «Кольцевой» — проезд", () => {
    expect(top("на Кольцевой 9").title).toBe("улица Кольцевая, 9");
    expect(top("Кольцевой 9").title).toBe("Кольцевой проезд, 9");
  });

  it("начало слова при наборе", () => {
    expect(top("Ставроп").title).toBe("улица Ставропольская");
    expect(top("Ставорп").title).toBe("улица Ставропольская"); // опечатка в недонабранном слове
  });
});

describe("числа в названиях, титулы, дефисы", () => {
  it("«40 лет Победы» = «40-летия Победы»", () => {
    expect(line("40 лет Победы 12")).toBe("улица 40 лет Победы, 12 — Краснодар");
    expect(line("40-летия Победы, 12")).toBe("улица 40 лет Победы, 12 — Краснодар");
  });

  it("«1 Мая» = «1-го Мая» = «первого Мая»", () => {
    for (const q of ["1 Мая 5", "1-го Мая, 5", "первого мая 5"]) expect(line(q), q).toBe("улица 1 Мая, 5 — Краснодар");
  });

  it("порядковый номер отличает 1-й и 2-й Линейный", () => {
    expect(top("2-й Линейный 3").title).toBe("2-й Линейный проезд, 3");
    expect(top("1-й Линейный").title).toBe("1-й Линейный проезд");
    expect(top("2-й Ли").title).toBe("2-й Линейный проезд");
  });

  it("без титула: «Аверкиева 8» → «улица Героя Аверкиева»", () => {
    expect(top("Аверкиева 8").title).toBe("улица Героя Аверкиева, 8");
  });

  it("дефис: «Кубано-Набережная», «кубанонабережная»", () => {
    expect(top("Кубано-Набережная 5").title).toBe("улица Кубано-Набережная, 5");
    expect(top("кубанонабережная 5").title).toBe("улица Кубано-Набережная, 5");
    expect(top("кубано набережная 5").title).toBe("улица Кубано-Набережная, 5");
  });
});

describe("одноимённые улицы", () => {
  it("разные пункты — отдельные подсказки с понятной подписью", () => {
    const hits = g.suggest("Вишнёвая 5", { near });
    const lines = hits.map((h) => `${h.title} — ${h.subtitle}`);
    expect(lines).toContain("улица Вишнёвая, 5 — Краснодар");
    expect(lines).toContain("улица Вишнёвая, 5 — СНТ Кубаночка");
    expect(lines[0]).toBe("улица Вишнёвая, 5 — Краснодар"); // ближе к near
  });

  it("near у СНТ — СНТ выше", () => {
    const h = g.suggest("Вишневая 5", { near: { lat: 45.13, lon: 39.05 } })[0];
    expect(h.subtitle).toBe("СНТ Кубаночка");
  });

  it("geocode не выбирает наугад между двумя пригородами", () => {
    expect(g.suggest("Садовая 3", { near }).map((h) => h.subtitle)).toEqual(expect.arrayContaining(["Яблоновский", "Новая Адыгея"]));
    expect(g.geocode("Садовая 3", { near })).toBeNull();
    expect(g.geocode("Садовая 3, Новая Адыгея", { near })?.subtitle).toBe("Новая Адыгея");
  });

  it("geocode: тот же адрес в двух пунктах — строго null, нестрого — пункт near", () => {
    expect(g.geocode("Вишнёвая 5", { near })).toBeNull();
    expect(g.geocode("Вишнёвая 5", { near, strict: false })?.subtitle).toBe("Краснодар");
    expect(g.geocode("Вишнёвая 5, Кубаночка", { near })?.subtitle).toBe("СНТ Кубаночка");
    expect(g.geocode("Красная 120", { near })?.subtitle).toBe("Краснодар"); // номер есть только в одном пункте
  });
});

describe("номера, которых нет: «≈», а не выдуманный дом", () => {
  it("между соседями той же чётности — точка по интерполяции, но точность «≈» (дома нет в данных)", () => {
    const h = top("Ставропольская 106");
    expect(h.kind).toBe("street");
    expect(h.title).toBe("улица Ставропольская, ≈106");
    expect(h.precision).toBe("street");
    expect(h.parts?.house).toBeNull();
    const at104 = FIXTURE.houses.find((x) => x.streetId === "s-stavr" && x.number === "104")!;
    const at108 = FIXTURE.houses.find((x) => x.streetId === "s-stavr" && x.number === "108")!;
    expect(haversineKm(h, at104)).toBeLessThan(haversineKm(at104, at108));
    expect(haversineKm(h, at108)).toBeLessThan(haversineKm(at104, at108));
  });

  it("ни одна подсказка не называет несуществующий дом домом", () => {
    for (const h of g.suggest("Ставропольская 106", { near, limit: 10 })) {
      if (h.kind === "house") expect(h.parts?.house).not.toBe("106");
    }
  });

  it("geocode для импорта отдаёт «≈» с честной точностью: до улицы, не дом", () => {
    const h = g.geocode("г. Краснодар, ул. Ставропольская, 106", { near });
    expect(h?.kind).toBe("street");
    expect(h?.precision).toBe("street");
    expect(h?.parts?.house).toBeNull();
  });

  it("корпус не найден — точка того же дома, но «≈»", () => {
    const h = top("Базовская 21к2 Яблоновский");
    expect(h.title).toBe("улица Базовская, ≈21к2");
    expect(h.precision).toBe("street");
    expect(h.parts?.house).toBeNull();
  });

  it("ни один ответ без номера в данных не выдаётся с точностью до дома", () => {
    for (const q of ["Ставропольская 106", "Ставропольская 112", "Базовская 21к2 Яблоновский", "Красная 121", "Крупской 125/7"]) {
      for (const h of [...g.suggest(q, { near, limit: 10 }), g.geocode(q, { near, strict: false })]) {
        if (!h || (h.precision !== "house" && h.precision !== "interpolated")) continue;
        expect(h.kind, `${q}: ${h.title}`).toBe("house");
        expect(h.parts?.house, `${q}: ${h.title}`).toBeTruthy();
        expect(FIXTURE.houses.some((x) => x.number === h.parts!.house && haversineKm(x, h) < 0.001), `${q}: ${h.title}`).toBe(true);
      }
    }
  });

  it("нет ни улицы, ни похожего — пусто, а не случайный адрес", () => {
    expect(g.geocode("Зеленоградская 5", { near })).toBeNull();
  });
});

describe("точность данных движок не повышает", () => {
  // «улица Северная»: 2, 4, 8, 10 — здания OSM; 6 — дом ГАР с точкой «≈» (улица), 12 — дом ГАР с точкой пункта.
  // Соседи той же чётности рядом, но дом 6 и 12 так и остаются «≈»: точка и точность — из данных.
  const sev = { lat: 45.06, lon: 38.97 };
  const data = {
    ...FIXTURE,
    streets: [...FIXTURE.streets, { id: "s-sev", placeId: "p-krd", name: "улица Северная", type: "улица", aliases: [], ...sev, houses: 6 }],
    houses: [
      ...FIXTURE.houses,
      ...["2", "4", "8", "10"].map((number) => ({
        streetId: "s-sev", placeId: "p-krd", number, lat: sev.lat, lon: sev.lon + Number(number) * 0.0003,
        precision: "house" as const, source: "osm" as const,
      })),
      { streetId: "s-sev", placeId: "p-krd", number: "6", lat: sev.lat + 0.001, lon: sev.lon, precision: "street" as const, source: "gar" as const },
      { streetId: "s-sev", placeId: "p-krd", number: "12", lat: 45.0355, lon: 38.9753, precision: "place" as const, source: "gar" as const },
    ],
  };
  const g2 = createGeocoder(data);

  it("дом ГАР с точкой «≈» остаётся «≈», с точкой данных", () => {
    const h = g2.suggest("Северная 6", { near })[0];
    expect(h.kind).toBe("house");
    expect(h.title).toBe("улица Северная, 6");
    expect(h.precision).toBe("street");
    expect(h.parts?.house).toBe("6");
    expect(h.lat).toBeCloseTo(sev.lat + 0.001, 6);
    expect(h.lon).toBeCloseTo(sev.lon, 6);
    expect(g2.geocode("Краснодар, Северная, 6", { near })?.precision).toBe("street");
  });

  it("дом ГАР с точкой пункта остаётся «≈ населённый пункт»", () => {
    const h = g2.suggest("Северная 12", { near })[0];
    expect(h.title).toBe("улица Северная, 12");
    expect(h.precision).toBe("place");
  });

  it("номера нет в данных — «≈» между соседями, номер не выдумывается", () => {
    const h = g2.suggest("Северная 14", { near })[0];
    expect(h.kind).toBe("street");
    expect(h.precision).toBe("street");
    expect(h.parts?.house).toBeNull();
  });

  it("geocode строго: улица набранного типа есть, но номера на ней нет — не дом тёзки другого типа", () => {
    // дом 21 есть только на улице Бородина; на проезде Бородина — 13, 15, 27, 29
    const H = (streetId: string, number: string, lat: number, lon: number) =>
      ({ streetId, placeId: "p-krd", number, lat, lon, precision: "house" as const, source: "osm" as const });
    const g3 = createGeocoder({
      ...FIXTURE,
      streets: [
        ...FIXTURE.streets,
        { id: "s-bor-ul", placeId: "p-krd", name: "улица Бородина", type: "улица", aliases: [], lat: 45.04, lon: 39.03, houses: 3 },
        { id: "s-bor-pr", placeId: "p-krd", name: "проезд Бородина", type: "проезд", aliases: [], lat: 45.045, lon: 39.035, houses: 4 },
      ],
      houses: [
        ...FIXTURE.houses,
        H("s-bor-ul", "19", 45.04, 39.03), H("s-bor-ul", "21", 45.04, 39.0305), H("s-bor-ul", "23", 45.04, 39.031),
        ...["13", "15", "27", "29"].map((n, i) => H("s-bor-pr", n, 45.045, 39.035 + i * 0.0005)),
      ],
    });
    const d = g3.geocodeDetailed("Краснодар, проезд Бородина, 21", { near });
    expect(d.hit).toBeNull();
    expect(d.reason).toBe("type_mismatch");
    expect(d.alternatives.map((h) => h.title)).toEqual(["улица Бородина, 21", "проезд Бородина, ≈21"]);
    // набранной улицы нет вовсе («ул. 9-го Января» — есть только проезд): тоже не чужой дом как точный
    expect(g3.geocodeDetailed("Краснодар, переулок Бородина, 19", { near }).reason).toBe("type_mismatch");
    // подсказки не теряют ничего: дом другой улицы и «≈» набранной — в списке
    expect(g3.suggest("Краснодар, проезд Бородина, 21", { near }).map((h) => h.title)).toEqual(
      expect.arrayContaining(["улица Бородина, 21", "проезд Бородина, ≈21"]),
    );
    expect(g3.geocode("Краснодар, улица Бородина, 21", { near })?.title).toBe("улица Бородина, 21");
    expect(g3.geocode("Краснодар, Бородина, 21", { near })?.title).toBe("улица Бородина, 21");
  });
});

describe("пункты, микрорайоны, POI", () => {
  it("сокращения микрорайонов", () => {
    expect(top("ЮМР").title).toBe("Юбилейный");
    expect(top("ЮМР").kind).toBe("place");
    expect(top("юбилейка").title).toBe("Юбилейный");
  });

  it("пункт по названию и с типом", () => {
    expect(top("Яблоновский").kind).toBe("place");
    expect(top("пгт Яблоновский").title).toBe("Яблоновский");
  });

  it("POI по названию", () => {
    expect(top("Галерея").kind).toBe("poi");
    expect(top("ТЦ Галерея").title).toBe("ТЦ Галерея");
  });
});

describe("устойчивость", () => {
  it("пустые и мусорные запросы", () => {
    expect(g.suggest("")).toEqual([]);
    expect(g.suggest("   ")).toEqual([]);
    expect(g.geocode("")).toBeNull();
    expect(() => g.suggest("!!! ??? ,,, ///")).not.toThrow();
    expect(() => g.suggest("x".repeat(500))).not.toThrow();
  });

  it("лимит подсказок", () => {
    expect(g.suggest("улица", { near, limit: 3 }).length).toBeLessThanOrEqual(3);
  });
});
