// @vitest-environment node
// Адрес в мутациях объявления (createListing / updateListing): обязателен,
// старая форма без поля адреса не проходит, правка без касания адреса его не
// переспрашивает и сохранённую точку не трогает. БД — фейк, который отдаёт
// текущую строку объявления и запоминает записи; геокодер и города — моки, а
// resolveListingAddress — настоящий.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE } from "../geocoder/fixture";
import { buildClientIndex, createClientGeocoder } from "@/lib/geocoder";
import type { GeoIndexData } from "@/lib/geocoder/types";
import type { CityGeoContext } from "@/lib/geo/context";

const state = vi.hoisted(() => ({
  /** Текущая строка объявления владельца; null — чужое или нет такого. */
  current: null as null | { cityId: string; address: string | null; geoPrecision: string },
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  geo: null as GeoIndexData | null,
  geoThrows: false,
  /** Сколько UPDATE было записано к моменту чтения адреса для IndexNow. */
  updatesWhenUrlsRead: null as number | null,
}));

const { authMock, db } = vi.hoisted(() => {
  // Цепочка drizzle: любые вызовы возвращают её же, await — результат.
  const chain = (result: () => unknown[], onCall: (prop: string, args: unknown[]) => void = () => {}) => {
    const self: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (rows: unknown[]) => void) => resolve(result());
        return (...args: unknown[]) => { onCall(String(prop), args); return self; };
      },
    });
    return self;
  };
  const db = {
    select: () => chain(() => (state.current ? [state.current] : [])),
    insert: () => chain(() => [], (prop, args) => { if (prop === "values") state.inserts.push(args[0] as Record<string, unknown>); }),
    update: () => {
      let returning = false;
      return chain(
        () => (returning ? [{ id: "L1" }] : []),
        (prop, args) => {
          if (prop === "set") state.updates.push(args[0] as Record<string, unknown>);
          if (prop === "returning") returning = true;
        },
      );
    },
  };
  return { authMock: vi.fn(), db };
});

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/search-index", () => ({ invalidateSearchIndex: vi.fn() }));
vi.mock("@/server/realtime", () => ({ publish: vi.fn() }));
vi.mock("@/server/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/server/deal-note", () => ({ writeDealNote: vi.fn() }));
vi.mock("@/server/booking-mail", () => ({ queueBookingMail: vi.fn() }));
// after() вне запроса падает; адрес до записи — фиксированный, а момент его
// чтения запоминается, чтобы проверить, что он прочитан ДО UPDATE.
const indexNow = vi.hoisted(() => ({ schedule: vi.fn() }));
vi.mock("@/server/indexnow", () => ({
  scheduleIndexNow: indexNow.schedule,
  currentListingUrls: async () => {
    state.updatesWhenUrlsRead = state.updates.length;
    return ["https://example.ru/krasnodar/cat/perforator-L1"];
  },
}));

vi.mock("@/server/geocoder-index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/geocoder-index")>()),
  getGeoIndexData: async () => {
    if (state.geoThrows) throw new Error("db down");
    return state.geo;
  },
}));
const KRD_CENTRE = { lat: 45.0355, lon: 38.9753 };
const citiesGeo = new Map<string, CityGeoContext | null>([
  ["krasnodar", { region: "krasnodar", centre: KRD_CENTRE, token: "krasnodar:test" }],
  ["yablonovskiy", { region: "krasnodar", centre: { lat: 44.988, lon: 38.9475 }, token: "krasnodar:test" }],
  ["kazan", null],
]);
vi.mock("@/server/city", () => ({ getCitiesGeo: async () => citiesGeo }));
const CITIES: Record<string, { id: string; slug: string; name: string; nameLocative: string }> = {
  krd: { id: "krd", slug: "krasnodar", name: "Краснодар", nameLocative: "Краснодаре" },
  yab: { id: "yab", slug: "yablonovskiy", name: "Яблоновский", nameLocative: "Яблоновском" },
  kzn: { id: "kzn", slug: "kazan", name: "Казань", nameLocative: "Казани" },
};
vi.mock("@/server/catalog", () => ({
  getCityById: async (id: string) => CITIES[id] ?? null,
  getActiveCities: async () => Object.values(CITIES),
}));

const { createListing, updateListing } = await import("@/server/actions/owner");
const { resetGeocoderEngines } = await import("@/server/geocoder");

const street = createClientGeocoder(buildClientIndex(structuredClone(FIXTURE)))
  .suggest("красная", { near: KRD_CENTRE })[0];
const pick = {
  mode: "pick" as const, kind: street.kind, title: street.title, subtitle: street.subtitle,
  lat: street.lat, lon: street.lon,
};
// Улица Садовая в Яблоновском — город объявления по адресу, а не по форме.
const yabStreet = createClientGeocoder(buildClientIndex(structuredClone(FIXTURE)))
  .suggest("садовая яблоновский", { near: KRD_CENTRE })
  .find((h) => h.subtitle.startsWith("Яблоновский"))!;
const pickYab = {
  mode: "pick" as const, kind: yabStreet.kind, title: yabStreet.title, subtitle: yabStreet.subtitle,
  lat: yabStreet.lat, lon: yabStreet.lon,
};

const form = (over: Record<string, unknown> = {}) => ({
  title: "Перфоратор Bosch", categoryId: "cat", cityId: "krd", description: "",
  priceDay: 500, depositType: "none", quantity: 1,
  handoverPickup: true, handoverDelivery: false, photos: [],
  address: { mode: "keep" },
  ...over,
});

const ADDRESS_COLUMNS = ["address", "location", "lat", "lon", "geoPrecision"];
const stored = { cityId: "krd", address: "улица Красная, 120", geoPrecision: "house" };

beforeEach(() => {
  authMock.mockResolvedValue({ user: { id: "u1", bannedAt: null } });
  state.current = null;
  state.inserts = [];
  state.updates = [];
  state.geo = { ...FIXTURE, houses: [...FIXTURE.houses] };
  state.geoThrows = false;
  state.updatesWhenUrlsRead = null;
  indexNow.schedule.mockClear();
  resetGeocoderEngines();
});

describe("createListing: адрес", () => {
  it("сохраняет адрес и точку из серверного хита", async () => {
    expect(await createListing(form({ address: pick }))).toMatchObject({ ok: true });
    expect(state.inserts[0]).toMatchObject({
      address: "улица Красная, Краснодар", location: "улица Красная, Краснодар", geoPrecision: "street",
      lat: expect.any(Number), lon: expect.any(Number),
    });
  });

  // Город в форме при выборе подсказки — только регион поиска: подменённый
  // cityId не уведёт ЖК Краснодара в Яблоновский.
  it("город объявления — из адреса, cityId формы для подсказки не действует", async () => {
    expect(await createListing(form({ cityId: "yab", address: pick }))).toMatchObject({ ok: true });
    expect(state.inserts[0]).toMatchObject({ cityId: "krd", address: "улица Красная, Краснодар" });

    expect(await createListing(form({ cityId: "krd", address: pickYab }))).toMatchObject({ ok: true });
    expect(state.inserts[1]).toMatchObject({ cityId: "yab", address: "улица Садовая, Яблоновский", location: "улица Садовая, Яблоновский" });
  });

  it("без адреса объявление не создаётся", async () => {
    expect(await createListing(form())).toEqual({ ok: false, error: "Укажите адрес" });
    expect(state.inserts).toHaveLength(0);
  });

  // Бандл формы без поля адреса — не человек, который забыл: лечится только
  // перезагрузкой страницы.
  it("форма без ключа address — «Форма устарела»", async () => {
    const { address: _drop, ...old } = form();
    expect(await createListing({ ...old, location: "ул. Гагарина" }))
      .toEqual({ ok: false, error: "Форма устарела — обновите страницу" });
    expect(await createListing(form({ address: { mode: "teleport" } })))
      .toEqual({ ok: false, error: "Форма устарела — обновите страницу" });
    expect(state.inserts).toHaveLength(0);
  });

  it("в городе без геоданных — адрес текстом, без точки", async () => {
    expect(await createListing(form({ cityId: "kzn", address: { mode: "text", text: "ул. Баумана" } })))
      .toMatchObject({ ok: true });
    expect(state.inserts[0]).toMatchObject({
      cityId: "kzn", address: "ул. Баумана", location: "ул. Баумана", lat: null, lon: null, geoPrecision: "city",
    });
  });
});

describe("updateListing: адрес", () => {
  // Правка цены не переспрашивает адрес: колонок адреса в .set() нет вовсе,
  // и сохранённая точка остаётся, даже если геокодер сейчас недоступен.
  it("keep при правке цены не трогает колонки адреса", async () => {
    state.current = stored;
    state.geoThrows = true;
    expect(await updateListing("L1", form({ priceDay: 700 }))).toEqual({ ok: true, data: undefined });
    expect(state.updates[0]).toMatchObject({ priceDay: 700, cityId: "krd" });
    for (const c of ADDRESS_COLUMNS) expect(state.updates[0]).not.toHaveProperty(c);
  });

  // Переимпорт геоданных меняет id и даже сами данные — keep от них не зависит.
  it("keep переживает переимпорт геоданных", async () => {
    state.current = stored;
    state.geo = { ...FIXTURE, version: "reimported", streets: [], houses: [], places: [], pois: [] };
    expect(await updateListing("L1", form({ title: "Перфоратор Bosch GBH" }))).toMatchObject({ ok: true });
    for (const c of ADDRESS_COLUMNS) expect(state.updates[0]).not.toHaveProperty(c);
  });

  it("keep при смене города — «Укажите адрес»", async () => {
    state.current = stored;
    expect(await updateListing("L1", form({ cityId: "yab" }))).toEqual({ ok: false, error: "Укажите адрес" });
    expect(state.updates).toHaveLength(0);
  });

  it("keep у строки без адреса (до backfill) — «Укажите адрес»", async () => {
    state.current = { cityId: "krd", address: null, geoPrecision: "city" };
    expect(await updateListing("L1", form())).toEqual({ ok: false, error: "Укажите адрес" });
    expect(state.updates).toHaveLength(0);
  });

  it("новый адрес при правке пишется целиком", async () => {
    state.current = { cityId: "krd", address: null, geoPrecision: "city" };
    expect(await updateListing("L1", form({ address: pick }))).toMatchObject({ ok: true });
    expect(state.updates[0]).toMatchObject({ address: "улица Красная, Краснодар", geoPrecision: "street" });
  });

  // Новый адрес в другом пункте — объявление переезжает вместе с ним.
  it("новый адрес в другом городе переносит объявление туда", async () => {
    state.current = stored;
    expect(await updateListing("L1", form({ address: pickYab }))).toMatchObject({ ok: true });
    expect(state.updates[0]).toMatchObject({ cityId: "yab", address: "улица Садовая, Яблоновский" });
  });

  it("чужое объявление — not_found до похода в геокодер", async () => {
    state.current = null;
    expect(await updateListing("L1", form({ address: pick }))).toEqual({ ok: false, error: "not_found" });
    expect(state.updates).toHaveLength(0);
  });
});

// Смена адреса может перенести объявление в другой город, а с ним сменить и
// канонический путь: старый адрес читается до записи и уходит в пинг вместе с
// новым, чтобы робот получил на нём 308.
describe("IndexNow в мутациях объявления", () => {
  it("createListing отдаёт новое объявление на пинг", async () => {
    expect(await createListing(form({ address: pick }))).toMatchObject({ ok: true });
    expect(indexNow.schedule).toHaveBeenCalledWith([state.inserts[0]!.id]);
  });

  it("updateListing читает адрес до UPDATE и передаёт его в пинг", async () => {
    state.current = stored;
    expect(await updateListing("L1", form({ address: pickYab }))).toMatchObject({ ok: true });
    expect(state.updatesWhenUrlsRead).toBe(0);
    expect(state.updates).toHaveLength(1);
    expect(indexNow.schedule).toHaveBeenCalledWith(["L1"], ["https://example.ru/krasnodar/cat/perforator-L1"]);
  });

  it("чужое объявление и отказ по адресу — без пинга и без чтения адреса", async () => {
    state.current = null;
    expect(await updateListing("L1", form({ address: pick }))).toEqual({ ok: false, error: "not_found" });
    state.current = stored;
    expect(await updateListing("L1", form({ cityId: "yab" }))).toEqual({ ok: false, error: "Укажите адрес" });
    expect(await createListing(form())).toEqual({ ok: false, error: "Укажите адрес" });
    expect(state.updatesWhenUrlsRead).toBeNull();
    expect(indexNow.schedule).not.toHaveBeenCalled();
  });
});
