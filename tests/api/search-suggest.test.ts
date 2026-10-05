import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Роут подсказок «Что»: форма ответа (запросы и разделы, без объявлений и
// чисел), ссылки, даты, «Где», кэш и лимит. Город и индекс мокаются: индекс
// собирается из фикстуры поиска тем же buildListingIndex, что и в проде, —
// проверяется сборка ответа, а не дополнение (его покрывает
// tests/search/complete.test.ts).
vi.mock("@/server/catalog", () => ({ getCityBySlug: vi.fn(), getFreeSearchIds: vi.fn() }));
vi.mock("@/server/search-index", () => ({ getSearchIndex: vi.fn() }));
// Набор городов при точке «Где» решает getCityScope (геоданные городов в БД).
vi.mock("@/server/city", () => ({ getCityScope: vi.fn() }));

import { getCityBySlug, getFreeSearchIds } from "@/server/catalog";
import { getCityScope } from "@/server/city";
import { addDaysStr, todayStr } from "@/lib/catalog/dates";
import { getSearchIndex } from "@/server/search-index";
import { buildListingIndex } from "@/lib/search/listing-index";
import { _resetForTests } from "@/lib/rate-limit";
import { GET } from "@/app/api/search/suggest/route";
import { CATEGORIES, CITY_NAMES, ROWS, countsOf } from "../search/fixture";

const CITY = { id: "c1", slug: "krasnodar", name: "Краснодар" };
const EMPTY = { queries: [], categories: [] };

const index = (rows = ROWS) => ({ ix: buildListingIndex(rows, CATEGORIES, countsOf(rows), CITY_NAMES) });

const catById = new Map(CATEGORIES.map((c) => [c.id, c]));

function get(query: string, ip = "1.2.3.4") {
  return GET(new NextRequest(`http://localhost/api/search/suggest?${query}`, {
    headers: { "x-forwarded-for": ip },
  }));
}

const ask = async (q: string, extra = "") =>
  (await get(`city=krasnodar&q=${encodeURIComponent(q)}${extra ? `&${extra}` : ""}`)).json();

const texts = (body: { queries: { text: string }[] }) => body.queries.map((x) => x.text);

beforeEach(() => {
  _resetForTests();
  vi.mocked(getCityBySlug).mockReset();
  vi.mocked(getCityBySlug).mockImplementation(async (slug) => (slug === CITY.slug ? CITY : null) as never);
  vi.mocked(getSearchIndex).mockReset();
  // Новый снимок на каждый тест: кэш дополнений живёт на снимке индекса.
  vi.mocked(getSearchIndex).mockImplementation(async () => index() as never);
  vi.mocked(getFreeSearchIds).mockReset();
  vi.mocked(getCityScope).mockReset();
  vi.mocked(getCityScope).mockImplementation(async (city) => ({
    region: false, near: null, cityIds: [city.id], nearby: false,
  }));
});

describe("GET /api/search/suggest", () => {
  it("answers query completions and sections, without listings or counts", async () => {
    const res = await get(`city=krasnodar&q=${encodeURIComponent("перф")}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(["categories", "queries"]);
    expect(texts(body)).toEqual(["перфоратор"]);
    for (const q of body.queries) expect(Object.keys(q).sort()).toEqual(["href", "text"]);
    for (const c of body.categories) expect(Object.keys(c).sort()).toEqual(["href", "name"]);
    expect(JSON.stringify(body)).not.toMatch(/"(items|count|priceDay|photoUrl|id)"/);
  });

  it("links a query to /search in the page's city", async () => {
    const body = await ask("перфоратор мак");
    expect(body.queries).toEqual([{
      text: "перфоратор makita",
      href: `/search?${new URLSearchParams({ q: "перфоратор makita", city: "krasnodar" })}`,
    }]);
  });

  it("gives at most six completions", async () => {
    const body = await ask("ка");
    expect(body.queries.length).toBeLessThanOrEqual(6);
  });

  it("links a subsection by its root and own slug", async () => {
    const body = await ask("электроинструменты");
    const sub = CATEGORIES.find((c) => c.name === "Электроинструменты")!;
    const root = catById.get(sub.parentId!)!;

    expect(body.categories[0]).toEqual({
      name: "Электроинструменты",
      href: `/krasnodar/${root.slug}/${sub.slug}`,
    });
    for (const c of body.categories) expect(c.href).toMatch(/^\/krasnodar\/[a-z0-9-]+(\/[a-z0-9-]+)?$/);
  });

  it("answers nothing for an empty or one-letter query, without reading the index", async () => {
    for (const q of ["", "п", " "]) {
      const res = await get(`city=krasnodar&q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(EMPTY);
    }
    expect(getSearchIndex).not.toHaveBeenCalled();
  });

  it("answers no completion when nothing matches", async () => {
    expect(texts(await ask("кувалдометр"))).toEqual([]);
  });

  it("lets the browser cache the answer privately for 30 seconds", async () => {
    const res = await get("city=krasnodar&q=karcher");
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
  });

  it("refuses with 429 and an empty answer over 300 requests a minute", async () => {
    for (let i = 0; i < 300; i++) expect((await get("city=krasnodar&q=")).status).toBe(200);

    const res = await get("city=krasnodar&q=");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual(EMPTY);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);

    // Лимит по IP: соседний адрес не задет.
    expect((await get("city=krasnodar&q=", "5.6.7.8")).status).toBe(200);
  });

  it("answers 400 without a city and 404 for an unknown one", async () => {
    expect((await get("q=karcher")).status).toBe(400);
    const res = await get("city=atlantis&q=karcher");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(EMPTY);
    expect(getSearchIndex).not.toHaveBeenCalled();
  });

  it("answers 503 with an empty list when the index cannot be built", async () => {
    vi.mocked(getSearchIndex).mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get("city=krasnodar&q=karcher");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual(EMPTY);
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });

  // Даты — те же правила, что у выдачи: с валидным диапазоном фраза остаётся,
  // только если выдача на эти дни непуста. Иначе подсказка вела бы в пустую
  // выдачу.
  describe("with dates", () => {
    const from = addDaysStr(todayStr(), 3);
    const to = addDaysStr(todayStr(), 5);

    it("checks every candidate phrase's ids in one query and drops phrases with nothing free", async () => {
      // «ка»: несколько фраз; свободна только одна вещь — Karcher K5.
      const plain = await ask("ка");
      expect(plain.queries.length).toBeGreaterThan(1);
      const k5 = ROWS.find((r) => r.title.startsWith("Мойка высокого давления Karcher"))!.id;
      vi.mocked(getFreeSearchIds).mockImplementation(async (_c, ids) => new Set(ids.filter((id) => id === k5)));

      const body = await ask("ка", `from=${from}&to=${to}`);
      expect(texts(body)).toEqual(["karcher"]);

      expect(getFreeSearchIds).toHaveBeenCalledTimes(1);
      const [cityIds, ids, f, t] = vi.mocked(getFreeSearchIds).mock.calls[0];
      expect(cityIds).toEqual([CITY.id]);
      expect(ids).toContain(k5);
      expect(new Set(ids).size).toBe(ids.length);
      expect([f, t]).toEqual([from, to]);
    });

    it("does not filter by a broken, half or past range", async () => {
      for (const dates of [`from=${from}`, "from=2027-02-30&to=2027-03-02", "from=2020-01-01&to=2020-01-03"]) {
        expect(texts(await ask("перф", dates))).toEqual(["перфоратор"]);
      }
      expect(getFreeSearchIds).not.toHaveBeenCalled();
    });

    it("keeps sections when nothing is free", async () => {
      vi.mocked(getFreeSearchIds).mockResolvedValue(new Set());
      const body = await ask("электроинструменты", `from=${from}&to=${to}`);
      expect(body.queries).toEqual([]);
      expect(body.categories.length).toBeGreaterThan(0);
    });
  });

  // С точкой «Где» выдача идёт по всем городам региона, и подсказки — по тому
  // же набору: фраза обещает то, что найдёт выдача по этому адресу.
  describe("with «Где»", () => {
    const NEIGHBOUR = { id: "c2", slug: "yablonovskiy" };
    const loc = `loc=${encodeURIComponent("p:45.0,38.9")}&lp=s`;

    it("takes the index of the whole region when a point is set", async () => {
      vi.mocked(getCityScope).mockResolvedValue({
        region: true, near: null, cityIds: [CITY.id, NEIGHBOUR.id], nearby: true,
      });
      const res = await get(`city=krasnodar&q=${encodeURIComponent("перфоратор")}&${loc}`);
      expect(res.status).toBe(200);

      expect(getCityScope).toHaveBeenCalledWith(
        expect.objectContaining({ id: CITY.id }),
        expect.objectContaining({ loc: "p:45.0,38.9", lp: "s" }),
      );
      expect(getSearchIndex).toHaveBeenCalledWith([CITY.id, NEIGHBOUR.id]);
    });

    it("stays in the city without a point", async () => {
      await get(`city=krasnodar&q=${encodeURIComponent("перфоратор")}`);
      expect(getCityScope).not.toHaveBeenCalled();
      expect(getSearchIndex).toHaveBeenCalledWith([CITY.id]);
    });

    it("checks dates over the region and links into the page's city", async () => {
      vi.mocked(getCityScope).mockResolvedValue({
        region: true, near: null, cityIds: [CITY.id, NEIGHBOUR.id], nearby: true,
      });
      vi.mocked(getFreeSearchIds).mockImplementation(async (_c, ids) => new Set(ids));
      const from = addDaysStr(todayStr(), 3);
      const to = addDaysStr(todayStr(), 5);
      const body = await ask("инструмент", `${loc}&from=${from}&to=${to}`);

      expect(vi.mocked(getFreeSearchIds).mock.calls[0][0]).toEqual([CITY.id, NEIGHBOUR.id]);
      for (const q of body.queries) expect(q.href).toMatch(/&city=krasnodar$/);
      for (const c of body.categories) expect(c.href).toMatch(/^\/krasnodar\//);
    });
  });
});
