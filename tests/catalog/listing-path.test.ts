import { describe, it, expect } from "vitest";
import { canonicalHref, categoryPath, extractListingId, listingPath } from "@/lib/catalog/listing-path";

describe("extractListingId", () => {
  it("splits slug and ULID tail", () => {
    expect(extractListingId("drel-bosch-01ARZ3NDEKTSV4RRFFQ69G5FAV"))
      .toEqual({ slug: "drel-bosch", id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
  });
  it("returns null for a plain subcategory slug", () => {
    expect(extractListingId("dreli")).toBeNull();
  });
  it("returns null when tail is not a ULID", () => {
    expect(extractListingId("kovrik-2")).toBeNull();
  });
});

describe("listingPath", () => {
  it("builds the canonical path", () => {
    expect(listingPath("kazan", "dreli", "drel-bosch", "01ARZ3NDEKTSV4RRFFQ69G5FAV"))
      .toBe("/kazan/dreli/drel-bosch-01ARZ3NDEKTSV4RRFFQ69G5FAV");
  });
});

// Ссылки на раздел — только канонические: подкатегория под своим корнем,
// прямой /{city}/{sub} живёт лишь редиректом.
describe("categoryPath", () => {
  it("корень — /{city}/{root}", () => {
    expect(categoryPath("kazan", { slug: "instrumenty" })).toBe("/kazan/instrumenty");
    expect(categoryPath("kazan", { slug: "instrumenty" }, null)).toBe("/kazan/instrumenty");
  });
  it("подкатегория — /{city}/{root}/{sub}", () => {
    expect(categoryPath("kazan", { slug: "dreli" }, { slug: "instrumenty" })).toBe("/kazan/instrumenty/dreli");
  });
});

// Канонический редирект (старый слаг карточки, подраздел по неверному пути)
// переносит даты, количество и «Где»; остальное — фильтры, мусор — нет.
describe("canonicalHref", () => {
  const path = "/kazan/dreli/drel-bosch-01ARZ3NDEKTSV4RRFFQ69G5FAV";

  it("без query — голый путь", () => {
    expect(canonicalHref(path, {})).toBe(path);
  });

  it("переносит белый список в его порядке", () => {
    const href = canonicalHref(path, {
      lp: "s", src: "geo", la: "ул. Красная", loc: "p:45.035,38.975", qty: "2", to: "2026-10-12", from: "2026-10-10",
    });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe(path);
    expect([...url.searchParams.keys()]).toEqual(["from", "to", "qty", "loc", "la", "src", "lp"]);
    expect(url.searchParams.get("la")).toBe("ул. Красная");
  });

  it("отбрасывает всё вне белого списка и пустые значения", () => {
    const href = canonicalHref(path, {
      from: "2026-10-10", to: "", price_min: "300", sort: "price_asc", utm_source: "x", page: "2",
    });
    expect(href).toBe(`${path}?from=2026-10-10`);
  });

  it("из повторённого параметра берёт первое значение", () => {
    expect(canonicalHref(path, { qty: ["2", "5"] })).toBe(`${path}?qty=2`);
  });
});
