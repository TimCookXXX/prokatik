import { describe, expect, it } from "vitest";
import { ZERO_REASONS, zeroReason } from "@/lib/search/zero-reason";

const base = { q: "каяк", ranked: { ids: [] as string[] }, page: 1, narrowed: false };

describe("zeroReason", () => {
  it("индекс упал — index_failed", () => {
    expect(zeroReason({ ...base, ranked: undefined })).toBe("index_failed");
  });

  it("в запросе одни стоп-слова — stopwords", () => {
    expect(zeroReason({ ...base, q: "прокат в", ranked: { ids: null } })).toBe("stopwords");
  });

  it("индекс ничего не нашёл — no_match, с фильтрами тоже", () => {
    expect(zeroReason(base)).toBe("no_match");
    expect(zeroReason({ ...base, narrowed: true })).toBe("no_match");
  });

  it("совпадения были, выдачу обнулили даты или фильтры — filtered", () => {
    expect(zeroReason({ ...base, ranked: { ids: ["L1"] }, narrowed: true })).toBe("filtered");
  });

  it("страница за концом списка — past_end, раньше любой другой причины", () => {
    expect(zeroReason({ ...base, page: 3 })).toBe("past_end");
    expect(zeroReason({ ...base, ranked: undefined, page: 2 })).toBe("past_end");
  });

  it("без запроса: пустой город — empty_city, обнулили фильтры — filtered", () => {
    expect(zeroReason({ q: "", ranked: null, page: 1, narrowed: false })).toBe("empty_city");
    expect(zeroReason({ q: "", ranked: null, page: 1, narrowed: true })).toBe("filtered");
  });

  it("каждая причина из списка достижима", () => {
    const seen = new Set([
      zeroReason({ ...base, ranked: undefined }),
      zeroReason({ ...base, ranked: { ids: null } }),
      zeroReason(base),
      zeroReason({ ...base, ranked: { ids: ["L1"] } }),
      zeroReason({ ...base, page: 2 }),
      zeroReason({ q: "", ranked: null, page: 1, narrowed: false }),
    ]);
    expect([...seen].sort()).toEqual([...ZERO_REASONS].sort());
  });
});
