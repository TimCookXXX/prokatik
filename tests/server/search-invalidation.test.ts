// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Мутации, меняющие состав или тексты индекса поиска, обязаны сбросить его:
// иначе скрытое объявление ещё до 30 с висело бы в подсказках, а новое — не
// появлялось бы. Здесь же — запрет слагов городов, занятых маршрутами.
//
// БД мокается построителем, который отвечает на любую цепочку: `returning`
// — одной строкой (запись прошла), всё остальное — пустым набором (дублей
// нет, подкатегорий нет, заявок нет). Транзакция исполняет колбэк на нём же.
const { authMock, invalidate, dbCalls, refs, db } = vi.hoisted(() => {
  const dbCalls: string[] = [];
  // Таблица заявок подставляется после импорта схемы: фабрика исполняется раньше.
  const refs = { bookingRequests: null as unknown };
  const chain = (table: unknown): unknown => {
    let returning = false;
    const self: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") {
          // Бан: строка пользователя обновлена, а живых заявок у него нет.
          return (resolve: (rows: unknown[]) => void) =>
            resolve(returning && table !== refs.bookingRequests ? [{ id: "x" }] : []);
        }
        return () => {
          if (prop === "returning") returning = true;
          return self;
        };
      },
    });
    return self;
  };
  // Текущий адрес объявления (updateListing читает его для keep) — строка
  // есть: иначе правка ответила бы not_found раньше записи.
  const currentAddress = { cityId: "city", address: "улица Красная", geoPrecision: "street" };
  const op = (name: string) => (table?: unknown) => {
    dbCalls.push(name);
    if (name === "select" && table && typeof table === "object" && "geoPrecision" in table) {
      const rows: unknown = new Proxy({}, {
        get: (_t, prop) => (prop === "then"
          ? (resolve: (r: unknown[]) => void) => resolve([currentAddress])
          : () => rows),
      });
      return rows;
    }
    return chain(table);
  };
  const db = {
    select: op("select"),
    insert: op("insert"),
    update: op("update"),
    delete: op("delete"),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
  };
  return { authMock: vi.fn(), invalidate: vi.fn(), dbCalls, refs, db };
});

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/search-index", () => ({ invalidateSearchIndex: invalidate }));
vi.mock("@/server/realtime", () => ({ publish: vi.fn() }));
vi.mock("@/server/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/server/deal-note", () => ({ writeDealNote: vi.fn() }));
vi.mock("@/server/booking-mail", () => ({ queueBookingMail: vi.fn() }));
// Адрес проверяется своим тестом (listing-actions, listing-address); здесь он
// просто проходит.
vi.mock("@/server/listing-address", () => ({
  resolveListingAddress: async () => ({
    ok: true,
    fields: { address: "улица Красная", location: "улица Красная", lat: 45.03, lon: 38.97, geoPrecision: "street" },
  }),
}));

import { bookingRequests } from "@db/schema";
import { createListing, updateListing, setListingStatus } from "@/server/actions/owner";
import {
  adminBanUser, adminCreateCategory, adminCreateCity, adminDeleteCategory,
  adminSetCityActive, adminSetListingStatus, adminUnbanUser, adminUpdateCity,
} from "@/server/actions/admin";

refs.bookingRequests = bookingRequests;

const owner = { user: { id: "u1", bannedAt: null } };
const admin = { user: { id: "admin", role: "admin", bannedAt: null } };

const form = {
  title: "Перфоратор Bosch", categoryId: "cat", cityId: "city", description: "",
  priceDay: 500, depositType: "none", quantity: 1,
  handoverPickup: true, handoverDelivery: false, photos: [],
  address: { mode: "keep" },
};

beforeEach(() => {
  vi.clearAllMocks();
  dbCalls.length = 0;
});

describe("invalidateSearchIndex в мутациях владельца", () => {
  beforeEach(() => authMock.mockResolvedValue(owner));

  it.each([
    ["createListing", () => createListing(form)],
    ["updateListing", () => updateListing("L1", form)],
    ["setListingStatus", () => setListingStatus("L1", "hidden")],
  ])("%s сбрасывает индекс", async (_name, run) => {
    expect(await run()).toMatchObject({ ok: true });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("не сбрасывает индекс, когда мутация отказала", async () => {
    expect(await setListingStatus("L1", "evil" as never)).toEqual({ ok: false, error: "bad_status" });
    expect(await createListing({ ...form, title: "" })).toMatchObject({ ok: false });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("invalidateSearchIndex в мутациях админки", () => {
  beforeEach(() => authMock.mockResolvedValue(admin));

  it.each([
    ["adminSetListingStatus", () => adminSetListingStatus("L1", "hidden")],
    ["adminBanUser", () => adminBanUser("u2", "спам в объявлениях")],
    ["adminUnbanUser", () => adminUnbanUser("u2")],
    ["adminCreateCategory", () => adminCreateCategory({ name: "Лодки" })],
    ["adminDeleteCategory", () => adminDeleteCategory("cat")],
    ["adminCreateCity", () => adminCreateCity({ name: "Энск" })],
    ["adminUpdateCity", () => adminUpdateCity("city", { name: "Энск" })],
    ["adminSetCityActive", () => adminSetCityActive("city", false)],
  ])("%s сбрасывает индекс", async (_name, run) => {
    expect(await run()).toMatchObject({ ok: true });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("не сбрасывает индекс без прав админа", async () => {
    authMock.mockResolvedValue(owner);
    expect(await adminSetListingStatus("L1", "hidden")).toEqual({ ok: false, error: "forbidden" });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

// Слаг города — первый сегмент адреса: город «Search» перекрыл бы /search и
// остался бы без страниц.
describe("adminCreateCity и занятые маршрутами слаги", () => {
  beforeEach(() => authMock.mockResolvedValue(admin));

  it.each(["Search", "Sources", "Admin", "Cabinet"])("отказывает городу «%s»", async (name) => {
    const res = await adminCreateCity({ name });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/занят/);
    expect(dbCalls).not.toContain("insert");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("пропускает обычное название", async () => {
    expect(await adminCreateCity({ name: "Казань" })).toEqual({ ok: true, data: undefined });
    expect(dbCalls).toContain("insert");
  });
});
