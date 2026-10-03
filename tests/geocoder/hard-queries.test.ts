// Трудные запросы из цикла качества (раунд 1): квартира и литера рядом с номером, два пункта в адресе, тип пункта
// перед названием, объекты с числом и латиницей, улицы с именем и без, двойники OSM/ГАР, синоним чужой улицы.
// Свой маленький индекс: общий fixture.ts нужен другим тестам как есть.

import { describe, expect, it } from "vitest";
import { createGeocoder } from "@/lib/geocoder";
import { chunkVariants, tokenize } from "@/lib/geocoder/query";
import type { GeoIndexData, IndexHouse, IndexStreet } from "@/lib/geocoder/types";

const houses: IndexHouse[] = [];
const streets: IndexStreet[] = [];

function street(
  id: string, placeId: string, name: string, type: string, lat: number, lon: number, nums: string[],
  opts: { aliases?: string[]; precision?: IndexHouse["precision"] } = {},
) {
  streets.push({ id, placeId, name, type, aliases: opts.aliases ?? [], lat, lon, houses: nums.length });
  nums.forEach((number, i) => {
    const n = parseInt(number, 10) || i;
    const collapsed = opts.precision === "street";
    houses.push({
      streetId: id, placeId, number,
      lat: collapsed ? lat : lat + (n % 2 ? 0.0002 : -0.0002), lon: collapsed ? lon : lon + n * 0.00025,
      precision: opts.precision ?? "house", source: collapsed ? "gar" : "osm",
    });
  });
}

street("s-krasnaya", "p-krd", "улица Красная", "улица", 45.035, 38.975, ["5", "44", "118", "120", "120/5", "122"]);
street("s-selez", "p-krd", "улица Селезнёва", "улица", 45.02, 39.02, ["100", "113", "113А", "115"]);
street("s-pinsk", "p-ros", "улица Пинская", "улица", 45.1, 39.05, ["24", "26", "28"]);
street("s-ros-pr", "p-krd", "Российский проезд", "проезд", 45.05, 38.99, ["24", "26"]);
street("s-kaluzh", "p-krd", "улица Калужская", "улица", 45.04, 38.98, ["1", "3", "5"]);
street("s-kaluzh-st", "p-kal", "улица Мира", "улица", 44.77, 38.83, ["1", "2"]);
street("s-pokr", "p-krd", "улица Александра Покрышкина", "улица", 45.1, 38.99, ["14", "16", "18"]);
street("s-koval", "p-krd", "улица Ковалёва", "улица", 45.065, 38.95, ["40", "42", "46", "48"]);
street("s-koval-lev", "p-krd", "улица Льва Ковалёва", "улица", 45.084, 38.895, ["40", "42", "44"]);
street("s-sedina-gar", "p-krd", "улица Митрофана Седина", "улица", 45.0205, 38.9759, ["113", "115", "117"], { precision: "street" });
street("s-sedina-osm", "p-krd", "улица Седина", "улица", 45.0309, 38.9791, ["113", "115", "117"]);
street("s-inzh", "p-mech", "улица Инженерная", "улица", 45.2, 39.1, ["27", "29", "31"], { aliases: ["улица Сиреневая"] });
street("s-siren", "p-mech", "улица Сиреневая", "улица", 45.201, 39.103, ["27", "29"]);
street("s-yantar", "p-krd", "улица Янтарная", "улица", 45.07, 39.0, ["2", "4", "6"]);
street("s-esen-ul", "p-krd", "улица Есенина", "улица", 45.04, 38.99, ["8", "10", "12"]);
street("s-esen-per", "p-krd", "переулок Есенина", "переулок", 45.031, 38.97, ["8", "10", "12"]);
street("s-chek", "p-krd", "проспект Чекистов", "проспект", 45.03, 38.915, ["24", "26", "28"]);

const DATA: GeoIndexData = {
  version: "test",
  citySlug: "krasnodar",
  builtAt: "2026-09-30T00:00:00Z",
  places: [
    { id: "p-krd", name: "Краснодар", kind: "city", aliases: ["г. Краснодар"], parentId: null, lat: 45.0355, lon: 38.9753 },
    { id: "p-yub", name: "Юбилейный", kind: "microdistrict", aliases: ["ЮМР"], parentId: "p-okr", lat: 45.031, lon: 38.9124 },
    { id: "p-okr", name: "Прикубанский округ", kind: "okrug", aliases: ["Прикубанский"], parentId: "p-krd", lat: 45.08, lon: 38.95 },
    { id: "p-ros", name: "Российский", kind: "village", aliases: ["п. Российский"], parentId: "p-krd", lat: 45.1, lon: 39.05 },
    { id: "p-kal", name: "Калужская", kind: "village", aliases: ["ст-ца Калужская", "станица Калужская"], parentId: null, lat: 44.77, lon: 38.83 },
    { id: "p-mech", name: "СНТ Механизатор", kind: "snt", aliases: [], parentId: "p-krd", lat: 45.2, lon: 39.1 },
  ],
  streets,
  houses,
  pois: [
    { id: "o-yantar", name: "ЖК Янтарный 4", kind: "residential_complex", aliases: ["Янтарный 4"], placeId: "p-krd", lat: 45.09, lon: 39.02, address: "улица Симиренко, 71к1" },
    { id: "o-oz", name: "Oz Молл", kind: "mall", aliases: ["ТЦ Oz Молл"], placeId: "p-krd", lat: 45.013, lon: 39.07, address: "улица Крылатая, 2" },
    { id: "o-kubgu", name: "Кубанский государственный университет", kind: "university", aliases: [], placeId: "p-krd", lat: 45.05, lon: 38.93, address: "улица Ставропольская, 149" },
  ],
};

const g = createGeocoder(DATA);
const near = { lat: 45.0355, lon: 38.9753 };
const top = (q: string) => g.suggest(q, { near })[0];
const line = (q: string) => {
  const h = top(q);
  return h ? `${h.title} — ${h.subtitle}` : null;
};
const geo = (q: string) => {
  const h = g.geocode(q, { near });
  return h ? `${h.title} — ${h.subtitle}` : null;
};
const kinds = (q: string) => tokenize(q, false).map((t) => `${t.kind}:${t.text}`);

describe("номер дома и то, что после него", () => {
  it("«кв.» не приклеивается к номеру, литера перед «кв» — литера", () => {
    expect(kinds("Красная 120 кв. 5")).toEqual(["w:красная", "n:120"]);
    expect(kinds("Селезнёва 113А кв. 5")).toEqual(["w:селезнева", "h:113а"]);
    expect(kinds("Селезнёва 113 А кв 5")).toEqual(["w:селезнева", "h:113а"]);
    expect(kinds("Калинина 350 Д офис 4")).toEqual(["w:калинина", "h:350д"]);
    expect(line("Краснодар, Селезнёва 113 А кв 5")).toBe("улица Селезнёва, 113А — Краснодар");
    expect(geo("Краснодар, Красная 120 кв. 5")).toBe("улица Красная, 120 — Краснодар");
  });

  it("подъезд, этаж, домофон, код, помещение — не номер дома", () => {
    expect(kinds("Красная 120, 3 подъезд, 5 этаж, кв 44")).toEqual(["w:красная", "n:120"]);
    expect(kinds("Красная, д. 120, 3-й этаж")).toEqual(["w:красная", "w:д", "n:120"]);
    expect(kinds("Красная 120, домофон 44, код 1234")).toEqual(["w:красная", "n:120"]);
    expect(kinds("Красная 120, помещ. 5, вход со двора")).toEqual(["w:красная", "n:120"]);
    expect(geo("г. Краснодар, ул. Красная, 120, 3 подъезд, 5 этаж, кв 44")).toBe("улица Красная, 120 — Краснодар");
  });

  it("второе число — квартира: берётся номер сразу после улицы", () => {
    expect(line("Краснодар, Красная 120, 44")).toBe("улица Красная, 120 — Краснодар");
    expect(geo("Краснодар, Красная 120, 44")).toBe("улица Красная, 120 — Краснодар");
  });

  it("«120-5»: дробь, если такой дом есть, иначе дом и квартира", () => {
    const t = tokenize("Красная 120-5", false).find((x) => x.kind === "h");
    expect(t?.house).toBe("120/5");
    expect(t?.houseAlts).toEqual(["120-5", "120"]);
    expect(line("Красная 120-5")).toBe("улица Красная, 120/5 — Краснодар");
    expect(line("Красная 122-7")).toBe("улица Красная, 122 — Краснодар");
  });

  it("предлог «в» после номера — не литера", () => {
    const t = tokenize("Красная 120 в Краснодаре", false).find((x) => x.kind === "n");
    expect(t?.text).toBe("120");
    expect(t?.houseAlts).toEqual(["120в"]);
    expect(geo("Красная 120 в Краснодаре")).toBe("улица Красная, 120 — Краснодар");
  });

  it("литера слитно, корпус и дробь", () => {
    expect(kinds("Сормовская 7литерБ")).toEqual(["w:сормовская", "h:7литб"]);
    expect(kinds("сормовская7литераБ")).toEqual(["w:сормовская", "h:7литб"]);
    expect(tokenize("Береговая 22 к1", false).find((x) => x.kind === "h")?.houseAlts).toEqual(["22/1"]);
  });

  it("недонабранное «Ком…», «Под…» без номера — начало названия, а после номера «кв» — квартира", () => {
    expect(tokenize("3-й Ком", true).map((t) => `${t.kind}:${t.text}`)).toEqual(["o:3", "w:ком"]);
    expect(tokenize("3-й Ком", true).at(-1)?.fn).toBeNull();
    expect(tokenize("Красная 120, кв", true).map((t) => t.text)).toEqual(["красная", "120"]);
  });
});

describe("пункты в адресе", () => {
  it("город и посёлок в его черте — оба не лишние", () => {
    expect(line("350087, г.Краснодар, п.Российский, улица Пинская, д.26")).toBe("улица Пинская, 26 — Российский");
    expect(geo("350087, г.Краснодар, п.Российский, улица Пинская, д.26")).toBe("улица Пинская, 26 — Российский");
  });

  it("город с микрорайоном или округом", () => {
    expect(geo("Краснодар, ЮМР, Чекистов 26")).toBe("проспект Чекистов, 26 — Краснодар");
    expect(geo("Краснодар, Прикубанский округ, Чекистов 26")).toBe("проспект Чекистов, 26 — Краснодар");
  });

  it("регион, район, поселение и повтор города — не лишние слова", () => {
    expect(geo("Краснодарский край, г. Краснодар, ул. Красная, 120")).toBe("улица Красная, 120 — Краснодар");
    expect(geo("город Краснодар, город Краснодар, ул. Красная, 120")).toBe("улица Красная, 120 — Краснодар");
    expect(geo("Крд, Красная 120")).toBe("улица Красная, 120 — Краснодар");
  });

  it("тип пункта перед названием: станица, а не одноимённая улица", () => {
    expect(line("ст. Калужская")).toBe("Калужская — населённый пункт");
    expect(line("ст-ца Калужская")).toBe("Калужская — населённый пункт");
    // без типа (раунд 2): станица — первой, улица, названная по ней, — рядом; импорт не выбирает
    expect(line("Калужская")).toBe("Калужская — населённый пункт");
    expect(g.suggest("Калужская", { near }).map((h) => `${h.title} — ${h.subtitle}`)).toContain("улица Калужская — Краснодар");
    expect(geo("Калужская")).toBeNull();
  });
});

describe("названия улиц", () => {
  it("фамилия без имени находит улицу с именем, и импорт её принимает", () => {
    expect(line("Покрышкина 16")).toBe("улица Александра Покрышкина, 16 — Краснодар");
    expect(geo("ул. Покрышкина, д. 16")).toBe("улица Александра Покрышкина, 16 — Краснодар");
  });

  it("точное название выше тёзки без имени в том же городе", () => {
    expect(line("Ковалёва 44")).toBe("улица Ковалёва, ≈44 — Краснодар");
    expect(line("Льва Ковалёва 44")).toBe("улица Льва Ковалёва, 44 — Краснодар");
  });

  it("тип не указан — улица выше переулка", () => {
    expect(line("Есенина 10")).toBe("улица Есенина, 10 — Краснодар");
    expect(line("пер. Есенина 10")).toBe("переулок Есенина, 10 — Краснодар");
  });

  it("недонабранное слово перед номером", () => {
    expect(line("Селезн 100")).toBe("улица Селезнёва, 100 — Краснодар");
  });

  it("латинские двойники букв в слове", () => {
    expect(chunkVariants("KPACHAЯ")[0].map((v) => v.text)).toContain("красная");
    expect(line("KPACHAЯ 120")).toBe("улица Красная, 120 — Краснодар");
  });

  it("двойник улицы: дом ГАР без точки берёт точку того же дома OSM", () => {
    const h = top("Митрофана Седина 115");
    expect(h.title).toBe("улица Митрофана Седина, 115");
    expect(h.precision).toBe("house");
    expect(h.lat).toBeCloseTo(45.0309 + 0.0002, 6);
  });

  it("синоним, совпадающий с другой улицей того же места, не уводит адрес", () => {
    expect(line("СНТ Механизатор Сиреневая 29")).toBe("улица Сиреневая, 29 — СНТ Механизатор");
  });
});

describe("объекты", () => {
  it("число в названии ЖК — не номер дома похожей улицы", () => {
    expect(top("ЖК Янтарный 4").title).toBe("ЖК Янтарный 4");
  });

  it("латинское название кириллицей, слитно и с видом", () => {
    for (const q of ["оз молл", "Оз Мол", "озмолл", "OZ Mall", "ТЦ OZ", "jp vjkk"]) expect(top(q)?.title, q).toBe("Oz Молл");
  });

  it("пропущенное слово длинного названия", () => {
    expect(top("Кубанский университет").title).toBe("Кубанский государственный университет");
  });
});
