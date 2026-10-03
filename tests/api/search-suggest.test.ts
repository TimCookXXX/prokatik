import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Роут подсказок «Что»: форма ответа, канонические ссылки, кэш и лимит.
// Город и индекс мокаются: индекс собирается из фикстуры поиска тем же
// buildListingIndex, что и в проде, — проверяется сборка ответа, а не скоринг
// (его покрывает tests/search).
vi.mock("@/server/catalog", () => ({ getCityBySlug: vi.fn(), getFreeListingIds: vi.fn() }));
vi.mock("@/server/search-index", () => ({ getSearchIndex: vi.fn() }));

import { getCityBySlug, getFreeListingIds } from "@/server/catalog";
import { addDaysStr, todayStr } from "@/lib/catalog/dates";
import { getSearchIndex } from "@/server/search-index";
import { buildListingIndex } from "@/lib/search/listing-index";
import { _resetForTests } from "@/lib/rate-limit";
import { GET } from "@/app/api/search/suggest/route";
import { CATEGORIES, CITY_NAMES, ROWS, countsOf } from "../search/fixture";

const CITY = { id: "c1", slug: "krasnodar", name: "Краснодар" };

const rows = ROWS.map((r, i) => ({
  ...r, cityId: CITY.id, priceDay: 300 + i, photoUrl: i === 0 ? "https://cdn.example/p.webp" : null,
}));

function index() {
  return {
    ix: buildListingIndex(rows, CATEGORIES, countsOf(rows), CITY_NAMES),
    categories: new Map(CATEGORIES.map((c) => [c.id, c])),
    citySlugs: new Map([[CITY.id, CITY.slug]]),
  };
}

const catById = new Map(CATEGORIES.map((c) => [c.id, c]));

function get(query: string, ip = "1.2.3.4") {
  return GET(new NextRequest(`http://localhost/api/search/suggest?${query}`, {
    headers: { "x-forwarded-for": ip },
  }));
}

beforeEach(() => {
  _resetForTests();
  vi.mocked(getCityBySlug).mockReset();
  vi.mocked(getCityBySlug).mockImplementation(async (slug) => (slug === CITY.slug ? CITY : null) as never);
  vi.mocked(getSearchIndex).mockReset();
  vi.mocked(getSearchIndex).mockResolvedValue(index() as never);
  vi.mocked(getFreeListingIds).mockReset();
});

describe("GET /api/search/suggest", () => {
  it("answers listings and sections in the documented shape", async () => {
    const res = await get(`city=krasnodar&q=${encodeURIComponent("перфоратор")}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(6);
    expect(body.categories.length).toBeLessThanOrEqual(4);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(["categoryName", "href", "id", "photoUrl", "priceDay", "title"]);
    }
    expect(body.items.map((i: { title: string }) => i.title)).toContain("Перфоратор Bosch GBH 2-26 DFR");
  });

  it("gives canonical hrefs without query", async () => {
    const res = await get(`city=krasnodar&q=${encodeURIComponent("перфоратор")}`);
    const body = await res.json();

    const bosch = body.items.find((i: { title: string }) => i.title.startsWith("Перфоратор Bosch"));
    const row = rows.find((r) => r.id === bosch.id)!;
    const cat = catById.get(row.categoryId)!;
    expect(bosch.href).toBe(`/krasnodar/${cat.slug}/${row.slug}-${row.id}`);
    expect(bosch.categoryName).toBe(cat.name);
    expect(bosch.priceDay).toBe(row.priceDay);
    expect(bosch.photoUrl).toBe("https://cdn.example/p.webp");

    for (const c of body.categories) expect(c.href).toMatch(/^\/krasnodar\/[a-z0-9-]+(\/[a-z0-9-]+)?$/);
  });

  it("links a subsection by its root and own slug", async () => {
    const res = await get(`city=krasnodar&q=${encodeURIComponent("электроинструменты")}`);
    const body = await res.json();
    const sub = CATEGORIES.find((c) => c.name === "Электроинструменты")!;
    const root = catById.get(sub.parentId!)!;

    expect(body.categories[0]).toMatchObject({
      name: "Электроинструменты",
      href: `/krasnodar/${root.slug}/${sub.slug}`,
    });
    expect(body.categories[0].count).toBe(countsOf(rows).get(sub.id));
  });

  it("answers popular sections and no listings for an empty or one-letter query", async () => {
    for (const q of ["", "п"]) {
      const body = await (await get(`city=krasnodar&q=${encodeURIComponent(q)}`)).json();
      expect(body.items).toEqual([]);
      expect(body.categories.length).toBeGreaterThan(0);
      expect(body.categories.length).toBeLessThanOrEqual(4);
      // Популярные — подразделы: у ссылки два сегмента после города.
      for (const c of body.categories) expect(c.href.split("/")).toHaveLength(4);
    }
  });

  it("lets the browser cache the answer privately for 30 seconds", async () => {
    const res = await get("city=krasnodar&q=karcher");
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
  });

  it("refuses with 429 and an empty answer over 300 requests a minute", async () => {
    for (let i = 0; i < 300; i++) expect((await get("city=krasnodar&q=")).status).toBe(200);

    const res = await get("city=krasnodar&q=");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ items: [], categories: [] });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);

    // Лимит по IP: соседний адрес не задет.
    expect((await get("city=krasnodar&q=", "5.6.7.8")).status).toBe(200);
  });

  it("answers 400 without a city and 404 for an unknown one", async () => {
    expect((await get("q=karcher")).status).toBe(400);
    const res = await get("city=atlantis&q=karcher");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ items: [], categories: [] });
    expect(getSearchIndex).not.toHaveBeenCalled();
  });

  it("answers 503 with an empty list when the index cannot be built", async () => {
    vi.mocked(getSearchIndex).mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get("city=krasnodar&q=karcher");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ items: [], categories: [] });
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });

  // Даты — те же правила, что у выдачи: с валидным диапазоном в подсказки идут
  // только свободные на все дни, иначе подсказка вела бы на карточку, где
  // виджет сразу скажет «Занято».
  describe("with dates", () => {
    const from = addDaysStr(todayStr(), 3);
    const to = addDaysStr(todayStr(), 5);
    const q = encodeURIComponent("перфоратор");

    it("filters busy listings out and checks the candidates in one query", async () => {
      const plain = await (await get(`city=krasnodar&q=${q}`)).json();
      const busy = plain.items[0].id;
      vi.mocked(getFreeListingIds).mockImplementation(async (ids) => new Set(ids.filter((id) => id !== busy)));

      const body = await (await get(`city=krasnodar&q=${q}&from=${from}&to=${to}`)).json();
      expect(body.items.map((i: { id: string }) => i.id)).not.toContain(busy);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.length).toBeLessThanOrEqual(6);

      expect(getFreeListingIds).toHaveBeenCalledTimes(1);
      const [ids, f, t] = vi.mocked(getFreeListingIds).mock.calls[0];
      expect(ids).toContain(busy);
      expect(ids.length).toBeLessThanOrEqual(50);
      expect([f, t]).toEqual([from, to]);
    });

    it("fills six free suggestions from deeper candidates", async () => {
      // «инструмент» совпадает у 18 объявлений фикстуры: первые шесть заняты,
      // и на их место поднимаются свободные кандидаты ниже по списку.
      const many = encodeURIComponent("инструмент");
      const plain = await (await get(`city=krasnodar&q=${many}`)).json();
      expect(plain.items).toHaveLength(6);
      const top = new Set<string>(plain.items.map((i: { id: string }) => i.id));
      vi.mocked(getFreeListingIds).mockImplementation(async (ids) => new Set(ids.filter((id) => !top.has(id))));

      const body = await (await get(`city=krasnodar&q=${many}&from=${from}&to=${to}`)).json();
      expect(body.items).toHaveLength(6);
      for (const item of body.items) expect(top.has(item.id)).toBe(false);
    });

    it("does not filter by a broken, half or past range", async () => {
      for (const dates of [`from=${from}`, "from=2027-02-30&to=2027-03-02", "from=2020-01-01&to=2020-01-03"]) {
        const body = await (await get(`city=krasnodar&q=${q}&${dates}`)).json();
        expect(body.items.length).toBeGreaterThan(0);
      }
      expect(getFreeListingIds).not.toHaveBeenCalled();
    });

    it("keeps sections when every candidate is busy", async () => {
      vi.mocked(getFreeListingIds).mockResolvedValue(new Set());
      const body = await (await get(`city=krasnodar&q=${encodeURIComponent("электроинструменты")}&from=${from}&to=${to}`)).json();
      expect(body.items).toEqual([]);
      expect(body.categories.length).toBeGreaterThan(0);
    });
  });
});
