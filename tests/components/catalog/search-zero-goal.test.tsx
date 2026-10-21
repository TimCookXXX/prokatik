import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Пустая выдача /search — цель `search_zero` с причиной; непустая — без цели.
// Текст запроса в параметры не идёт.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/catalog", async (orig) => ({
  ...(await orig<typeof import("@/server/catalog")>()),
  searchListings: vi.fn(),
  getAvailabilityRows: vi.fn(),
  getAllCategories: vi.fn(),
  getSearchFacets: vi.fn(),
}));
vi.mock("@/server/search", () => ({ rankListingIds: vi.fn() }));
const reachGoal = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/goals", () => ({ reachGoal }));

import {
  searchListings, getAvailabilityRows, getAllCategories, getSearchFacets,
} from "@/server/catalog";
import { rankListingIds } from "@/server/search";
import { SearchResults } from "@/components/catalog/SearchResults";

const city = { id: "c1", slug: "kazan", name: "Казань" } as never;
const item = {
  listing: {
    id: "1", ownerUserId: "u1", slug: "l-1", title: "Дрель", quantity: 1, priceDay: 500,
    depositType: "money", depositAmount: 3000, location: "Центр",
    handoverPickup: true, handoverDelivery: false, photosJson: [],
  },
  ownerName: "Артём", ownerImage: null, ownerIsVerified: true,
  categorySlug: "elektroinstrumenty", cityName: "Казань",
} as never;

beforeEach(() => {
  reachGoal.mockClear();
  vi.mocked(searchListings).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(getAvailabilityRows).mockResolvedValue([]);
  vi.mocked(getAllCategories).mockResolvedValue([]);
  vi.mocked(getSearchFacets).mockResolvedValue({ countsByCategory: new Map(), minPriceDay: null, maxPriceDay: null });
  vi.mocked(rankListingIds).mockReset();
  vi.mocked(rankListingIds).mockResolvedValue({ ids: [], usedQuery: "каяк", dropped: [] });
});

describe("SearchResults: цель search_zero", () => {
  it("ничего не нашлось по запросу — no_match, без текста запроса", async () => {
    render(await SearchResults({ city, q: "каяк", searchParams: { q: "каяк" } }));
    expect(reachGoal).toHaveBeenCalledTimes(1);
    expect(reachGoal).toHaveBeenCalledWith("search_zero", { reason: "no_match" });
    expect(JSON.stringify(reachGoal.mock.calls)).not.toContain("каяк");
  });

  it("совпадения были, обнулили даты или фильтры — filtered", async () => {
    vi.mocked(rankListingIds).mockResolvedValue({ ids: ["1"], usedQuery: "дрель", dropped: [] });
    render(await SearchResults({ city, q: "дрель", searchParams: { q: "дрель", price_min: "99999" } }));
    expect(reachGoal).toHaveBeenCalledWith("search_zero", { reason: "filtered" });
  });

  it("индекс упал — index_failed", async () => {
    vi.mocked(rankListingIds).mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    render(await SearchResults({ city, q: "дрель", searchParams: { q: "дрель" } }));
    expect(reachGoal).toHaveBeenCalledWith("search_zero", { reason: "index_failed" });
  });

  // Старая ссылка или робот на ?page=7 — не неудачный поиск.
  it("страница за концом — цели нет", async () => {
    vi.mocked(rankListingIds).mockResolvedValue({ ids: ["1"], usedQuery: "дрель", dropped: [] });
    vi.mocked(searchListings).mockResolvedValue({ items: [], total: 3 });
    render(await SearchResults({ city, q: "дрель", searchParams: { q: "дрель", page: "4" } }));
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it("пустой город без запроса — empty_city", async () => {
    render(await SearchResults({ city, q: "", searchParams: {} }));
    expect(reachGoal).toHaveBeenCalledWith("search_zero", { reason: "empty_city" });
  });

  it("выдача не пуста — цели нет", async () => {
    vi.mocked(rankListingIds).mockResolvedValue({ ids: ["1"], usedQuery: "дрель", dropped: [] });
    vi.mocked(searchListings).mockResolvedValue({ items: [item], total: 1 });
    render(await SearchResults({ city, q: "дрель", searchParams: { q: "дрель" } }));
    expect(reachGoal).not.toHaveBeenCalled();
  });

  // Смена вида (сетка/список) и сортировки — тот же показ; новые условия — новый.
  it("перерисовка с другим видом или сортировкой не шлёт второй раз, новый запрос — шлёт", async () => {
    const { rerender } = render(await SearchResults({ city, q: "каяк", searchParams: { q: "каяк" } }));
    rerender(await SearchResults({ city, q: "каяк", searchParams: { q: "каяк", view: "list" } }));
    rerender(await SearchResults({ city, q: "каяк", searchParams: { q: "каяк", view: "list", sort: "new" } }));
    expect(reachGoal).toHaveBeenCalledTimes(1);
    rerender(await SearchResults({ city, q: "байдарка", searchParams: { q: "байдарка" } }));
    expect(reachGoal).toHaveBeenCalledTimes(2);
  });
});
