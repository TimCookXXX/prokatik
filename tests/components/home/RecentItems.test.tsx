import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Занятость карточек — один запрос в базу; здесь он пустой.
vi.mock("@/server/catalog", () => ({
  getAvailabilityRows: vi.fn(async () => []),
  listingPhotos: () => [],
}));

import { RecentItems } from "@/components/home/RecentItems";
import { content } from "@theme/content";

const item = {
  listing: {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
    ownerUserId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    slug: "perforator-bosch",
    title: "Перфоратор Bosch GBH 2-26",
    quantity: 1,
    priceDay: 500,
    depositType: "none",
    depositAmount: null,
    location: "Центр",
    handoverPickup: true,
    handoverDelivery: false,
    photosJson: [],
  },
  ownerName: "Артём",
  ownerImage: null,
  ownerIsVerified: false,
  categorySlug: "elektroinstrumenty",
  citySlug: "kazan",
  cityName: "Казань",
  distance: null,
} as never;

describe("RecentItems", () => {
  // Ссылка в весь город — одна, у заголовка: кнопка под сеткой повторяла её.
  it("links the whole city once, next to the heading", async () => {
    render(await RecentItems({ items: [item], citySlug: "kazan" }));
    expect(screen.getByRole("heading", { name: content.home.recentHeading })).toBeInTheDocument();
    const all = screen.getAllByRole("link", { name: new RegExp(content.home.recentAll) });
    expect(all).toHaveLength(1);
    expect(all[0]).toHaveAttribute("href", "/kazan");
  });

  it("renders nothing without listings", async () => {
    expect(await RecentItems({ items: [], citySlug: "kazan" })).toBeNull();
  });
});
