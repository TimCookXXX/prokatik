import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECENT_MAX, RECENT_QUERIES_KEY, forgetQuery, parseRecent, readRecentQueries, rememberQuery,
  withRecent, withoutRecent,
} from "@/components/search/recent-queries";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("recent queries: the list", () => {
  it("puts the newest first and keeps at most RECENT_MAX", () => {
    let list: string[] = [];
    for (let i = 1; i <= RECENT_MAX + 3; i++) list = withRecent(list, `запрос ${i}`);
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]).toBe(`запрос ${RECENT_MAX + 3}`);
    expect(list.at(-1)).toBe("запрос 4");
  });

  it("lifts a repeat to the top instead of duplicating it, ignoring case and «ё»", () => {
    const list = withRecent(["палатка", "Шуруповёрт", "дрель"], "  шуруповерт ");
    expect(list).toEqual(["шуруповерт", "палатка", "дрель"]);
  });

  it("ignores an empty query", () => {
    expect(withRecent(["дрель"], "  ")).toEqual(["дрель"]);
  });

  it("removes one query", () => {
    expect(withoutRecent(["дрель", "палатка"], "Дрель")).toEqual(["палатка"]);
  });

  it("reads junk as an empty list", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("{oops")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent('["дрель", 5, "", "палатка"]')).toEqual(["дрель", "палатка"]);
  });
});

describe("recent queries: the storage", () => {
  it("remembers, dedupes and forgets under inrenta_recent_queries", () => {
    rememberQuery("дрель");
    rememberQuery("палатка");
    rememberQuery("Дрель");
    expect(JSON.parse(localStorage.getItem(RECENT_QUERIES_KEY)!)).toEqual(["Дрель", "палатка"]);

    forgetQuery("палатка");
    expect(readRecentQueries()).toEqual(["Дрель"]);
    forgetQuery("дрель");
    expect(localStorage.getItem(RECENT_QUERIES_KEY)).toBeNull();
  });

  // Приватный режим, запрет cookies: хранилище бросает — запросы просто не помним.
  it("survives a storage that throws on every access", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("SecurityError"); });

    expect(() => rememberQuery("дрель")).not.toThrow();
    expect(() => forgetQuery("дрель")).not.toThrow();
    expect(readRecentQueries()).toEqual([]);
  });
});
