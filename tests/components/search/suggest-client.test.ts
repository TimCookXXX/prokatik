import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetSuggestCache, cachedSuggest, fetchSuggest } from "@/components/search/suggest-client";

// Кэш ответов живёт, пока жива вкладка, а индекс на сервере меняется: ответ
// старше max-age роута — промах, а не подсказка по прошлому индексу.
const REPLY = { items: [], categories: [{ name: "Электроинструменты", href: "/kazan/instrumenty/elektro", count: 3 }] };
const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => REPLY }));

beforeEach(() => {
  _resetSuggestCache();
  fetchMock.mockClear();
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
    expect(cachedSuggest("kazan", "Дрель ")).toEqual(REPLY);
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
