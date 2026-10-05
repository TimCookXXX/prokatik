import { beforeEach, describe, expect, it, vi } from "vitest";

// Страница выдачи за её концом — настоящий 404, а не пустая сетка с кодом 200.
// Пустая первая страница остаётся: фильтры, которые отсеяли всё, — законный
// адрес с EmptyState.

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/server/catalog", async (orig) => ({
  ...(await orig<typeof import("@/server/catalog")>()),
  getListingsForCategories: vi.fn(),
  getCategoryStats: vi.fn(),
  getAllCategories: vi.fn(),
  getListingCountsByCategory: vi.fn(),
  getAvailabilityRows: vi.fn(),
}));

import {
  DEFAULT_PAGE_SIZE, getAllCategories, getAvailabilityRows, getCategoryStats,
  getListingCountsByCategory, getListingsForCategories,
} from "@/server/catalog";
import { CategoryListing } from "@/components/catalog/CategoryListing";

const city = { id: "c1", slug: "kazan", name: "Казань" } as never;
const run = (page: string | undefined) => CategoryListing({
  city, categoryIds: ["k1"], basePath: "/kazan", activeLabel: "Все", searchParams: page ? { page } : {},
});

beforeEach(() => {
  vi.mocked(getCategoryStats).mockResolvedValue({
    listingCount: 0, ownerCount: 0, minPriceDay: null, maxPriceDay: null, avgDeposit: null,
  });
  vi.mocked(getAllCategories).mockResolvedValue([]);
  vi.mocked(getListingCountsByCategory).mockResolvedValue(new Map());
  vi.mocked(getAvailabilityRows).mockResolvedValue([]);
});

describe("CategoryListing: номер страницы", () => {
  it("за последней страницей — 404", async () => {
    vi.mocked(getListingsForCategories).mockResolvedValue({ items: [], total: DEFAULT_PAGE_SIZE + 1 });
    await expect(run("3")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(run("9999")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("последняя существующая страница рендерится", async () => {
    vi.mocked(getListingsForCategories).mockResolvedValue({ items: [], total: DEFAULT_PAGE_SIZE + 1 });
    await expect(run("2")).resolves.toBeTruthy();
  });

  it("пустая выдача: первая страница — 200, вторая — 404", async () => {
    vi.mocked(getListingsForCategories).mockResolvedValue({ items: [], total: 0 });
    await expect(run(undefined)).resolves.toBeTruthy();
    await expect(run("2")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
