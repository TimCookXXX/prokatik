import { describe, it, expect, vi, beforeEach } from "vitest";

// Чипы «Часто ищут» под поиском hero: кандидаты, по которым в городе есть хотя
// бы одно объявление в режиме подсказок. Индекс собирается из фикстуры поиска
// тем же buildListingIndex, что и в проде.
vi.mock("@/server/catalog", () => ({ getFreeSearchIds: vi.fn() }));
vi.mock("@/server/search-index", () => ({ getSearchIndex: vi.fn() }));
// Настоящий скоринг, но со счётчиком вызовов — для проверки подсчёта про запас.
vi.mock("@/lib/search/listing-index", async (orig) => {
  const mod = await orig<typeof import("@/lib/search/listing-index")>();
  return { ...mod, rankListings: vi.fn(mod.rankListings) };
});

import { getSearchIndex } from "@/server/search-index";
import { buildListingIndex, rankListings } from "@/lib/search/listing-index";
import { getPopularQueries, POPULAR_QUERIES_MAX } from "@/server/search";
import { content } from "@theme/content";
import { CATEGORIES, CITY_NAMES, ROWS, countsOf } from "../search/fixture";

const CITY = "c1";

/** Новый объект индекса — как после сборки: подсчёт чипов на нём ещё не делался. */
const freshIndex = () => ({
  ix: buildListingIndex(ROWS, CATEGORIES, countsOf(ROWS), CITY_NAMES),
}) as never;

beforeEach(() => {
  vi.mocked(getSearchIndex).mockReset();
  vi.mocked(getSearchIndex).mockResolvedValue(freshIndex());
  vi.mocked(rankListings).mockClear();
});

describe("getPopularQueries", () => {
  it("keeps only candidates with a hit in the city, in their order", async () => {
    const out = await getPopularQueries(CITY, ["сапборд", "дирижабль", "перфоратор", "телескоп", "палатка"]);
    expect(out).toEqual(["сапборд", "перфоратор", "палатка"]);
    expect(getSearchIndex).toHaveBeenCalledWith([CITY]);
  });

  it("stops at eight chips", async () => {
    const out = await getPopularQueries(CITY, [
      "сапборд", "перфоратор", "шуруповёрт", "велосипед", "мойка", "генератор",
      "электросамокат", "платье", "автокресло", "коляска", "бензопила",
    ]);
    expect(out).toHaveLength(POPULAR_QUERIES_MAX);
    expect(out[0]).toBe("сапборд");
  });

  it("finds something for the shipped candidates on the seed titles", async () => {
    expect((await getPopularQueries(CITY, content.home.popularQueries)).length).toBeGreaterThan(0);
  });

  // Главная зовёт подсчёт на каждый рендер: пока индекс тот же, скоринг не
  // повторяется; новый индекс — новый подсчёт.
  it("counts once per index and again on a new one", async () => {
    const candidates = ["сапборд", "дирижабль", "перфоратор"];
    const first = await getPopularQueries(CITY, candidates);
    const calls = vi.mocked(rankListings).mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    expect(await getPopularQueries(CITY, candidates)).toEqual(first);
    expect(rankListings).toHaveBeenCalledTimes(calls);

    vi.mocked(getSearchIndex).mockResolvedValue(freshIndex());
    expect(await getPopularQueries(CITY, candidates)).toEqual(first);
    expect(rankListings).toHaveBeenCalledTimes(calls * 2);
  });

  // Чипы — украшение: сломанный индекс не должен ронять главную.
  it("answers an empty list when the index fails", async () => {
    vi.mocked(getSearchIndex).mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await getPopularQueries(CITY, ["сапборд"])).toEqual([]);
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });
});
