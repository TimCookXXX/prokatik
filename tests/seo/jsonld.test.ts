import { describe, it, expect } from "vitest";
import {
  buildBreadcrumbJsonLd, buildOrganizationJsonLd, buildProductJsonLd, buildWebSiteJsonLd,
} from "@/lib/jsonld";

describe("buildProductJsonLd()", () => {
  const base = {
    title: "Перфоратор Bosch",
    description: "Мощный перфоратор.",
    priceDay: 500,
    photoUrls: ["https://img.example/1.webp"],
    url: "https://inrenta.example/kazan/elektroinstrument/perforator-01ARZ3NDEKTSV4RRFFQ69G5FAV",
    sellerName: "Артём",
    available: true,
  };

  it("собирает Product с Offer в рублях и LeaseOut", () => {
    const ld = buildProductJsonLd(base);
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe("Перфоратор Bosch");
    expect(ld.offers.price).toBe(500);
    expect(ld.offers.priceCurrency).toBe("RUB");
    expect(ld.offers.businessFunction).toContain("LeaseOut");
    expect(ld.offers.availability).toBe("https://schema.org/InStock");
    expect(ld.offers.seller.name).toBe("Артём");
  });

  // Голая price читается как цена покупки; за что она — говорит спецификация.
  it("цена — за сутки: UnitPriceSpecification с unitCode DAY", () => {
    const spec = buildProductJsonLd(base).offers.priceSpecification;
    expect(spec).toEqual({
      "@type": "UnitPriceSpecification",
      price: 500,
      priceCurrency: "RUB",
      unitCode: "DAY",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "DAY" },
    });
  });

  // Поля «новое / б/у» у объявления нет — состояние не выдумывается.
  it("itemCondition не ставится", () => {
    const ld = buildProductJsonLd(base);
    expect(ld.itemCondition).toBeUndefined();
    expect(ld.offers.itemCondition).toBeUndefined();
  });

  it("занятая позиция — OutOfStock", () => {
    const ld = buildProductJsonLd({ ...base, available: false });
    expect(ld.offers.availability).toBe("https://schema.org/OutOfStock");
  });

  it("без фото и описания — нет пустых полей", () => {
    const ld = buildProductJsonLd({ ...base, photoUrls: [], description: null });
    expect(ld.image).toBeUndefined();
    expect(ld.description).toBeUndefined();
  });
});

describe("buildBreadcrumbJsonLd()", () => {
  it("нумерует позиции и абсолютизирует url", () => {
    const ld = buildBreadcrumbJsonLd(
      [
        { name: "Главная", url: "/" },
        { name: "Казань", url: "/kazan" },
        { name: "Перфоратор" },
      ],
      "https://inrenta.example/",
    );
    expect(ld.itemListElement).toHaveLength(3);
    expect(ld.itemListElement[0].position).toBe(1);
    expect(ld.itemListElement[1].item).toBe("https://inrenta.example/kazan");
    expect(ld.itemListElement[2].item).toBeUndefined();
  });
});

describe("Organization и WebSite", () => {
  it("Organization: имя, адрес, логотип и почта абсолютные", () => {
    const ld = buildOrganizationJsonLd({ name: "inrenta", siteUrl: "https://inrenta.example/", email: "hi@inrenta.example" });
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "inrenta",
      url: "https://inrenta.example/",
      logo: "https://inrenta.example/icons/icon-512.png",
      email: "hi@inrenta.example",
    });
  });

  it("WebSite: имя и адрес, без SearchAction", () => {
    const ld = buildWebSiteJsonLd({ name: "inrenta", siteUrl: "https://inrenta.example" });
    expect(ld["@type"]).toBe("WebSite");
    expect(ld.url).toBe("https://inrenta.example/");
    expect(ld.name).toBe("inrenta");
    expect(ld.potentialAction).toBeUndefined();
  });
});
