import { describe, expect, it } from "vitest";
import { searchSubmitHref, type SearchPanelValue } from "@/lib/search/submit-href";

const text = (q: string, rest: Omit<SearchPanelValue, "what"> = {}): SearchPanelValue => ({ what: { kind: "text", q }, ...rest });
const dates = { from: "2026-10-10", to: "2026-10-12" };
const where = { loc: "p:45.035,38.975", la: "ул. Красная", lp: "s" };

// По строке на каждую строку таблицы «Куда ведёт отправка» в плане поиска.
describe("searchSubmitHref", () => {
  it("listing suggestion — its canonical path with dates and «Где»", () => {
    const href = searchSubmitHref(
      { what: { kind: "listing", href: "/krasnodar/elektroinstrumenty/drel-01J0000000000000000000000" }, ...dates, loc: where },
      { pathname: "/cabinet", searchParams: "", citySlug: "krasnodar" },
    );
    expect(href).toBe(
      "/krasnodar/elektroinstrumenty/drel-01J0000000000000000000000?from=2026-10-10&to=2026-10-12&loc=p%3A45.035%2C38.975&la=%D1%83%D0%BB.+%D0%9A%D1%80%D0%B0%D1%81%D0%BD%D0%B0%D1%8F&lp=s",
    );
  });

  it("category — its canonical path; nothing else is carried from the page", () => {
    const href = searchSubmitHref(
      { what: { kind: "category", href: "/krasnodar/instrumenty/elektroinstrumenty" }, ...dates },
      { pathname: "/search", searchParams: "q=дрель&price_max=500&page=3", citySlug: "krasnodar" },
    );
    expect(href).toBe("/krasnodar/instrumenty/elektroinstrumenty?from=2026-10-10&to=2026-10-12");
  });

  it("free text — /search with the city; category, price and deposit are not carried", () => {
    const href = searchSubmitHref(
      text("  дрель  ", { ...dates, loc: where }),
      { pathname: "/search", searchParams: "q=пила&category=instrumenty&price_max=500&deposit=none&page=2", citySlug: "krasnodar" },
    );
    const url = new URL(href!, "http://x");
    expect(url.pathname).toBe("/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "дрель", city: "krasnodar", from: "2026-10-10", to: "2026-10-12", loc: "p:45.035,38.975", la: "ул. Красная", lp: "s",
    });
  });

  it("«Показать все по «q»» — the same as free text", () => {
    expect(searchSubmitHref(text("дрель"), { pathname: "/", searchParams: "", citySlug: "spb" })).toBe("/search?q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C&city=spb");
  });

  it("free text without a known city — /search without city", () => {
    expect(searchSubmitHref(text("дрель"), { pathname: "/", searchParams: "" })).toBe("/search?q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C");
  });

  it("empty on /search — drops q, keeps facets, takes dates and «Где» from the panel, resets the page", () => {
    const href = searchSubmitHref(
      text("", { from: "2026-11-01", to: "2026-11-02" }),
      { pathname: "/search", searchParams: "q=дрель&city=krasnodar&category=instrumenty&from=2026-10-01&to=2026-10-02&loc=p:1,2&page=4", citySlug: "krasnodar" },
    );
    const url = new URL(href!, "http://x");
    expect(url.pathname).toBe("/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      city: "krasnodar", category: "instrumenty", from: "2026-11-01", to: "2026-11-02",
    });
  });

  it("empty on a city or category page — the same path, panel values replace, empty ones removed", () => {
    expect(searchSubmitHref(
      text(" ", { loc: where }),
      { pathname: "/krasnodar/instrumenty", searchParams: "price_max=900&from=2026-10-01&to=2026-10-02&page=2", citySlug: "krasnodar" },
    )).toBe("/krasnodar/instrumenty?price_max=900&loc=p%3A45.035%2C38.975&la=%D1%83%D0%BB.+%D0%9A%D1%80%D0%B0%D1%81%D0%BD%D0%B0%D1%8F&lp=s");
    expect(searchSubmitHref(text(""), { pathname: "/krasnodar", searchParams: "from=2026-10-01&to=2026-10-02", citySlug: "krasnodar" }))
      .toBe("/krasnodar");
  });

  it("empty with dates or «Где» on another page — the city page", () => {
    expect(searchSubmitHref(text("", dates), { pathname: "/cabinet", searchParams: "tab=1", citySlug: "krasnodar" }))
      .toBe("/krasnodar?from=2026-10-10&to=2026-10-12");
    expect(searchSubmitHref(text("", { loc: { loc: "p:1,2" } }), { pathname: "/", searchParams: "", citySlug: "krasnodar" }))
      .toBe("/krasnodar?loc=p%3A1%2C2");
  });

  it("empty with nothing on another page — no navigation", () => {
    expect(searchSubmitHref(text(""), { pathname: "/", searchParams: "", citySlug: "krasnodar" })).toBeNull();
    expect(searchSubmitHref(text("", { from: "", to: null, loc: {} }), { pathname: "/cabinet", searchParams: "" })).toBeNull();
  });

  it("a first path segment that is not the city is not a city page", () => {
    expect(searchSubmitHref(text("", dates), { pathname: "/cabinet/listings", searchParams: "", citySlug: "krasnodar" }))
      .toBe("/krasnodar?from=2026-10-10&to=2026-10-12");
  });
});
