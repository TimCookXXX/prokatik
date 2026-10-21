import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Пустая выдача /search — цель `search_zero` с причиной; непустая — без цели.
// Текст запроса в параметры не идёт. Каждый показ выдачи — ещё и событие своей
// статистики с подписанными данными: что искали и что нашлось.
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
// Настоящий track (он и шлёт цель), но с записью вызовов.
vi.mock("@/components/analytics/track", async (orig) => {
  const real = await orig<typeof import("@/components/analytics/track")>();
  return { ...real, track: vi.fn(real.track) };
});

import {
  searchListings, getAvailabilityRows, getAllCategories, getSearchFacets,
} from "@/server/catalog";
import { rankListingIds } from "@/server/search";
import { SearchResults } from "@/components/catalog/SearchResults";
import { track } from "@/components/analytics/track";
import { verifyPageData, type SearchPageData } from "@/lib/analytics/token";

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
  vi.mocked(track).mockClear();
  // Маяк в jsdom некуда слать: событие проверяется по вызову track.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
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

describe("SearchResults: событие search", () => {
  const searchCalls = () => vi.mocked(track).mock.calls.filter((c) => c[0] === "search");
  const lastData = () => {
    const [, data] = searchCalls().at(-1)!;
    return verifyPageData((data as { token: string }).token) as SearchPageData & { ts: number };
  };

  it("подписывает, что искали и что нашлось; запрос маскирован", async () => {
    vi.mocked(rankListingIds).mockResolvedValue({ ids: ["1", "2"], usedQuery: "дрель", dropped: [] });
    vi.mocked(searchListings).mockResolvedValue({ items: [item], total: 1 });
    render(await SearchResults({ city, q: "дрель 89181234567", searchParams: { q: "дрель 89181234567", sort: "new" } }));
    expect(searchCalls()).toHaveLength(1);
    expect(lastData()).toMatchObject({
      k: "search", q: "дрель ***", total: 1, matched: 2, reason: null, partial: false,
      cityIds: ["c1"], dates: false, where: false, filters: false, sort: "new", page: 1,
    });
  });

  it("пустая выдача: причина в данных и в цели", async () => {
    render(await SearchResults({ city, q: "каяк", searchParams: { q: "каяк" } }));
    expect(lastData()).toMatchObject({ total: 0, matched: 0, reason: "no_match", partial: false });
    expect(searchCalls()[0][1]).toMatchObject({ zero: "no_match" });
  });

  // Решение владельца: человек увидел похожее — это не «ничего не нашёл».
  it("нашлось по части слов — флаг partial, без цели «ничего не нашёл»", async () => {
    vi.mocked(rankListingIds).mockResolvedValue({ ids: ["1"], usedQuery: "перфоратор макита", dropped: ["hr9999"] });
    vi.mocked(searchListings).mockResolvedValue({ items: [item], total: 1 });
    render(await SearchResults({
      city, q: "перфоратор макита hr9999", searchParams: { q: "перфоратор макита hr9999" },
    }));
    expect(lastData()).toMatchObject({ total: 1, partial: true, usedQuery: "перфоратор макита", reason: null });
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it("страница за концом — событие с past_end, цели нет", async () => {
    vi.mocked(rankListingIds).mockResolvedValue({ ids: ["1"], usedQuery: "дрель", dropped: [] });
    vi.mocked(searchListings).mockResolvedValue({ items: [], total: 3 });
    render(await SearchResults({ city, q: "дрель", searchParams: { q: "дрель", page: "4" } }));
    expect(lastData()).toMatchObject({ total: 3, reason: "past_end", page: 4 });
    expect(searchCalls()[0][1]).toMatchObject({ zero: undefined });
  });

  it("раздел, даты и фильтры — да/нет и слаг раздела", async () => {
    vi.mocked(getAllCategories).mockResolvedValue([{ id: "k1", slug: "tools", parentId: null, name: "Инструменты" }] as never);
    render(await SearchResults({
      city, q: "", searchParams: { category: "tools", from: "2099-01-01", to: "2099-01-02", deposit: "none" },
    }));
    expect(lastData()).toMatchObject({ q: "", category: "tools", filters: true });
  });

  // Сортировка — новое событие; цель «ничего не нашёл» за тот же показ — нет.
  it("смена сортировки — новое событие без повтора цели; вид — ни того, ни другого", async () => {
    const { rerender } = render(await SearchResults({ city, q: "каяк", searchParams: { q: "каяк" } }));
    rerender(await SearchResults({ city, q: "каяк", searchParams: { q: "каяк", view: "list" } }));
    expect(searchCalls()).toHaveLength(1);
    rerender(await SearchResults({ city, q: "каяк", searchParams: { q: "каяк", view: "list", sort: "new" } }));
    expect(searchCalls()).toHaveLength(2);
    expect(searchCalls()[1][2]).toEqual({ goal: false });
    expect(reachGoal).toHaveBeenCalledTimes(1);
  });
});
