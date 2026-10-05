import { describe, it, expect, vi, beforeEach } from "vitest";

// Главное правило подсказок «Что» (docs/decisions/0023): подсказка не ведёт в
// пустую выдачу. Каждая фраза suggestForCity находит в rankListingIds хоть одно
// объявление по всем своим словам, а с датами — хоть одно свободное.
vi.mock("@/server/catalog", () => ({ getFreeSearchIds: vi.fn() }));
vi.mock("@/server/search-index", () => ({ getSearchIndex: vi.fn() }));

import { getFreeSearchIds } from "@/server/catalog";
import { getSearchIndex } from "@/server/search-index";
import { rankListingIds, suggestForCity } from "@/server/search";
import { ROWS, fixtureIndex } from "../search/fixture";

const CITY = { id: "c1", slug: "krasnodar" };
const ix = fixtureIndex();
const INPUTS = ["перф", "перфоратор мак", "перфоратор makita hr", "мак", "ка", "ве", "па", "сап", "бол", "шу", "ин", "мойка к", "керх"];

beforeEach(() => {
  vi.mocked(getSearchIndex).mockReset();
  vi.mocked(getSearchIndex).mockResolvedValue({ ix } as never);
  vi.mocked(getFreeSearchIds).mockReset();
});

describe("suggestForCity → /search", () => {
  it("every suggested phrase finds something in the results by all its words", async () => {
    let checked = 0;
    for (const q of INPUTS) {
      const { queries } = await suggestForCity(CITY, q);
      expect(queries.length, q).toBeLessThanOrEqual(6);
      for (const { text, href } of queries) {
        const ranked = await rankListingIds([CITY.id], text);
        expect(ranked.dropped, text).toEqual([]);
        expect(ranked.ids?.length, text).toBeGreaterThan(0);
        expect(new URL(href, "http://x").searchParams.get("q")).toBe(text);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("with dates every suggested phrase has something free in the results", async () => {
    // Свободна каждая третья вещь.
    const free = new Set(ix.listings.filter((_, i) => i % 3 === 0).map((r) => r.id));
    vi.mocked(getFreeSearchIds).mockImplementation(async (_c, ids) => new Set(ids.filter((id) => free.has(id))));
    const dates = { from: "2026-10-10", to: "2026-10-12" };

    let checked = 0;
    for (const q of INPUTS) {
      const { queries } = await suggestForCity(CITY, q, { dates });
      for (const { text } of queries) {
        const ranked = await rankListingIds([CITY.id], text);
        expect(ranked.ids!.some((id) => free.has(id)), text).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3);
    // Один SQL на ввод — на все фразы сразу.
    expect(vi.mocked(getFreeSearchIds).mock.calls.length).toBeLessThanOrEqual(INPUTS.length);
  });

  // Яблоновский: палаток нет, перфораторы есть. Опечатка в панели — только в
  // слове, набранном целиком, с теми же двумя первыми буквами; разделы — без опечаток.
  it("does not turn a word being typed into a different thing by a typo", async () => {
    vi.mocked(getSearchIndex).mockResolvedValue({ ix: fixtureIndex(ROWS.filter((r) => !/палатк/i.test(r.title))) } as never);
    expect(await suggestForCity(CITY, "палат")).toEqual({ queries: [], categories: [] });
    const perf = await suggestForCity(CITY, "перф");
    expect(perf.queries.map((q) => q.text)).toEqual(["перфоратор"]);
    expect(perf.categories.map((c) => c.name)).not.toContain("Водный спорт");
    expect((await suggestForCity(CITY, "перфаратор")).queries.map((q) => q.text)).toEqual(["перфоратор"]);
  });

  it("suggests nothing for a blank query without reading the index", async () => {
    expect(await suggestForCity(CITY, " п ")).toEqual({ queries: [], categories: [] });
    expect(getSearchIndex).not.toHaveBeenCalled();
  });
});
