import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Верхняя панель выдачи теперь рендерится всегда, а календарь в ней зовёт
// useRouter() уже на рендере — без мока jsdom падает на «app router».
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/server/catalog", async (orig) => ({
  ...(await orig<typeof import("@/server/catalog")>()),
  searchListings: vi.fn(),
  getAvailabilityRows: vi.fn(),
  getAllCategories: vi.fn(),
  getSearchFacets: vi.fn(),
}));

// Ранжирование идёт по индексу в памяти — здесь он не нужен, важно, что
// выдача берёт его набор id и порядок.
vi.mock("@/server/search", () => ({ rankListingIds: vi.fn() }));

import {
  searchListings, getAvailabilityRows, getAllCategories, getSearchFacets,
} from "@/server/catalog";
import { rankListingIds } from "@/server/search";
import { SearchResults } from "@/components/catalog/SearchResults";
import { addDaysStr, shortRangeLabel, todayStr } from "@/lib/catalog/dates";

const city = { id: "c1", slug: "kazan", name: "Казань" } as never;

function item(id: string, title: string) {
  return {
    listing: {
      id, ownerUserId: "u1", slug: `l-${id}`, title,
      quantity: 1, priceDay: 500,
      depositType: "money", depositAmount: 3000, location: "Центр",
      handoverPickup: true, handoverDelivery: false, photosJson: [],
    },
    ownerName: "Артём", ownerImage: null, ownerIsVerified: true,
    categorySlug: "elektroinstrumenty", cityName: "Казань",
  } as never;
}

const root = {
  id: "cat1", parentId: null, name: "Электроинструмент",
  slug: "elektroinstrumenty",
} as never;

// В setup.ts нет clearMocks, а мок модуля один на весь файл — значения задаём
// заново перед каждым тестом, иначе состояние течёт между ними.
beforeEach(() => {
  vi.mocked(searchListings).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(getAvailabilityRows).mockResolvedValue([]);
  vi.mocked(getAllCategories).mockResolvedValue([]);
  vi.mocked(getSearchFacets).mockResolvedValue({
    countsByCategory: new Map(), minPriceDay: null, maxPriceDay: null,
  });
  vi.mocked(rankListingIds).mockReset();
  vi.mocked(rankListingIds).mockResolvedValue({ ids: [], usedQuery: "", dropped: [] });
});

describe("SearchResults", () => {
  it("shows the city feed when there is no query", async () => {
    vi.mocked(searchListings).mockResolvedValue({
      items: [item("1", "Перфоратор Bosch")], total: 1,
    });

    render(await SearchResults({ city, q: "", searchParams: {} }));

    expect(screen.getByText("Перфоратор Bosch")).toBeInTheDocument();
    expect(screen.queryByText(/Введите запрос/)).not.toBeInTheDocument();
  });

  it("asks the database for the whole city when there is no query", async () => {
    await SearchResults({ city, q: "", searchParams: {} });

    expect(searchListings).toHaveBeenCalledWith("c1", { text: "" }, expect.anything(), undefined);
    expect(rankListingIds).not.toHaveBeenCalled();
  });

  // Панель — единственный способ снять фильтр дат, поэтому она обязана быть на
  // месте и тогда, когда выдача пуста.
  it("keeps dates, sorting and view controls on an empty result", async () => {
    // Даты от сегодняшнего дня: прошедший диапазон фильтром больше не считается.
    const from = addDaysStr(todayStr(), 7);
    const to = addDaysStr(todayStr(), 9);
    render(await SearchResults({ city, q: "", searchParams: { from, to } }));

    expect(screen.getByText(shortRangeLabel(from, to))).toBeInTheDocument();
  });

  // Карточки показывают свободу на выбранные дни, а не на сегодня: выдача уже
  // отфильтрована по ним, и «Занято» из-за сегодняшнего дня было бы ложью.
  it("loads availability for the selected range", async () => {
    vi.mocked(searchListings).mockResolvedValue({ items: [item("L1", "Дрель")], total: 1 } as never);
    const from = addDaysStr(todayStr(), 7);
    const to = addDaysStr(todayStr(), 20);
    await SearchResults({ city, q: "", searchParams: { from, to } });
    expect(getAvailabilityRows).toHaveBeenCalledWith(["L1"], from, to);

    vi.mocked(getAvailabilityRows).mockClear();
    await SearchResults({ city, q: "", searchParams: {} });
    expect(getAvailabilityRows).toHaveBeenCalledWith(["L1"], todayStr(), addDaysStr(todayStr(), 6));
  });

  it("shows section facets in the sidebar without a query", async () => {
    vi.mocked(getAllCategories).mockResolvedValue([root]);
    vi.mocked(getSearchFacets).mockResolvedValue({
      countsByCategory: new Map([["cat1", 7]]),
      minPriceDay: null, maxPriceDay: null,
    });

    render(await SearchResults({ city, q: "", searchParams: {} }));

    expect(screen.getByText("Электроинструмент")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("blames the query when a search yields nothing", async () => {
    render(await SearchResults({ city, q: "дрель", searchParams: { q: "дрель" } }));

    expect(screen.getByText(/Ничего не найдено по запросу/)).toBeInTheDocument();
  });

  it("blames the filters when they empty the feed", async () => {
    render(await SearchResults({ city, q: "", searchParams: { price_min: "100000" } }));

    expect(screen.getByText(/По этим условиям/)).toBeInTheDocument();
  });

  it("blames nobody when the city itself is empty", async () => {
    render(await SearchResults({ city, q: "", searchParams: {} }));

    expect(screen.getByText(/пока нечего арендовать/)).toBeInTheDocument();
  });

  it("searches by the ids the index ranked, in its order", async () => {
    vi.mocked(rankListingIds).mockResolvedValue({ ids: ["2", "1"], usedQuery: "дрель", dropped: [] });

    await SearchResults({ city, q: "дрель", searchParams: { q: "дрель" } });

    expect(rankListingIds).toHaveBeenCalledWith(["c1"], "дрель");
    expect(searchListings).toHaveBeenCalledWith(
      "c1", { ids: ["2", "1"] }, expect.objectContaining({ sort: "relevance" }), undefined,
    );
    expect(getSearchFacets).toHaveBeenCalledWith("c1", { ids: ["2", "1"] }, expect.anything());
  });

  // Меню показывает действующую сортировку, а не сырой параметр: без него
  // раньше подсвечивался первый пункт («свободные»), хотя порядок был другим.
  it("shows the effective sort in the menu", async () => {
    const { unmount } = render(await SearchResults({ city, q: "", searchParams: {} }));
    expect(screen.getByText("новые")).toBeInTheDocument();
    unmount();

    vi.mocked(rankListingIds).mockResolvedValue({ ids: ["1"], usedQuery: "дрель", dropped: [] });
    render(await SearchResults({ city, q: "дрель", searchParams: { q: "дрель" } }));
    expect(screen.getByText("подходящие")).toBeInTheDocument();
  });

  it("keeps an explicit sort=new under a query", async () => {
    vi.mocked(rankListingIds).mockResolvedValue({ ids: ["1"], usedQuery: "дрель", dropped: [] });
    render(await SearchResults({ city, q: "дрель", searchParams: { q: "дрель", sort: "new" } }));

    expect(screen.getByText("новые")).toBeInTheDocument();
    expect(searchListings).toHaveBeenCalledWith(
      "c1", { ids: ["1"] }, expect.objectContaining({ sort: "new" }), undefined,
    );
  });

  it("tells which part of the query the results are for", async () => {
    vi.mocked(rankListingIds).mockResolvedValue({
      ids: ["1"], usedQuery: "перфоратор", dropped: ["зелёный"],
    });
    vi.mocked(searchListings).mockResolvedValue({ items: [item("1", "Перфоратор Bosch")], total: 1 });

    render(await SearchResults({
      city, q: "зелёный перфоратор", searchParams: { q: "зелёный перфоратор" },
    }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "По «зелёный перфоратор» ничего — показываем по «перфоратор»",
    );
  });

  it("shows no notice when the whole query matched", async () => {
    vi.mocked(rankListingIds).mockResolvedValue({ ids: ["1"], usedQuery: "дрель", dropped: [] });
    render(await SearchResults({ city, q: "дрель", searchParams: { q: "дрель" } }));

    expect(screen.queryByText(/показываем по/)).not.toBeInTheDocument();
  });

  // В запросе одни стоп-слова: искать нечего — показываем город, как без запроса.
  it("shows the city feed when the query has no searchable words", async () => {
    vi.mocked(rankListingIds).mockResolvedValue({ ids: null, usedQuery: "прокат", dropped: [] });

    await SearchResults({ city, q: "прокат", searchParams: { q: "прокат" } });

    expect(searchListings).toHaveBeenCalledWith(
      "c1", { text: "" }, expect.objectContaining({ sort: "new" }), undefined,
    );
  });

  // Аварийный путь: индекс не собрался — страница жива, поиск идёт ILIKE, а
  // ошибка уходит в лог.
  it("falls back to a text search when the index is unavailable", async () => {
    vi.mocked(rankListingIds).mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(await SearchResults({ city, q: "дрель", searchParams: { q: "дрель" } }));

      expect(searchListings).toHaveBeenCalledWith(
        "c1", { text: "дрель" }, expect.objectContaining({ sort: "new" }), undefined,
      );
      expect(err).toHaveBeenCalled();
      expect(screen.getByText("новые")).toBeInTheDocument();
    } finally {
      err.mockRestore();
    }
  });
});
