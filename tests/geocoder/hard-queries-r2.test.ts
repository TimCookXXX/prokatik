// Трудные запросы, раунд 2 цикла качества: слово «внутри дома» перед своим числом, литера двумя написаниями, инициал
// «Г.» и тип пункта, сокращения частей названия, одноимённые СНТ, название пункта без типа, объекты, транслит ICAO,
// цифры-двойники букв, невидимые знаки. Свой маленький индекс.

import { describe, expect, it } from "vitest";
import { createGeocoder } from "@/lib/geocoder";
import { tokenize } from "@/lib/geocoder/query";
import { phoneticKey, translitToRu, yearsWord } from "@/lib/geocoder/text";
import type { GeoIndexData, IndexHouse, IndexPlace, IndexStreet } from "@/lib/geocoder/types";

const houses: IndexHouse[] = [];
const streets: IndexStreet[] = [];

function street(id: string, placeId: string, name: string, type: string, lat: number, lon: number, nums: string[], aliases: string[] = []) {
  streets.push({ id, placeId, name, type, aliases, lat, lon, houses: nums.length });
  nums.forEach((number, i) => {
    const n = parseInt(number, 10) || i;
    houses.push({ streetId: id, placeId, number, lat: lat + (n % 2 ? 0.0002 : -0.0002), lon: lon + n * 0.00025, precision: "house", source: "osm" });
  });
}

const places: IndexPlace[] = [
  { id: "p-krd", name: "Краснодар", kind: "city", aliases: [], parentId: null, lat: 45.0355, lon: 38.9753 },
  { id: "p-kmr", name: "Комсомольский", kind: "microdistrict", aliases: ["КМР"], parentId: "p-krd", lat: 45.0345, lon: 39.0958 },
  { id: "p-gidro", name: "Гидрострой", kind: "microdistrict", aliases: ["Гидростроителей"], parentId: "p-krd", lat: 45.05, lon: 39.0 },
  { id: "p-na", name: "Новая Адыгея", kind: "village", aliases: [], parentId: null, lat: 45.02, lon: 38.93 },
  { id: "p-afi", name: "Афипский", kind: "town", aliases: [], parentId: null, lat: 44.9, lon: 38.84 },
  { id: "p-din", name: "Динская", kind: "village", aliases: [], parentId: null, lat: 45.2169, lon: 39.225 },
  { id: "p-len", name: "хутор Ленина", kind: "hamlet", aliases: ["Ленина"], parentId: null, lat: 45.0, lon: 39.2 },
  { id: "p-mel1", name: "СНТ Мелиоратор", kind: "snt", aliases: [], parentId: null, lat: 45.032, lon: 38.943 },
  { id: "p-mel2", name: "СНТ Мелиоратор", kind: "snt", aliases: [], parentId: null, lat: 44.92, lon: 38.848 },
  { id: "p-gs", name: "СНТ Гидростроитель", kind: "snt", aliases: [], parentId: null, lat: 45.055, lon: 39.1725 },
  { id: "p-kub", name: "СНТ Кубаночка", kind: "snt", aliases: [], parentId: null, lat: 45.149, lon: 39.05 },
];

street("s-krasnaya", "p-krd", "улица Красная", "улица", 45.035, 38.975, ["2", "3", "118", "120", "122"]);
street("s-ros", "p-krd", "улица Российская", "улица", 45.08, 39.01, ["2", "30", "131А", "550"]);
street("s-selez", "p-krd", "улица Селезнёва", "улица", 45.015, 39.05, ["240", "242литГ", "244"]);
street("s-machugi", "p-krd", "улица Мачуги", "улица", 45.0127, 39.07, ["39", "41", "43"]);
street("s-zhuk", "p-na", "улица Г.К. Жукова", "улица", 45.004, 38.9, ["10", "12", "14"]);
street("s-novaya", "p-krd", "улица Новая", "улица", 45.0057, 39.024, ["10", "12", "14"]);
street("s-krugl", "p-krd", "улица Кругликовская", "улица", 45.0438, 39.019, ["8", "10", "30"]);
street("s-v-krugl", "p-krd", "улица Восточно-Кругликовская", "улица", 45.0408, 39.0279, ["10", "30"]);
street("s-z-krugl", "p-krd", "улица Западно-Кругликовская", "улица", 45.0747, 39.0345, ["10", "12"]);
street("s-din-ul", "p-krd", "улица Динская", "улица", 45.06, 38.97, ["1", "3"]);
street("s-len-ul", "p-krd", "улица Ленина", "улица", 45.03, 38.98, ["1", "3"]);
street("s-abr1", "p-mel1", "улица Абрикосовая", "улица", 45.032, 38.943, ["9", "11"]);
street("s-abr2", "p-mel2", "улица Абрикосовая", "улица", 44.9197, 38.848, ["9", "11"]);
street("s-sad-krd", "p-krd", "улица Садовая", "улица", 45.0513, 38.998, ["216", "218"]);
street("s-sad-gs", "p-gs", "улица Садовая", "улица", 45.055, 39.1725, ["216", "218"]);
street("s-sliv", "p-kub", "улица Сливовая улица( СНТ Кубаночка)", "улица", 45.149, 39.0526, ["11", "13"], ["улица Сливовая"]);
street("s-rost-ul", "p-krd", "улица Ростовская", "улица", 45.0512, 39.0058, ["10", "33"]);
street("s-rost-sh", "p-krd", "Ростовское шоссе", "шоссе", 45.0629, 38.986, ["10", "33"]);
street("s-bereg", "p-krd", "улица Береговая", "улица", 45.009, 38.952, ["1", "3"]);
street("s-bereg-pr", "p-krd", "Береговой проезд", "проезд", 45.0064, 38.9529, ["1", "3"]);
street("s-yams", "p-krd", "улица Ямская", "улица", 45.125, 38.95, ["2", "4"]);
street("s-slav", "p-krd", "улица Славянская", "улица", 45.0628, 38.9376, ["2/1", "4"]);
street("s-gork", "p-krd", "улица Горького", "улица", 45.0318, 38.969, ["83", "85"]);
street("s-parkov", "p-krd", "улица Парковая", "улица", 45.1, 38.9, ["83", "85"]);
street("s-bazov", "p-krd", "улица Базовская", "улица", 45.0248, 38.9837, ["19", "21"]);
street("s-omsk", "p-krd", "улица Омская", "улица", 45.12, 39.0, ["19", "21"]);
street("s-70", "p-krd", "улица 70 лет Октября", "улица", 45.03, 38.904, ["8", "10"]);
street("s-sech", "p-krd", "улица Сечевая", "улица", 45.0537, 39.1049, ["53", "55"]);
street("s-sych", "p-krd", "улица Сычевая", "улица", 45.0301, 39.1166, ["53", "55"]);
street("s-yarosl", "p-krd", "улица Ярославского", "улица", 45.0305, 39.1024, ["8", "10"], ["улица Церковная"]);
street("s-cerk", "p-mel2", "улица Церковная", "улица", 44.921, 38.85, ["8", "10"]);

const DATA: GeoIndexData = {
  version: "test", citySlug: "krasnodar", builtAt: "2026-09-30T00:00:00Z", places, streets, houses,
  pois: [
    { id: "o-agr", name: "Кубанский государственный аграрный университет", kind: "university", aliases: [], placeId: "p-krd", lat: 45.046, lon: 38.922, address: "улица Калинина, 13" },
    { id: "o-kkb1", name: "ККБ № 1 имени С. В. Очаповского", kind: "hospital", aliases: [], placeId: "p-krd", lat: 45.063, lon: 39.019, address: null },
    { id: "o-kkb2", name: "Краевая клиническая больница № 2", kind: "hospital", aliases: [], placeId: "p-krd", lat: 45.0586, lon: 38.923, address: null },
    { id: "o-narko", name: "Краевая наркологическая больница", kind: "hospital", aliases: [], placeId: "p-krd", lat: 45.037, lon: 39.098, address: "улица Тюляева, 16" },
    { id: "o-rsq", name: "ТРЦ Красная Площадь", kind: "mall", aliases: ["Красная Площадь"], placeId: "p-krd", lat: 45.102, lon: 38.984, address: "улица Дзержинского, 100" },
  ],
};
places.push({ id: "p-kkb", name: "ККБ", kind: "microdistrict", aliases: ["Краевая больница"], parentId: "p-krd", lat: 45.063, lon: 39.0197 });

const g = createGeocoder(DATA);
const near = { lat: 45.0355, lon: 38.9753 };
const list = (q: string) => g.suggest(q, { near }).map((h) => `${h.title} — ${h.subtitle}`);
const line = (q: string) => list(q)[0] ?? null;
const geo = (q: string) => {
  const h = g.geocode(q, { near });
  return h ? `${h.title} — ${h.subtitle}` : null;
};
const kinds = (q: string, open = false) => tokenize(q, open).map((t) => `${t.kind}:${t.text}`);

describe("номер и слова «внутри дома»", () => {
  it("«подъезд 2», «эт. 3» со своим числом после — номер дома остаётся", () => {
    expect(kinds("Красная 120 подъезд 2 этаж 3")).toEqual(["w:красная", "n:120"]);
    expect(kinds("Красная 120 эт. 3")).toEqual(["w:красная", "n:120"]);
    expect(kinds("Красная 120 подъезд № 2")).toEqual(["w:красная", "n:120"]);
    // «3 подъезд» после номера — подъезд, как раньше
    expect(kinds("Красная 120, 3 подъезд 5 этаж")).toEqual(["w:красная", "n:120"]);
    expect(geo("Краснодар красная 120 подъезд 2 этаж 3")).toBe("улица Красная, 120 — Краснодар");
    expect(geo("Краснодар российская 550 подъезд 2")).toBe("улица Российская, 550 — Краснодар");
  });

  it("слово дописывают («под», «эт», «п») — дом не пропадает", () => {
    expect(kinds("Мачуги 41 под", true)).toEqual(["w:мачуги", "n:41"]);
    expect(kinds("Мачуги 41 подъ", true)).toEqual(["w:мачуги", "n:41"]);
    expect(line("Мачуги 41 эт")).toBe("улица Мачуги, 41 — Краснодар");
    expect(line("Краснодар красная 120 п")).toBe("улица Красная, 120 — Краснодар");
  });

  it("литера словом и буквой — один дом", () => {
    expect(line("Краснодар, Российская 131 литер А")).toBe("улица Российская, 131А — Краснодар");
    expect(geo("Краснодар, Селезнёва 242Г")).toBe("улица Селезнёва, 242литГ — Краснодар");
  });
});

describe("инициалы и сокращения", () => {
  it("«Г.К.», «Г» перед фамилией — инициалы, а не «город»", () => {
    expect(line("Новая Адыгея, ул. Г.К. Жукова, 12")).toBe("улица Г.К. Жукова, 12 — Новая Адыгея");
    expect(line("Новая Адыгея, Г Жукова 12")).toBe("улица Г.К. Жукова, 12 — Новая Адыгея");
  });

  it("сокращённая часть составного названия", () => {
    for (const q of ["В.Кругликовская 10", "В. Кругликовская 10", "В-Кругликовская 10", "Вост-Кругликовская 10"]) {
      expect(line(q), q).toBe("улица Восточно-Кругликовская, 10 — Краснодар");
    }
    for (const q of ["Зап. Кругликовская 10", "З. Кругликовская 10", "Зап-Кругликовская 10"]) {
      expect(line(q), q).toBe("улица Западно-Кругликовская, 10 — Краснодар");
      expect(geo(q), q).not.toBe("улица Кругликовская, 10 — Краснодар");
    }
  });

  it("сокращение без гласных — только точно: «ВКМР» — не «КМР»", () => {
    expect(list("ВКМР")).toEqual([]);
    expect(line("КМР")).toBe("Комсомольский — микрорайон, Краснодар");
    // неизвестное «…МР» — уточнение места, а не лишнее слово
    expect(geo("Краснодар, ЦМР, Красная 120")).toBe("улица Красная, 120 — Краснодар");
  });
});

describe("пункты", () => {
  it("название станицы без типа — станица первой; хутор по имени человека — нет", () => {
    expect(line("Динская")).toBe("Динская — населённый пункт");
    expect(line("Ленина")).toBe("улица Ленина — Краснодар");
  });

  it("одноимённые СНТ различимы, импорт между ними не выбирает", () => {
    const l = list("тер. СНТ Мелиоратор Абрикосовая 11");
    expect(l[0]).not.toBe(l[1]);
    expect(l.slice(0, 2).every((x) => x.startsWith("улица Абрикосовая, 11 — СНТ Мелиоратор, "))).toBe(true);
    expect(geo("тер. СНТ Мелиоратор Абрикосовая 11")).toBeNull();
    const snt = list("СНТ Мелиоратор");
    expect(new Set(snt.slice(0, 2)).size).toBe(2);
  });

  it("тип СНТ — не микрорайон с похожим синонимом", () => {
    expect(line("СНТ Гидростроитель ул Садовая 218")).toBe("улица Садовая, 218 — СНТ Гидростроитель");
  });

  it("мусор ГАР в названии улицы убран", () => {
    expect(line("СНТ Кубаночка Сливовая 13")).toBe("улица Сливовая, 13 — СНТ Кубаночка");
  });

  it("старое название одной улицы и основное другой — импорт не выбирает", () => {
    expect(geo("Церковная 10")).toBeNull();
  });
});

describe("объекты", () => {
  it("слова не с начала названия, имя «кого», сокращение с номером", () => {
    expect(line("Аграрный университет")).toMatch(/^Кубанский государственный аграрный университет/);
    expect(line("Очаповского")).toMatch(/^ККБ № 1/);
    expect(line("ККБ 2")).toMatch(/^Краевая клиническая больница № 2/);
    expect(list("ККБ 1").some((x) => x.startsWith("ККБ № 1"))).toBe(true);
  });

  it("точное название места выше объекта-надмножества; вид словами = сокращение", () => {
    expect(line("Краевая больница")).toBe("ККБ — микрорайон, Краснодар");
    expect(line("торговый центр Красная площадь")).toMatch(/^ТРЦ Красная Площадь/);
  });
});

describe("написание", () => {
  it("предлог и род: «на/с/угол … -ой» — женский род", () => {
    expect(line("на Ростовской 10")).toBe("улица Ростовская, 10 — Краснодар");
    expect(line("с Береговой 1")).toBe("улица Береговая, 1 — Краснодар");
    expect(line("угол Береговой 1")).toBe("улица Береговая, 1 — Краснодар");
    expect(line("ростовскя 10")).toBe("улица Ростовская, 10 — Краснодар");
  });

  it("фонетически равные: ближе по написанию — выше", () => {
    expect(line("сечеввая 55")).toBe("улица Сечевая, 55 — Краснодар");
    expect(phoneticKey("горького")).toBe(phoneticKey("горкова"));
    expect(line("Горкова 85")).toBe("улица Горького, 85 — Краснодар");
  });

  it("транслит как в загранпаспорте", () => {
    expect(translitToRu("slavianskaia", true)).toBe("славянская");
    expect(translitToRu("iablonovskii", true)).toBe("яблоновский");
    expect(line("iamskaia 2")).toBe("улица Ямская, 2 — Краснодар");
    expect(line("ul. slavianskaia 2/1")).toBe("улица Славянская, 2/1 — Краснодар");
  });

  it("числительное словом: «Семидесятилетия Октября»", () => {
    expect(yearsWord("семидесятилетия")).toBe("70");
    expect(yearsWord("двадцатипятилетия")).toBe("25");
    expect(yearsWord("лет")).toBeNull();
    expect(line("Семидесятилетия Октября 10")).toBe("улица 70 лет Октября, 10 — Краснодар");
  });

  it("цифра вместо буквы, буква вместо цифры, невидимые знаки", () => {
    expect(line("ба3овская 21")).toBe("улица Базовская, 21 — Краснодар");
    expect(line("Кра3ная 120")).toBe("улица Красная, 120 — Краснодар");
    expect(line("Красная 12О")).toBe("улица Красная, 120 — Краснодар");
    expect(line("Крас­ная 120")).toBe("улица Красная, 120 — Краснодар");
    expect(line("Красная１２０")).toBe("улица Красная, 120 — Краснодар");
  });
});
