import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Полоса «Рядом с вами»: форма ответа без координат и километров, округление
// точки, набор городов региона, город без геоданных и лимит. Чтение из базы и
// набор городов мокаются — запрос к базе проверяет catalog-public-columns.
vi.mock("@/server/catalog", () => ({
  getCityBySlug: vi.fn(),
  getNearbyListings: vi.fn(),
  listingPhotos: (l: { photosJson: unknown }) => (Array.isArray(l.photosJson) ? l.photosJson : []),
}));
vi.mock("@/server/city", () => ({ getCityScope: vi.fn() }));

import { getCityBySlug, getNearbyListings } from "@/server/catalog";
import { getCityScope } from "@/server/city";
import { parseLocation } from "@/lib/geo/location";
import { _resetForTests } from "@/lib/rate-limit";
import { GET } from "@/app/api/listings/nearby/route";

const CITY = { id: "c1", slug: "krasnodar", name: "Краснодар" };
const NEIGHBOUR = "c2";

function row(id: string, km: number, approx = false, photos: unknown[] = []) {
  return {
    listing: {
      id, slug: `item-${id}`, title: `Вещь ${id}`, priceDay: 500, photosJson: photos,
      geoPrecision: "house", location: "улица Красная",
    },
    ownerName: "Артём", ownerImage: null, ownerIsVerified: false,
    categorySlug: "instrumenty", citySlug: id === "L2" ? "yablonovskiy" : "krasnodar", cityName: "Краснодар",
    distance: { km, approx },
  };
}

function get(query: string, ip = "1.2.3.4") {
  return GET(new NextRequest(`http://localhost/api/listings/nearby?${query}`, {
    headers: { "x-forwarded-for": ip },
  }));
}

const LOC = `loc=${encodeURIComponent("p:45.035123,38.975456")}&lp=s`;

beforeEach(() => {
  _resetForTests();
  vi.mocked(getCityBySlug).mockReset();
  vi.mocked(getCityBySlug).mockImplementation(async (slug) => (slug === CITY.slug ? CITY : null) as never);
  vi.mocked(getCityScope).mockReset();
  vi.mocked(getCityScope).mockImplementation(async (city, sp) => ({
    region: true, near: parseLocation(sp), cityIds: [city.id, NEIGHBOUR], nearby: true,
  }));
  vi.mocked(getNearbyListings).mockReset();
  vi.mocked(getNearbyListings).mockResolvedValue([
    row("L1", 0.42, false, [{ url: "https://cdn.example/p.webp", width: 1, height: 1 }]),
    row("L2", 3.4, true),
  ] as never);
});

describe("GET /api/listings/nearby", () => {
  it("answers cards with a distance label and nothing that locates the listing", async () => {
    const res = await get(`city=krasnodar&${LOC}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    const body = await res.json();

    expect(body.items).toEqual([
      {
        id: "L1", title: "Вещь L1", priceDay: 500,
        href: "/krasnodar/instrumenty/item-L1-L1",
        photoUrl: "https://cdn.example/p.webp",
        distanceLabel: "400 м", distanceTitle: "по прямой",
      },
      {
        id: "L2", title: "Вещь L2", priceDay: 500,
        href: "/yablonovskiy/instrumenty/item-L2-L2",
        photoUrl: null,
        distanceLabel: "≈ 3 км", distanceTitle: "по прямой",
      },
    ]);
    const text = JSON.stringify(body);
    for (const leak of ['"km"', '"lat"', '"lon"', '"address"', '"location"', "0.42", "3.4"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("rounds the point to three decimals and reads the whole region", async () => {
    await get(`city=krasnodar&${LOC}&la=${encodeURIComponent("улица Красная, 1")}`);
    expect(getCityScope).toHaveBeenCalledWith(
      expect.objectContaining({ id: CITY.id }),
      expect.objectContaining({ loc: "p:45.035,38.975", lp: "s" }),
    );
    const [cityIds, near, limit] = vi.mocked(getNearbyListings).mock.calls[0];
    expect(cityIds).toEqual([CITY.id, NEIGHBOUR]);
    expect(near.point).toEqual({ lat: 45.035, lon: 38.975 });
    expect(near.precision).toBe("street");
    expect(limit).toBe(8);
  });

  it("answers nothing in a city without geodata", async () => {
    vi.mocked(getCityScope).mockResolvedValue({ region: false, near: null, cityIds: [CITY.id], nearby: false });
    const body = await (await get(`city=krasnodar&${LOC}`)).json();
    expect(body).toEqual({ items: [] });
    expect(getNearbyListings).not.toHaveBeenCalled();
  });

  it("answers nothing without a point or with garbage instead of it", async () => {
    for (const q of ["city=krasnodar", "city=krasnodar&loc=d:12", "city=krasnodar&loc=p:991,1"]) {
      const res = await get(q);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ items: [] });
    }
    expect(getNearbyListings).not.toHaveBeenCalled();
  });

  it("answers 400 without a city and 404 for an unknown one", async () => {
    expect((await get(LOC)).status).toBe(400);
    const res = await get(`city=atlantis&${LOC}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ items: [] });
  });

  it("answers 503 with an empty list when the read fails", async () => {
    vi.mocked(getNearbyListings).mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get(`city=krasnodar&${LOC}`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ items: [] });
    } finally {
      err.mockRestore();
    }
  });

  it("shares the search limit and refuses with 429 and an empty answer over it", async () => {
    for (let i = 0; i < 300; i++) expect((await get(`city=krasnodar&${LOC}`)).status).toBe(200);
    const res = await get(`city=krasnodar&${LOC}`);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ items: [] });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
