import { describe, it, expect } from "vitest";
import { citySwitchHref, pickCitySlug, resolveCitySlug } from "@/lib/catalog/current-city";

const KNOWN = ["kazan", "spb"];

describe("pickCitySlug", () => {
  it("takes the first candidate that is an active city", () => {
    expect(pickCitySlug(["spb", "kazan"], KNOWN)).toBe("spb");
    expect(pickCitySlug([null, "kazan"], KNOWN)).toBe("kazan");
  });

  // Кука живёт год и правится руками, город админ отключает в любой момент.
  // Непроверенный слаг обнулял бы витрину и давал 404 в поиске из шапки.
  it("skips a candidate that is no longer active", () => {
    expect(pickCitySlug(["atlantida", "spb"], KNOWN)).toBe("spb");
    expect(pickCitySlug(["atlantida"], KNOWN)).toBe("kazan");
  });

  it("falls back to the first active city when nothing is chosen", () => {
    expect(pickCitySlug([], KNOWN)).toBe("kazan");
    expect(pickCitySlug([undefined, null], KNOWN)).toBe("kazan");
  });

  // Порядок задаёт вызывающий: витрине — кука вперёд профиля, форме
  // объявления — наоборот.
  it("respects the order it is given", () => {
    expect(pickCitySlug(["kazan", "spb"], KNOWN)).toBe("kazan");
    expect(pickCitySlug(["spb", "kazan"], KNOWN)).toBe("spb");
  });

  it("has nothing to offer when no city is active", () => {
    expect(pickCitySlug(["kazan"], [])).toBeUndefined();
  });
});

describe("resolveCitySlug", () => {
  it("takes the city from the first path segment", () => {
    expect(resolveCitySlug("/spb", "", KNOWN)).toBe("spb");
    expect(resolveCitySlug("/spb/instrumenty", "", KNOWN)).toBe("spb");
    expect(resolveCitySlug("/spb/instrumenty/dreli", "", KNOWN)).toBe("spb");
  });

  it("falls back to ?city= where the path carries no city", () => {
    expect(resolveCitySlug("/search", "?q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C&city=spb", KNOWN))
      .toBe("spb");
    expect(resolveCitySlug("/search", "city=kazan", KNOWN)).toBe("kazan");
  });

  // Путь важнее параметра: человек физически стоит на витрине города, что бы ни
  // осталось в адресе от прошлого перехода.
  it("prefers the path over the query", () => {
    expect(resolveCitySlug("/spb", "?city=kazan", KNOWN)).toBe("spb");
  });

  it("ignores slugs that are not active cities", () => {
    expect(resolveCitySlug("/cabinet/listings", "", KNOWN)).toBeUndefined();
    expect(resolveCitySlug("/search", "?city=atlantida", KNOWN)).toBeUndefined();
    expect(resolveCitySlug("/", "", KNOWN)).toBeUndefined();
    expect(resolveCitySlug("/u/01ARZ3NDEKTSV4RRFFQ69G5FAV", "", KNOWN)).toBeUndefined();
  });
});

describe("citySwitchHref", () => {
  it("leads to the city showcase everywhere but search", () => {
    expect(citySwitchHref("/kazan", "", "spb")).toBe("/spb");
    expect(citySwitchHref("/kazan/instrumenty", "?sort=price_asc", "spb")).toBe("/spb");
    expect(citySwitchHref("/", "", "spb")).toBe("/spb");
  });

  // Смена города на поиске не должна выбрасывать со страницы вместе с запросом.
  it("stays on search and keeps what the person chose for themselves", () => {
    expect(citySwitchHref("/search", "?q=drel&category=instrumenty&sort=price_asc&view=list", "spb"))
      .toBe("/search?q=drel&category=instrumenty&sort=price_asc&view=list&city=spb");
  });

  it("drops what described the city we are leaving", () => {
    expect(citySwitchHref("/search", "?q=drel&price_min=100&from=2026-09-10&page=3", "spb"))
      .toBe("/search?q=drel&city=spb");
  });

  // Точка «Где» описывает место в покинутом городе; «Ближе» без неё не от чего
  // считать — уходит вместе с ней.
  it("drops «Где» and the nearest-first sort", () => {
    expect(citySwitchHref(
      "/search",
      "?q=drel&loc=p%3A45.035%2C38.975&la=%D1%83%D0%BB.&src=geo&lp=s&sort=near&view=list",
      "spb",
    )).toBe("/search?q=drel&view=list&city=spb");
    expect(citySwitchHref("/krasnodar/instrumenty", "?loc=p%3A45.035%2C38.975&lp=s", "spb")).toBe("/spb");
  });

  it("replaces the previous city instead of appending one", () => {
    expect(citySwitchHref("/search", "?city=kazan", "spb")).toBe("/search?city=spb");
  });
});
