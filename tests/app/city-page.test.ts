import { beforeEach, describe, expect, it, vi } from "vitest";

// Витрина города без объявлений — не 404 (на неё ведёт селектор города), но и
// не в индекс: noindex в метаданных.

const krasnodar = { id: "C-KRD", slug: "krasnodar", name: "Краснодар", nameLocative: "Краснодаре" };

const catalog = vi.hoisted(() => ({
  getCityBySlug: vi.fn(),
  getAllCategories: vi.fn(),
  getListingCountsByCategory: vi.fn(),
}));
vi.mock("@/server/catalog", () => catalog);
vi.mock("@/server/city", () => ({ getCityScope: vi.fn() }));
vi.mock("@/components/catalog/CategoryListing", () => ({ CategoryListing: () => null }));

const { generateMetadata } = await import("@/app/(public)/[city]/page");
const props = { params: Promise.resolve({ city: "krasnodar" }), searchParams: Promise.resolve({}) };

beforeEach(() => {
  catalog.getCityBySlug.mockResolvedValue(krasnodar);
});

describe("метаданные /{city}", () => {
  it("пустой город — noindex, follow; canonical на себя", async () => {
    catalog.getListingCountsByCategory.mockResolvedValue(new Map());
    const meta = await generateMetadata(props);
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(String(meta.alternates?.canonical)).toMatch(/\/krasnodar$/);
    expect(catalog.getListingCountsByCategory).toHaveBeenCalledWith([krasnodar.id]);
  });

  it("город с объявлениями индексируется", async () => {
    catalog.getListingCountsByCategory.mockResolvedValue(new Map([["K1", 3]]));
    expect((await generateMetadata(props)).robots).toBeUndefined();
  });
});
