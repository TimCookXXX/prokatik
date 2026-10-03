import { beforeEach, describe, expect, it, vi } from "vitest";

// /{city}/{seg}/{sub}: карточка товара и подкатегория.
//
// Город вещи задаёт её адрес: новый адрес переносит объявление в другой город
// региона, и старая ссылка под прежним городом должна уводить на настоящий, а
// не отдавать 404.

const krasnodar = { id: "C-KRD", slug: "krasnodar", name: "Краснодар", nameLocative: "Краснодаре" };
const yablonovskiy = { id: "C-YAB", slug: "yablonovskiy", name: "Яблоновский", nameLocative: "Яблоновском" };
const cities = [krasnodar, yablonovskiy];
const LISTING_ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";

const catalog = vi.hoisted(() => ({
  getCityBySlug: vi.fn(),
  getCityById: vi.fn(),
  getActiveListingById: vi.fn(),
  getCategoryById: vi.fn(),
  getSellerById: vi.fn(),
  getCategoryBySlug: vi.fn(),
  getAllCategories: vi.fn(),
  getListingCountsByCategory: vi.fn(),
}));
const city = vi.hoisted(() => ({ getCityScope: vi.fn() }));

vi.mock("@/server/catalog", () => catalog);
vi.mock("@/server/city", () => city);
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/server/booking", () => ({ getUserPhone: vi.fn() }));
vi.mock("@/server/chat", () => ({ findThreadByListing: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (href: string) => { throw new Error(`REDIRECT ${href}`); },
}));

const { default: CitySubPage, generateMetadata } = await import("@/app/(public)/[city]/[seg]/[sub]/page");

const props = (city: string, sp: Record<string, string> = {}) => ({
  params: Promise.resolve({ city, seg: "tools", sub: `drill-${LISTING_ID}` }),
  searchParams: Promise.resolve(sp),
});

beforeEach(() => {
  catalog.getCityBySlug.mockImplementation(async (slug: string) => cities.find((c) => c.slug === slug) ?? null);
  catalog.getCityById.mockImplementation(async (id: string) => cities.find((c) => c.id === id) ?? null);
  catalog.getActiveListingById.mockResolvedValue({
    id: LISTING_ID, slug: "drill", title: "Дрель", cityId: krasnodar.id, categoryId: "K1",
    ownerUserId: "U1", status: "active", priceDay: 500, description: null,
  });
  catalog.getCategoryById.mockResolvedValue({ id: "K1", slug: "tools", parentId: null, name: "Инструменты" });
  catalog.getSellerById.mockResolvedValue({ id: "U1", name: "Полина", bannedAt: null });
});

describe("/{city}/{cat}/{slug}-{id} under a former city", () => {
  it("redirects to the listing's own city and keeps the carried query", async () => {
    await expect(CitySubPage(props("yablonovskiy", { from: "2026-10-10", loc: "p:45.035,38.975", utm: "x" })))
      .rejects.toThrow(`REDIRECT /krasnodar/tools/drill-${LISTING_ID}?from=2026-10-10&loc=p%3A45.035%2C38.975`);
  });

  it("puts the real city into canonical instead of answering 404", async () => {
    const meta = await generateMetadata(props("yablonovskiy"));
    expect(String(meta.alternates?.canonical)).toMatch(new RegExp(`/krasnodar/tools/drill-${LISTING_ID}$`));
  });

  it("is still 404 when the listing's city is not active", async () => {
    catalog.getCityById.mockResolvedValue(null);
    catalog.getActiveListingById.mockResolvedValue({
      id: LISTING_ID, slug: "drill", title: "Дрель", cityId: "C-OFF", categoryId: "K1",
      ownerUserId: "U1", status: "active", priceDay: 500, description: null,
    });
    await expect(CitySubPage(props("yablonovskiy"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

// С точкой «Где» выдача идёт по региону, но страница подкатегории живёт по
// позициям самого города: иначе с точкой она есть, а её canonical — 404.
describe("/{city}/{root}/{sub} with a «Где» point", () => {
  beforeEach(() => {
    catalog.getCategoryBySlug.mockResolvedValue({ id: "K1", slug: "tools", parentId: null, name: "Инструменты" });
    catalog.getAllCategories.mockResolvedValue([
      { id: "K1", slug: "tools", parentId: null, name: "Инструменты" },
      { id: "K2", slug: "drills", parentId: "K1", name: "Дрели" },
    ]);
    city.getCityScope.mockResolvedValue({
      region: true, nearby: true, cityIds: [krasnodar.id, yablonovskiy.id],
      near: { point: { lat: 45, lon: 39 }, label: null, source: "address", precision: "house" },
    });
    // Дрели есть только в Яблоновском.
    catalog.getListingCountsByCategory.mockImplementation(async (ids: string[]) =>
      new Map(ids.includes(yablonovskiy.id) ? [["K2", 3]] : []));
  });

  const subProps = { params: Promise.resolve({ city: "krasnodar", seg: "tools", sub: "drills" }),
    searchParams: Promise.resolve({ loc: "p:45.000,39.000" }) };

  it("is 404 when the subcategory is empty in the city itself", async () => {
    const el = await CitySubPage(subProps);
    const Sub = el.type as (p: unknown) => Promise<unknown>;
    await expect(Sub(el.props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(catalog.getListingCountsByCategory).toHaveBeenCalledWith([krasnodar.id]);
  });
});
