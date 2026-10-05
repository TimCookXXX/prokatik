import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetSuggestCache, cachedSuggest, fetchSuggest, suggestQuery } from "@/components/search/suggest-client";

// Кэш ответов живёт, пока жива вкладка, а индекс на сервере меняется: ответ
// старше max-age роута — промах, а не подсказка по прошлому индексу.
const REPLY = {
  queries: [{ text: "дрель", href: "/search?q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C&city=kazan" }],
  categories: [{ name: "Электроинструменты", href: "/kazan/instrumenty/elektro" }],
};
let body: unknown = REPLY;
const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));

beforeEach(() => {
  _resetSuggestCache();
  fetchMock.mockClear();
  body = REPLY;
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const later = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

describe("suggest cache", () => {
  it("answers a repeated query from memory while the reply is fresh", async () => {
    await fetchSuggest("kazan", "дрель");
    later(29_000);
    expect(cachedSuggest("kazan", "  Дрель")).toEqual(REPLY);
    await fetchSuggest("kazan", "дрель");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks the server again once the reply is older than the route's max-age", async () => {
    await fetchSuggest("kazan", "дрель");
    later(30_000);
    expect(cachedSuggest("kazan", "дрель")).toBeUndefined();
    await fetchSuggest("kazan", "дрель");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("suggestQuery", () => {
  it("ignores case and extra spaces but keeps one trailing space", () => {
    expect(suggestQuery("  Перфоратор   МАК")).toBe("перфоратор мак");
    expect(suggestQuery("перфоратор   ")).toBe("перфоратор ");
    expect(suggestQuery("перфоратор ")).not.toBe(suggestQuery("перфоратор"));
  });
});

describe("fetchSuggest", () => {
  // Тело прежней формы (объявления в `items`) могло остаться в кэше браузера.
  it("reads a body without queries as sections only", async () => {
    body = { items: [{ id: "l1" }], categories: REPLY.categories };
    expect(await fetchSuggest("kazan", "дрель")).toEqual({ queries: [], categories: REPLY.categories });
  });

  it("sends the trailing space to the server", async () => {
    await fetchSuggest("kazan", "дрель ");
    expect(fetchMock).toHaveBeenCalledWith("/api/search/suggest?city=kazan&q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C+");
  });
});
