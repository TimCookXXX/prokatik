import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { AvailabilityMap } from "@/lib/catalog/availability";

// Виджет брони тянет окно входа и server action — обе ветки кончаются на
// next/server, которого в jsdom нет. К значку они отношения не имеют.
vi.mock("@/components/auth/LoginDialog", () => ({ LoginDialog: () => null }));
vi.mock("@/server/actions/booking", () => ({
  createBookingRequest: async () => ({ ok: true, data: undefined }),
}));

const { ListingCard } = await import("@/components/catalog/ListingCard");
const { BookingWidget } = await import("@/components/booking/BookingWidget");

// Способ получения человек видит дважды подряд: в карточке выдачи и в блоке
// брони, куда из неё переходит. Значок обязан быть один и тот же — иначе
// свойство приходится опознавать заново. Раньше наборы разъезжались, и тест
// сторожит именно стык, а не каждую сторону по отдельности.
const GLYPHS = ["lucide-arrow-left-right", "lucide-map-pin", "lucide-truck"];

function glyphOf(container: HTMLElement): string {
  const svg = Array.from(container.querySelectorAll("svg"))
    .find((el) => GLYPHS.some((g) => el.classList.contains(g)));
  return GLYPHS.find((g) => svg?.classList.contains(g)) ?? "значка нет";
}

function cardWith(pickup: boolean, delivery: boolean) {
  const item = {
    listing: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      ownerUserId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      slug: "perforator-bosch",
      title: "Перфоратор Bosch",
      quantity: 1,
      priceDay: 500,
      depositType: "none",
      depositAmount: null,
      location: null,
      handoverPickup: pickup,
      handoverDelivery: delivery,
      photosJson: [],
    },
    ownerName: "Артём",
    ownerImage: null,
    ownerIsVerified: false,
    categorySlug: "elektroinstrumenty",
    cityName: "Казань",
  } as never;

  return <ListingCard item={item} citySlug="kazan" from="2026-09-04"
    availabilityMap={new Map() as AvailabilityMap} />;
}

function widgetWith(pickup: boolean, delivery: boolean) {
  return <BookingWidget
    listingId="01ARZ3NDEKTSV4RRFFQ69G5FAW"
    listingTitle="Перфоратор Bosch"
    initialPhone=""
    pathname="/kazan/elektroinstrumenty/perforator-01ARZ3NDEKTSV4RRFFQ69G5FAW"
    initial={{ from: "2026-09-04", to: "2026-09-04", qty: 1 }}
    today="2026-09-04"
    maxDate="2027-03-03"
    availability={{}}
    quantity={1}
    priceDay={500}
    depositType="none"
    depositAmount={null}
    handoverPickup={pickup}
    handoverDelivery={delivery}
    sellerName="Артём"
    sellerHref="/u/01ARZ3NDEKTSV4RRFFQ69G5FAV"
    isAuthed
    isOwn={false}
    authProps={{ nextAuthProviders: ["yandex"], vkEnabled: false, canRegisterByEmail: true }}
  />;
}

describe("значок способа получения", () => {
  it.each([
    ["оба способа", true, true, "lucide-arrow-left-right"],
    ["только самовывоз", true, false, "lucide-map-pin"],
    ["только доставка", false, true, "lucide-truck"],
    ["ни одного способа", false, false, "lucide-map-pin"],
  ])("%s — одинаков в карточке и в блоке брони", (_name, pickup, delivery, expected) => {
    const card = render(cardWith(pickup as boolean, delivery as boolean));
    const inCard = glyphOf(card.container);
    card.unmount();

    const widget = render(widgetWith(pickup as boolean, delivery as boolean));
    const inWidget = glyphOf(widget.container);
    widget.unmount();

    expect(inCard).toBe(expected);
    expect(inWidget).toBe(inCard);
  });
});
