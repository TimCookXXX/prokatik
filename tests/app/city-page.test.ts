import { beforeEach, describe, expect, it, vi } from "vitest";

// Витрина города без объявлений — не 404 (на неё ведёт селектор города), но и
// не в индекс: noindex в метаданных.

const krasnodar = { id: "C-KRD", slug: "krasnodar", name: "Краснодар", nameLocative: "Краснодаре" };
const kazan = { id: "C-KZN", slug: "kazan", name: "Казань", nameLocative: null };

const catalog = vi.hoisted(() => ({
  getCityBySlug: vi.fn(),
  getAllCategories: vi.fn(),
  getListingCountsByCategory: vi.fn(),
  getCategoryStats: vi.fn(),
}));
const city = vi.hoisted(() => ({ getCityScope: vi.fn() }));
vi.mock("@/server/catalog", () => catalog);
vi.mock("@/server/city", () => city);
vi.mock("@/components/catalog/CategoryListing", () => ({ CategoryListing: () => null }));

const { default: CityPage, generateMetadata } = await import("@/app/(public)/[city]/page");
const props = (slug = "krasnodar") => ({ params: Promise.resolve({ city: slug }), searchParams: Promise.resolve({}) });
// Цены форматируются с неразрывными пробелами; сравнение — по обычным.
const plain = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/ /g, " "));

beforeEach(() => {
  catalog.getCityBySlug.mockImplementation(async (slug: string) => [krasnodar, kazan].find((c) => c.slug === slug) ?? null);
  catalog.getAllCategories.mockResolvedValue([{ id: "K1", parentId: null }, { id: "K2", parentId: "K1" }]);
  catalog.getCategoryStats.mockResolvedValue({
    listingCount: 3, ownerCount: 2, minPriceDay: 150, maxPriceDay: 900, avgDeposit: null,
  });
  city.getCityScope.mockResolvedValue({ region: false, near: null, cityIds: [krasnodar.id], nearby: false });
});

describe("метаданные /{city}", () => {
  it("пустой город — noindex, follow; canonical на себя", async () => {
    catalog.getListingCountsByCategory.mockResolvedValue(new Map());
    const meta = await generateMetadata(props());
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(String(meta.alternates?.canonical)).toMatch(/\/krasnodar$/);
    expect(catalog.getListingCountsByCategory).toHaveBeenCalledWith([krasnodar.id]);
  });

  it("город с объявлениями индексируется", async () => {
    catalog.getListingCountsByCategory.mockResolvedValue(new Map([["K1", 3]]));
    expect((await generateMetadata(props())).robots).toBeUndefined();
  });

  it("title — «Аренда и прокат вещей в городе — от N ₽/сутки» по всем разделам города", async () => {
    catalog.getListingCountsByCategory.mockResolvedValue(new Map([["K1", 3]]));
    const meta = await generateMetadata(props());
    expect(plain(meta.title)).toEqual({ absolute: "Аренда и прокат вещей в Краснодаре — от 150 ₽/сутки" });
    expect(catalog.getCategoryStats).toHaveBeenCalledWith([krasnodar.id], ["K1", "K2"]);
  });

  it("город без падежа — «· Казань», без « ,»", async () => {
    catalog.getListingCountsByCategory.mockResolvedValue(new Map([["K1", 3]]));
    const meta = await generateMetadata(props("kazan"));
    expect(plain(meta.title)).toEqual({ absolute: "Аренда и прокат вещей · Казань — от 150 ₽/сутки" });
    expect(meta.description).toContain("Всё для аренды · Казань:");
    expect(String(meta.description)).not.toContain(" ,");
  });
});

describe("страница /{city}", () => {
  it("BreadcrumbList «Главная → Город» с абсолютными адресами", async () => {
    const tree = await CityPage(props()) as { props: { children: Array<{ props?: { data?: Record<string, unknown> } }> } };
    const ld = tree.props.children.map((c) => c?.props?.data).find((d) => d?.["@type"] === "BreadcrumbList");
    const items = ld!.itemListElement as Array<{ name: string; item: string; position: number }>;
    expect(items.map((i) => [i.position, i.name, new URL(i.item).pathname])).toEqual([
      [1, "Главная", "/"],
      [2, "Краснодар", "/krasnodar"],
    ]);
  });
});
