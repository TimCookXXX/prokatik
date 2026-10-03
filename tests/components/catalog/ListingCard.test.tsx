import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ListingCard } from "@/components/catalog/ListingCard";
import type { AvailabilityMap } from "@/lib/catalog/availability";

// Карточка до переделки тестами не покрывалась вовсе. Здесь закреплено то, что
// решили в дизайн-пакете: три служебные строки и кнопка ушли, вместо них цена
// с залогом и подвал про способ получения.
//
// NB: то, что вся карточка кликается, отсюда не проверить — растянутая ссылка
// работает через ::after, а jsdom раскладку не считает и псевдоэлементы не
// рендерит. Это проверка глазами.

const TODAY = "2026-09-04";
const availability: AvailabilityMap = new Map();

function card(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const item = {
    listing: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      ownerUserId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      slug: "perforator-bosch",
      title: "Перфоратор Bosch GBH 2-26",
      quantity: 3,
      priceDay: 500,
      depositType: "money",
      depositAmount: 3000,
      location: "Ново-Савиновский",
      handoverPickup: true,
      handoverDelivery: false,
      photosJson: [],
      ...over,
    },
    ownerName: "Артём",
    ownerImage: null,
    ownerIsVerified: true,
    categorySlug: "elektroinstrumenty",
    cityName: "Казань",
  } as never;

  return <ListingCard item={item} citySlug="kazan" availabilityMap={availability}
    from={TODAY} {...props} />;
}

describe("ListingCard", () => {
  // Сумма с единицей — первой строкой, залог — второй. Разведены намеренно: в
  // одну строку они не влезают на реальных числах, а перенос делал карточки в
  // ряду разной высоты.
  it("показывает сумму с единицей, а залог — строкой ниже", () => {
    render(card());
    expect(screen.getByText("500 ₽")).toBeInTheDocument();
    expect(screen.getByText("в сутки")).toBeInTheDocument();
    expect(screen.getByText("залог 3 000 ₽")).toBeInTheDocument();
  });

  // Три служебные строки и кнопка съедали высоту, ничего не решая: остаток
  // виден по плашке занятости, город в каталоге у всех один, а клик по кнопке
  // дублировал клик по фото и названию.
  it("больше не показывает количество отдельной строкой и кнопку", () => {
    render(card());
    expect(screen.queryByText("Количество")).toBeNull();
    expect(screen.queryByText("Город")).toBeNull();
    expect(screen.queryByRole("link", { name: "Подробнее" })).toBeNull();
  });

  it("показывает способ получения и город", () => {
    render(card());
    expect(screen.getByText("Самовывоз")).toBeInTheDocument();
    expect(screen.getByText("Казань")).toBeInTheDocument();
  });

  // Район выдачи в карточке не показывается: в подвале его место занял город.
  // Сам location никуда не делся — он виден на странице позиции.
  it("не показывает район выдачи", () => {
    render(card());
    expect(screen.queryByText(/Ново-Савиновский/)).toBeNull();
  });

  it("оба способа и только доставка называются по-разному", () => {
    const { unmount } = render(card({ handoverDelivery: true }));
    expect(screen.getByText("Самовывоз / доставка")).toBeInTheDocument();
    unmount();

    render(card({ handoverPickup: false, handoverDelivery: true }));
    expect(screen.getByText("Доставка")).toBeInTheDocument();
  });

  // Город есть у любого объявления, поэтому правый край подвала не пустеет —
  // в отличие от необязательного location, который тут стоял раньше.
  it("показывает город и без заполненного района", () => {
    render(card({ location: null }));
    expect(screen.getByText("Казань")).toBeInTheDocument();
    expect(screen.getByText("Самовывоз")).toBeInTheDocument();
  });

  it("плашка продавца ведёт в его профиль", () => {
    render(card());
    expect(screen.getByRole("link", { name: /Артём/ }))
      .toHaveAttribute("href", "/u/01ARZ3NDEKTSV4RRFFQ69G5FAV");
  });

  // Даты выдачи едут в карточку: виджет брони откроется на них.
  it("ведёт на позицию с переносимыми параметрами выдачи", () => {
    render(card({}, { hrefQuery: "from=2026-09-10&to=2026-09-12" }));
    expect(screen.getByRole("link", { name: "Перфоратор Bosch GBH 2-26" })).toHaveAttribute(
      "href",
      "/kazan/elektroinstrumenty/perforator-bosch-01ARZ3NDEKTSV4RRFFQ69G5FAW?from=2026-09-10&to=2026-09-12",
    );
  });

  it("без параметров ведёт на канонический адрес", () => {
    render(card());
    expect(screen.getByRole("link", { name: "Перфоратор Bosch GBH 2-26" })).toHaveAttribute(
      "href",
      "/kazan/elektroinstrumenty/perforator-bosch-01ARZ3NDEKTSV4RRFFQ69G5FAW",
    );
  });

  // Свобода считается на весь выбранный период — минимум по дням: аренде
  // нужна одна и та же вещь с первого дня по последний.
  describe("свобода на выбранные даты", () => {
    const range = { from: "2026-09-10", to: "2026-09-12" };
    const badge = () => screen.getByText(/^(Свободно|Занято)$/);
    const busyOn = (date: string, bookedQty: number): AvailabilityMap =>
      new Map([[date, { bookedQty, blockedQty: 0 }]]);

    it("зелёная, когда свободно всё во все дни", () => {
      render(card({}, { ...range, availabilityMap: busyOn("2026-09-20", 3) }));
      expect(badge()).toHaveTextContent("Свободно");
      expect(badge()).toHaveClass("text-primary");
    });

    it("охряная, когда в какой-то из дней занята часть", () => {
      render(card({}, { ...range, availabilityMap: busyOn("2026-09-12", 1) }));
      expect(badge()).toHaveTextContent("Свободно");
      expect(badge()).toHaveClass("text-accent");
    });

    // Свободно в первый день — ещё не свободно на период.
    it("«Занято», когда в какой-то из дней не осталось ни одной", () => {
      render(card({}, { ...range, availabilityMap: busyOn("2026-09-11", 3) }));
      expect(badge()).toHaveTextContent("Занято");
    });

    it("без периода смотрит только на день from", () => {
      render(card({}, { from: "2026-09-10", availabilityMap: busyOn("2026-09-11", 3) }));
      expect(badge()).toHaveTextContent("Свободно");
    });
  });
});
