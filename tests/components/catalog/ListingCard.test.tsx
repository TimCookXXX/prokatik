import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ListingCard } from "@/components/catalog/ListingCard";
import type { AvailabilityMap } from "@/lib/catalog/availability";
import { content } from "@theme/content";

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
    citySlug: "kazan",
    cityName: "Казань",
    distance: null,
  } as never;

  return <ListingCard item={item} citySlug="kazan" availabilityMap={availability}
    from={TODAY} {...props} />;
}

describe("ListingCard", () => {
  // В узкой колонке телефона одна строка оставляла от названия «Перфоратор
  // Ма…». Две строки — и место под две всегда, чтобы цены в ряду стояли
  // на одной высоте при названиях разной длины.
  // В две колонки на 360 от «Самовывоз» оставалось «С…»: ниже sm видно
  // только значок, подпись остаётся скринридеру, подсказка — в title.
  it("в узкой сетке способ получения — значком, подпись для скринридера", () => {
    render(card({ handoverPickup: true, handoverDelivery: true }));
    const label = screen.getByText("Самовывоз / доставка");
    expect(label).toHaveClass("max-sm:sr-only");
    expect(label.previousElementSibling).toHaveAttribute("title", "Самовывоз / доставка");
    expect(label.previousElementSibling!.querySelector("svg")).toBeInTheDocument();
  });

  it("в строке списка подпись способа видна всегда", () => {
    render(card({}, { view: "list" }));
    expect(screen.getByText("Самовывоз")).not.toHaveClass("max-sm:sr-only");
  });

  it("название — до двух строк, место под две строки всегда", () => {
    render(card());
    const title = screen.getByRole("heading", { name: "Перфоратор Bosch GBH 2-26" });
    expect(title).toHaveClass("line-clamp-2", "min-h-[2.75em]", "leading-snug");
    expect(title).not.toHaveClass("truncate");
  });

  // Резерв под вторую строку ровняет цены соседних карточек сетки. В списке
  // строка одна в ряду, и резерв был бы пустой дырой под коротким названием.
  it("в списке место под вторую строку не резервируется", () => {
    render(card({}, { view: "list" }));
    const title = screen.getByRole("heading", { name: "Перфоратор Bosch GBH 2-26" });
    expect(title).toHaveClass("line-clamp-2");
    expect(title).not.toHaveClass("min-h-[2.75em]");
  });

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

  // Расстояние до точки «Где» — по прямой, адреса на карточке нет.
  describe("расстояние", () => {
    const withDistance = (km: number, approx: boolean, props: Record<string, unknown> = {}) => {
      const el = card({}, props);
      return { ...el, props: { ...el.props, item: { ...el.props.item, distance: { km, approx } } } };
    };
    const tag = (text: string) => screen.getByText(text);

    it("точное — метрами и км с запятой, с подписью «по прямой»", () => {
      const { unmount } = render(withDistance(0.34, false));
      expect(tag("300 м")).toHaveAttribute("title", "по прямой");
      unmount();
      render(withDistance(1.23, false));
      expect(tag("1,2 км")).toHaveAttribute("title", "по прямой");
    });

    it("приблизительное — с «≈» и целыми км", () => {
      render(withDistance(2.6, true));
      expect(tag("≈ 3 км")).toHaveAttribute("title", "по прямой");
    });

    // На 360 в две колонки контента ≈ 135 px: расстояние заменяет город, а
    // режется способ получения. С sm — «1,2 км · Город», но город только
    // целиком: не влез — уходит второй строкой под срез ряда в одну строку.
    it("ниже sm заменяет город в подвале, с sm стоит рядом с ним", () => {
      render(withDistance(1.23, false));
      const distance = screen.getByText("1,2 км");
      expect(distance).toHaveClass("shrink-0");
      const city = screen.getByText(/Казань/);
      expect(city).toHaveClass("hidden", "sm:inline", "whitespace-nowrap");
      expect(city.parentElement).toBe(distance.parentElement);
      expect(city.parentElement).toHaveClass("flex-wrap", "h-[1lh]", "overflow-clip", "flex-1");
      expect(screen.getByText("Самовывоз")).toHaveClass("min-w-0", "truncate");
    });

    it("в строке списка — так же", () => {
      render(withDistance(1.23, false, { view: "list" }));
      expect(screen.getByText("1,2 км")).toHaveClass("shrink-0");
      const city = screen.getByText(/Казань/);
      expect(city).toHaveClass("hidden", "sm:inline");
      expect(city.parentElement).toHaveClass("flex-wrap", "h-[1lh]", "overflow-clip");
    });

    it("без точки — город на месте, расстояния нет", () => {
      render(card());
      expect(screen.getByText("Казань")).not.toHaveClass("hidden");
      expect(screen.queryByTitle(content.search.distanceTitle)).toBeNull();
    });
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
