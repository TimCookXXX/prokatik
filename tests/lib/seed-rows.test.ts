import { describe, it, expect } from "vitest";
import type { CsvRow } from "@/lib/csv";
import { parseHandover, parsePhotos, parseSeedData } from "@/lib/seed/rows";

const city = (over: Partial<CsvRow> = {}): CsvRow => ({
  slug: "krasnodar", name: "Краснодар", name_locative: "Краснодаре",
  region: "Краснодарский край", lat: "", lon: "", geo_region: "", ...over,
});

const user = (over: Partial<CsvRow> = {}): CsvRow => ({
  key: "sergey", email: "sergey@seed.local", name: "Сергей",
  phone: "+7 900 111-22-33", city_slug: "krasnodar", bio: "", cover: "",
  is_verified: "", ...over,
});

const listing = (over: Partial<CsvRow> = {}): CsvRow => ({
  owner: "sergey", city: "krasnodar",
  category: "Инструменты / Электроинструменты",
  title: "Перфоратор Bosch", description: "Рабочая лошадка", location: "ул. Гагарина",
  address: "", lat: "", lon: "", precision: "",
  price_day: "550", deposit_type: "money", deposit_amount: "3000",
  quantity: "3", handover: "pickup", status: "active", photos: "drill-1.webp",
  ...over,
});

const parse = (over: { cities?: CsvRow[]; users?: CsvRow[]; listings?: CsvRow[] } = {}) =>
  parseSeedData({
    cities: over.cities ?? [city()],
    users: over.users ?? [user()],
    listings: over.listings ?? [listing()],
  });

const messages = (result: ReturnType<typeof parseSeedData>) =>
  result.ok ? [] : result.issues.map((i) => `${i.file}:${i.line} ${i.message}`);

describe("parseSeedData", () => {
  it("разбирает согласованные таблицы", () => {
    const res = parse();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.listings[0]).toMatchObject({
      title: "Перфоратор Bosch",
      slug: "perforator-bosch",
      categoryRoot: "Инструменты",
      categoryChild: "Электроинструменты",
      priceDay: 550,
      depositType: "money",
      depositAmount: 3000,
      handoverPickup: true,
      handoverDelivery: false,
      photos: ["drill-1.webp"],
    });
  });

  it("русские подписи принимаются наравне с кодами", () => {
    const res = parse({
      listings: [listing({ deposit_type: "Деньги", handover: "Самовывоз, Доставка", status: "Архив" })],
      users: [user({ is_verified: "да" })],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.listings[0]).toMatchObject({
      depositType: "money", handoverPickup: true, handoverDelivery: true, status: "archived",
    });
    expect(res.data.users[0].isVerified).toBe(true);
  });

  it("пустые ячейки становятся NULL, а не пустыми строками", () => {
    const res = parse({ listings: [listing({ location: "", description: "", photos: "" })] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.listings[0]).toMatchObject({ location: null, description: null, photos: [] });
  });

  it("cover переводится в адрес пресета", () => {
    const res = parse({ users: [user({ cover: "lenta" })] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.users[0].coverUrl).toBe("/covers/lenta.svg");
  });

  it("неизвестный пресет обложки — ошибка со списком доступных", () => {
    expect(messages(parse({ users: [user({ cover: "nesushchestvuyushchiy" })] })))
      .toEqual([expect.stringContaining("нет такого пресета")]);
  });

  // Залог обязан быть согласован в обе стороны: сумма без типа «деньги» —
  // почти всегда следствие правки типа без правки суммы.
  it("deposit_amount обязателен при money", () => {
    expect(messages(parse({ listings: [listing({ deposit_amount: "" })] })))
      .toEqual([expect.stringContaining("deposit_amount обязателен")]);
  });

  it("deposit_amount при document — ошибка", () => {
    expect(messages(parse({ listings: [listing({ deposit_type: "document", deposit_amount: "3000" })] })))
      .toEqual([expect.stringContaining("залога нет, суммы быть не должно")]);
  });

  it("несуществующая категория — ошибка", () => {
    expect(messages(parse({ listings: [listing({ category: "Инструменты / Ковролин" })] })))
      .toEqual([expect.stringContaining("нет категории")]);
  });

  it("категория без пути — ошибка про формат", () => {
    expect(messages(parse({ listings: [listing({ category: "Электроинструменты" })] })))
      .toEqual([expect.stringContaining("ожидается путь вида")]);
  });

  it("owner не из users.csv — ошибка", () => {
    expect(messages(parse({ listings: [listing({ owner: "petr" })] })))
      .toEqual([expect.stringContaining("нет такого key")]);
  });

  it("city не из cities.csv — ошибка", () => {
    expect(messages(parse({ listings: [listing({ city: "moskva" })] })))
      .toEqual([expect.stringContaining("нет такого slug")]);
  });

  it("city_slug владельца сверяется с городами", () => {
    expect(messages(parse({ users: [user({ city_slug: "moskva" })] })))
      .toEqual([expect.stringContaining("нет такого города")]);
  });

  // Пара (владелец, заголовок) — ключ идемпотентности: неоднозначность в нём
  // означала бы, что второй прогон переписывает одну строку дважды.
  it("два одинаковых заголовка у одного владельца — ошибка", () => {
    expect(messages(parse({ listings: [listing(), listing()] })))
      .toEqual([expect.stringContaining("уже есть объявление")]);
  });

  it("одинаковые заголовки у разных владельцев допустимы", () => {
    const res = parse({
      users: [user(), user({ key: "pavel", email: "pavel@seed.local", name: "Павел" })],
      listings: [listing(), listing({ owner: "pavel" })],
    });
    expect(res.ok).toBe(true);
  });

  it("slug города проверяется на пригодность для адреса", () => {
    expect(messages(parse({ cities: [city({ slug: "Краснодар" })] })))
      .toEqual([expect.stringContaining("не годится для адреса")]);
  });

  it("пустой name_locative — ошибка", () => {
    expect(messages(parse({ cities: [city({ name_locative: "" })] })))
      .toEqual([expect.stringContaining("name_locative пустой")]);
  });

  it("нецелая цена — ошибка", () => {
    expect(messages(parse({ listings: [listing({ price_day: "550,50" })] })))
      .toEqual([expect.stringContaining("price_day")]);
  });

  it("нулевое количество — ошибка", () => {
    expect(messages(parse({ listings: [listing({ quantity: "0" })] })))
      .toEqual([expect.stringContaining("quantity")]);
  });

  it("заголовок длиннее 200 символов — ошибка", () => {
    expect(messages(parse({ listings: [listing({ title: "я".repeat(201) })] })))
      .toEqual([expect.stringContaining("длиннее 200")]);
  });

  it("нет обязательной колонки — ошибка про шапку, а не про каждую строку", () => {
    const { price_day: _omit, ...withoutPrice } = listing();
    expect(messages(parseSeedData({ cities: [city()], users: [user()], listings: [withoutPrice] })))
      .toEqual([expect.stringContaining("в шапке нет колонок: price_day")]);
  });

  // Человек правит таблицу в редакторе: список всех ошибок разом экономит ему
  // десять прогонов подряд.
  it("ошибки копятся, а не обрываются на первой", () => {
    const res = parse({
      listings: [
        listing({ price_day: "дорого" }),
        listing({ title: "Болгарка", category: "Ерунда / Чепуха" }),
      ],
    });
    expect(messages(res)).toHaveLength(2);
  });

  it("номера строк считаются с шапкой", () => {
    const res = parse({ listings: [listing(), listing({ title: "Болгарка", quantity: "0" })] });
    expect(messages(res)).toEqual([expect.stringContaining("listings.csv:3")]);
  });

  // Отбракованная строка не должна сдвигать номера последующих: раньше номер
  // восстанавливался из позиции в отфильтрованном массиве, и человек шёл чинить
  // строку, в которой ошибки нет.
  it("отбракованная строка не сдвигает номера следующих", () => {
    const res = parse({
      listings: [
        listing({ quantity: "0" }),
        listing({ title: "Болгарка", owner: "petr" }),
      ],
    });
    expect(messages(res)).toEqual([
      expect.stringContaining("listings.csv:2"),
      expect.stringContaining("listings.csv:3"),
    ]);
  });

  // Форма объявления держит .max(10). Одиннадцатое фото от сида сделало бы
  // объявление несохраняемым в кабинете: форма отвергла бы свои же данные.
  it("больше десяти фотографий — ошибка", () => {
    const photos = Array.from({ length: 11 }, (_, i) => `p${i}.webp`).join(";");
    expect(messages(parse({ listings: [listing({ photos })] })))
      .toEqual([expect.stringContaining("больше 10")]);
    expect(parse({ listings: [listing({ photos: photos.split(";").slice(0, 10).join(";") })] }).ok)
      .toBe(true);
  });

  it("путь вместо имени файла в photos — ошибка", () => {
    expect(messages(parse({ listings: [listing({ photos: "../../secret.webp" })] })))
      .toEqual([expect.stringContaining("без пути")]);
    expect(messages(parse({ listings: [listing({ photos: "Фото/a.webp" })] })))
      .toEqual([expect.stringContaining("без пути")]);
  });
});

describe("parseSeedData: геоданные городов", () => {
  it("центр и регион геоданных разбираются в числа и ключ", () => {
    const res = parse({
      cities: [city({ lat: "45.0351532", lon: "38,9772396", geo_region: "krasnodar" })],
      listings: [listing(POINT)],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.cities[0]).toMatchObject({ lat: 45.0351532, lon: 38.9772396, geoRegion: "krasnodar" });
  });

  it("пустой geo_region — NULL: у города геоданных нет", () => {
    const res = parse();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.cities[0]).toMatchObject({ lat: null, lon: null, geoRegion: null });
  });

  it("регион без центра — ошибка: подсказки адресов ранжируются от него", () => {
    expect(messages(parse({ cities: [city({ geo_region: "krasnodar" })] })))
      .toEqual([expect.stringMatching(/^cities\.csv:2 geo_region без lat\/lon/)]);
  });

  it("lat без lon — ошибка", () => {
    expect(messages(parse({ cities: [city({ lat: "45.03" })] })))
      .toEqual([expect.stringMatching(/парой/)]);
  });

  it("координаты вне диапазона — ошибка", () => {
    expect(messages(parse({ cities: [city({ lat: "95", lon: "38.97" })] })))
      .toEqual([expect.stringMatching(/lat вне диапазона/)]);
    expect(messages(parse({ cities: [city({ lat: "45", lon: "190" })] })))
      .toEqual([expect.stringMatching(/lon вне диапазона/)]);
  });

  it("регион — ключ импорта латиницей", () => {
    expect(messages(parse({ cities: [city({ lat: "45", lon: "39", geo_region: "Краснодар" })] })))
      .toEqual([expect.stringMatching(/geo_region/)]);
  });

  it("нет колонки geo_region — ошибка про шапку", () => {
    const { geo_region: _drop, ...noRegion } = city();
    expect(messages(parse({ cities: [noRegion] })))
      .toEqual([expect.stringMatching(/^cities\.csv:1 .*geo_region/)]);
  });

  // Реальный файл: оба города — один регион геоданных с центрами из индекса.
  it("seed_real/cities.csv разбирается и несёт регион и центр обоих городов", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseCsv } = await import("@/lib/csv");
    const rows = parseCsv(readFileSync("seed_real/cities.csv", "utf8"));
    const res = parse({ cities: rows, users: [user({ city_slug: "" })], listings: [listing(POINT)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const c of res.data.cities) {
      expect(c.geoRegion).toBe("krasnodar");
      expect(c.lat).not.toBeNull();
      expect(c.lon).not.toBeNull();
    }
  });
});

const POINT = {
  address: "улица Гагарина, 12, Яблоновский", location: "улица Гагарина, Яблоновский",
  lat: "44.9871", lon: "38.9402", precision: "house",
};

describe("parseSeedData: адрес объявления", () => {
  const geoCity = city({ lat: "45.0351532", lon: "38.9772396", geo_region: "krasnodar" });

  it("точка, точность и адрес переходят в строку", () => {
    const res = parse({ cities: [geoCity], listings: [listing(POINT)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.listings[0]).toMatchObject({
      address: "улица Гагарина, 12, Яблоновский", location: "улица Гагарина, Яблоновский",
      lat: 44.9871, lon: 38.9402, precision: "house",
    });
  });

  it("без точки в городе без геоданных — city, адрес может быть пуст", () => {
    const res = parse();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.listings[0]).toMatchObject({ address: null, lat: null, lon: null, precision: "city" });
  });

  it("русские подписи точности принимаются", () => {
    const res = parse({ cities: [geoCity], listings: [listing({ ...POINT, precision: "улица" })] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.listings[0].precision).toBe("street");
  });

  // Иначе сид записал бы строки без точек, а повторный прогон с этой таблицей
  // стёр бы точки, найденные с тех пор.
  it("у города есть геоданные, а lat пуст — ошибка с подсказкой про backfill", () => {
    expect(messages(parse({ cities: [geoCity] })))
      .toEqual([expect.stringMatching(/^listings\.csv:2 .*lat пуст — запустите pnpm geo:backfill --csv/)]);
  });

  it("lat без lon и вне диапазона — ошибка", () => {
    expect(messages(parse({ listings: [listing({ ...POINT, lon: "" })] })))
      .toEqual([expect.stringMatching(/lat и lon заполняются парой/)]);
    expect(messages(parse({ listings: [listing({ ...POINT, lat: "91" })] })))
      .toEqual([expect.stringMatching(/lat вне диапазона/)]);
    expect(messages(parse({ listings: [listing({ ...POINT, lat: "север" })] })))
      .toEqual([expect.stringMatching(/lat не число/)]);
  });

  it("точность из enum и согласована с точкой", () => {
    expect(messages(parse({ listings: [listing({ ...POINT, precision: "квартира" })] })))
      .toEqual([expect.stringMatching(/precision «квартира»/)]);
    expect(messages(parse({ listings: [listing({ ...POINT, precision: "" })] })))
      .toEqual([expect.stringMatching(/нужна precision/)]);
    expect(messages(parse({ listings: [listing({ ...POINT, precision: "city" })] })))
      .toEqual([expect.stringMatching(/нужна precision/)]);
    expect(messages(parse({ listings: [listing({ precision: "street" })] })))
      .toEqual([expect.stringMatching(/точности без точки не бывает/)]);
  });

  it("точка без адреса — ошибка", () => {
    expect(messages(parse({ listings: [listing({ ...POINT, address: "" })] })))
      .toEqual([expect.stringMatching(/address пуст/)]);
  });

  it("длины — как у колонок: location ≤ 120, address ≤ 200", () => {
    expect(messages(parse({ listings: [listing({ location: "а".repeat(121) })] })))
      .toEqual([expect.stringMatching(/location длиннее 120/)]);
    expect(messages(parse({ listings: [listing({ ...POINT, address: "а".repeat(201) })] })))
      .toEqual([expect.stringMatching(/address длиннее 200/)]);
  });

  // Таблица сида прошла geo:backfill: у каждого объявления в городе с
  // геоданными есть точка, и повторный сид их не сотрёт.
  it("реальные таблицы seed_real/ разбираются, у всех объявлений есть точка", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseCsv } = await import("@/lib/csv");
    const read = (f: string) => parseCsv(readFileSync(`seed_real/${f}`, "utf8"));
    const res = parseSeedData({ cities: read("cities.csv"), users: read("users.csv"), listings: read("listings.csv") });
    expect(messages(res)).toEqual([]);
    if (!res.ok) return;
    for (const l of res.data.listings) {
      expect(l.lat).not.toBeNull();
      expect(l.precision).not.toBe("city");
      expect(l.address).not.toBeNull();
    }
  });

  // Город определяет адрес: точка, которая по геокодеру в другом городе, —
  // ошибка (ЖК Радуга — Краснодар, а не Яблоновский). Сверку считает
  // scripts/seed-real.ts движком; здесь — заглушка.
  it("точка в другом городе, чем city, — ошибка с подсказкой", () => {
    const yab = city({ slug: "yablonovskiy", name: "Яблоновский", name_locative: "Яблоновском", geo_region: "krasnodar", lat: "44.98", lon: "38.94" });
    const seen: string[] = [];
    const cityOfPoint = (l: { city: string; address: string | null }, cities: readonly { slug: string }[]) => {
      seen.push(`${l.city}:${cities.map((c) => c.slug).join(",")}`);
      return l.address === "ЖК Радуга" ? "krasnodar" : l.city;
    };
    const res = parseSeedData({
      cities: [geoCity, yab],
      users: [user()],
      listings: [
        listing({ ...POINT, city: "yablonovskiy", address: "ЖК Радуга", location: "ЖК Радуга", precision: "place" }),
        listing({ ...POINT, title: "Лобзик", city: "yablonovskiy" }),
      ],
    }, { cityOfPoint });
    expect(messages(res)).toEqual([
      "listings.csv:2 адрес «ЖК Радуга» относится к городу «krasnodar», а city = «yablonovskiy» — город определяет адрес: "
      + "поставьте city krasnodar или исправьте address, очистите lat и запустите pnpm geo:backfill --csv seed_real/listings.csv",
    ]);
    expect(seen).toEqual(["yablonovskiy:krasnodar,yablonovskiy", "yablonovskiy:krasnodar,yablonovskiy"]);
  });

  it("сверка молчит без точки и когда сказать нечем", () => {
    const cityOfPoint = () => null;
    expect(parse({ listings: [listing()] }).ok).toBe(true);
    expect(parseSeedData({ cities: [geoCity], users: [user()], listings: [listing(POINT)] }, { cityOfPoint }).ok).toBe(true);
    const never = () => { throw new Error("no point — no check"); };
    expect(parseSeedData({ cities: [city()], users: [user()], listings: [listing()] }, { cityOfPoint: never }).ok).toBe(true);
  });

  it("нет новых колонок в шапке — ошибка про шапку", () => {
    const { address: _a, lat: _lat, lon: _lon, precision: _p, ...old } = listing();
    expect(messages(parse({ listings: [old] })))
      .toEqual([expect.stringMatching(/^listings\.csv:1 в шапке нет колонок: address, lat, lon, precision/)]);
  });
});

describe("parseHandover", () => {
  it("оба способа через точку с запятой", () => {
    expect(parseHandover("pickup;delivery")).toEqual({ pickup: true, delivery: true });
  });

  it("только доставка", () => {
    expect(parseHandover("delivery")).toEqual({ pickup: false, delivery: true });
  });

  it("неизвестное слово — null, а не молчаливый самовывоз", () => {
    expect(parseHandover("почтой")).toBeNull();
    expect(parseHandover("")).toBeNull();
  });
});

describe("parsePhotos", () => {
  it("разделяет по точке с запятой и чистит пустые", () => {
    expect(parsePhotos(" a.webp ; b.webp ;; ")).toEqual(["a.webp", "b.webp"]);
  });

  it("пустая ячейка — пустой список", () => {
    expect(parsePhotos("")).toEqual([]);
  });
});
