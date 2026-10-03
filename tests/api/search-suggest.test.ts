import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Роут подсказок «Что»: форма ответа, канонические ссылки, кэш и лимит.
// Город и индекс мокаются: индекс собирается из фикстуры поиска тем же
// buildListingIndex, что и в проде, — проверяется сборка ответа, а не скоринг
// (его покрывает tests/search).
vi.mock("@/server/catalog", () => ({ getCityBySlug: vi.fn() }));
vi.mock("@/server/search-index", () => ({ getSearchIndex: vi.fn() }));

import { getCityBySlug } from "@/server/catalog";
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
});
