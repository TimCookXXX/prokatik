import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ListingCard, cardEager, cardsShowCity } from "@/components/catalog/ListingCard";
import type { AvailabilityMap } from "@/lib/catalog/availability";
import { content } from "@theme/content";

// Сетка закреплена по разбору карточек выдачи (docs/decisions/0027):
// квадратное фото, на нём только «Занято»; под ним название, цена с короткой
// единицей, условия и строка «владелец · место» — без подвала. Список остался прежним: полная единица, строка получения, продавец
// на фото.
//
// NB: то, что вся карточка кликается, отсюда не проверить — растянутая ссылка
// работает через ::after, а jsdom раскладку не считает и псевдоэлементы не
// рендерит. Это проверка глазами.

const TODAY = "2026-09-04";
const availability: AvailabilityMap = new Map();

function card(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}, itemOver: Record<string, unknown> = {}) {
  const item = {
    listing: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      ownerUserId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      slug: "perforator-bosch",
      title: "Перфоратор Bosch GBH 2-26",
      quantity: 3,
      priceDay: 500,
      priceWeek: null,
      priceMonth: null,
      minDays: 1,
      depositType: "money",
      depositAmount: 3000,
      location: "Ново-Савиновский, Казань",
      geoPrecision: "place",
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
    ...itemOver,
  } as never;

  return <ListingCard item={item} citySlug="kazan" availabilityMap={availability}
    from={TODAY} {...props} />;
}

// Строка целиком, с пробелами как у нормализатора testing-library: суммы
// набраны неразрывными.
const text = (s: string) => screen.getByText((_, el) =>
  el?.tagName === "P" && el.textContent?.replace(/\s+/g, " ") === s);

describe("ListingCard — сетка", () => {
  // Короткое название держит место под вторую строку, длинное — до трёх. 15 px
  // и 500 — жирной на карточке остаётся одна цена.
  it("название — до трёх строк, место под две всегда, без полужирного", () => {
    render(card());
    const title = screen.getByRole("heading", { name: "Перфоратор Bosch GBH 2-26" });
    expect(title).toHaveClass("line-clamp-3", "min-h-[2.7em]", "leading-snug", "text-base", "font-medium");
    expect(title).not.toHaveClass("font-semibold");
  });

  // Трёхстрочное название не сдвигает цену соседа: колонка — flex-col, блок
  // цены прижат к низу. Раскладку jsdom не считает — проверяются классы.
  it("цена, условия и владелец прижаты к низу карточки", () => {
    render(card());
    const priceBlock = screen.getByText("500 ₽").closest("p")!.parentElement!;
    expect(priceBlock).toHaveClass("mt-auto");
    expect(priceBlock.parentElement).toHaveClass("flex", "flex-col", "flex-1");
    expect(priceBlock).toHaveTextContent("Артём");
  });

  it("цена — сумма и короткая единица", () => {
    render(card());
    expect(screen.getByText("500 ₽")).toHaveClass("text-xl", "font-bold");
    expect(screen.getByText("/сут.")).toHaveClass("text-xs", "text-muted-foreground");
    expect(screen.queryByText(/в сутки/)).toBeNull();
  });

  it("недельная и месячная цена — со своей короткой единицей", () => {
    const { unmount } = render(card({ priceDay: null, priceWeek: 2250, minDays: 7 }));
    expect(screen.getByText("2 250 ₽")).toBeInTheDocument();
    expect(screen.getByText("/нед.")).toBeInTheDocument();
    unmount();
    render(card({ priceDay: null, priceWeek: null, priceMonth: 9000, minDays: 30 }));
    expect(screen.getByText("/мес.")).toBeInTheDocument();
  });

  // Срок, который следует из единицы, — повтор: «/нед.» уже значит «от 7 дн.».
  describe("строка условий", () => {
    it("залог без срока, когда срок — сутки", () => {
      render(card());
      expect(text("залог 3 000 ₽")).toBeInTheDocument();
      expect(screen.queryByText(/от \d+ дн\./)).toBeNull();
    });

    it("суточная цена с минимумом 3 дня — «· от 3 дн.»", () => {
      render(card({ minDays: 3, depositType: "none", depositAmount: null }));
      expect(text("без залога· от 3 дн.")).toBeInTheDocument();
    });

    it("недельная цена с минимумом 7 дней срока не пишет", () => {
      render(card({ priceDay: null, priceWeek: 2250, minDays: 7 }));
      expect(text("залог 3 000 ₽")).toBeInTheDocument();
      expect(screen.queryByText(/от 7 дн\./)).toBeNull();
    });

    it("недельная цена с минимумом 14 дней — пишет срок", () => {
      render(card({ priceDay: null, priceWeek: 2250, minDays: 14 }));
      expect(screen.getByText("· от 14 дн.")).toHaveClass("shrink-0");
    });

    it("месячная цена с минимумом 30 дней срока не пишет", () => {
      render(card({ priceDay: null, priceWeek: null, priceMonth: 9000, minDays: 30 }));
      expect(screen.queryByText(/от 30 дн\./)).toBeNull();
    });
  });

  // Место проверяется без владельца: строка тогда — одно место.
  describe("строка места", () => {
    const noOwner = { ownerName: null };

    // Город один на выдачу и стоит в заголовке — на карточке только район.
    it("один город — подпись без хвоста с городом", () => {
      render(card({}, {}, noOwner));
      expect(screen.getByText("Ново-Савиновский")).toBeInTheDocument();
      expect(screen.queryByText(/Казань/)).toBeNull();
    });

    it("несколько городов — подпись целиком", () => {
      render(card({}, { showCity: true }, noOwner));
      expect(screen.getByText("Ново-Савиновский, Казань")).toBeInTheDocument();
    });

    it("подпись другого пункта не режется", () => {
      render(card({ location: "улица Гагарина, Яблоновский", geoPrecision: "street" }, {}, noOwner));
      expect(screen.getByText("улица Гагарина, Яблоновский")).toBeInTheDocument();
    });

    // Текст без точки (город без геоданных) своего пункта не называет.
    it("текст без точки при нескольких городах получает город", () => {
      render(card({ location: "у метро", geoPrecision: "city" }, { showCity: true }, noOwner));
      expect(screen.getByText("у метро, Казань")).toBeInTheDocument();
    });

    it("без подписи — город", () => {
      render(card({ location: null }, {}, noOwner));
      expect(screen.getByText("Казань")).toBeInTheDocument();
    });

    it("при точке «Где» — расстояние, за ним место", () => {
      render(card({}, {}, { ...noOwner, distance: { km: 1.23, approx: false } }));
      expect(screen.getByText("1,2 км")).toHaveAttribute("title", "по прямой");
      expect(screen.getByText("· Ново-Савиновский")).toHaveClass("truncate", "min-w-0");
    });

    it("приблизительное расстояние — с «≈» и целыми км", () => {
      render(card({}, {}, { distance: { km: 2.6, approx: true } }));
      expect(screen.getByText("≈ 3 км")).toHaveAttribute("title", "по прямой");
    });

    it("без точки расстояния нет", () => {
      render(card());
      expect(screen.queryByTitle(content.search.distanceTitle)).toBeNull();
    });

    // Самовывоз у почти всех — значок там ничего не различает.
    it("получение — значком только при доставке, подпись для скринридера", () => {
      const { unmount } = render(card());
      expect(screen.queryByText("Самовывоз")).toBeNull();
      unmount();
      render(card({ handoverDelivery: true }));
      const label = screen.getByText("Самовывоз / доставка");
      expect(label).toHaveClass("sr-only");
      expect(label.parentElement).toHaveAttribute("title", "Самовывоз / доставка");
    });
  });

  // Владелец — строкой текста под условиями, не плашкой на фото.
  describe("строка владельца", () => {
    it("владелец, за ним место; место режется первым", () => {
      render(card());
      expect(text("Артём· Ново-Савиновский")).toBeInTheDocument();
      expect(screen.getByText("Артём")).toHaveClass("shrink-0", "max-w-[60%]", "truncate");
      expect(screen.getByText("· Ново-Савиновский")).toHaveClass("min-w-0", "truncate");
    });

    it("при точке «Где» — расстояние, за ним владелец", () => {
      render(card({}, {}, { distance: { km: 1.23, approx: false } }));
      expect(text("1,2 км· Артём")).toBeInTheDocument();
      expect(screen.queryByText(/Ново-Савиновский/)).toBeNull();
    });

    it("без имени владельца нет, «Без имени» не пишется", () => {
      render(card({}, {}, { ownerName: null }));
      expect(screen.queryByText(content.listingCard.noName)).toBeNull();
      expect(text("Ново-Савиновский")).toBeInTheDocument();
    });

    it("showOwner={false} — владельца нет", () => {
      render(card({}, { showOwner: false }));
      expect(screen.queryByText(/Артём/)).toBeNull();
      expect(text("Ново-Савиновский")).toBeInTheDocument();
    });
  });

  // Продавец и минимальный срок на фото больше не показываются, «Свободно» —
  // тоже: признак, одинаковый у всех, ничего не различает.
  it("на фото нет продавца, срока и «Свободно»", () => {
    render(card({ priceDay: null, priceWeek: 2250, minDays: 7 }));
    expect(screen.queryByRole("link", { name: /Артём/ })).toBeNull();
    expect(screen.queryByText("Свободно")).toBeNull();
    expect(document.querySelector(".glass-photo")).toBeNull();
  });

  it("подвала с линией нет", () => {
    render(card());
    expect(document.querySelector(".border-t")).toBeNull();
  });

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
});

describe("ListingCard — список", () => {
  it("название без резерва второй строки", () => {
    render(card({}, { view: "list" }));
    const title = screen.getByRole("heading", { name: "Перфоратор Bosch GBH 2-26" });
    expect(title).toHaveClass("line-clamp-2");
    expect(title).not.toHaveClass("min-h-[2.7em]");
  });

  it("полная единица со сроком, залог строкой ниже", () => {
    render(card({ priceDay: null, priceWeek: 2250, minDays: 7 }, { view: "list" }));
    expect(screen.getByText((_, el) => el?.textContent === "в неделю · от 7 дн." && el.tagName === "SPAN"))
      .toBeInTheDocument();
    expect(screen.getByText("залог 3 000 ₽")).toBeInTheDocument();
  });

  it("строка получения: подпись способа и город", () => {
    render(card({}, { view: "list" }));
    expect(screen.getByText("Самовывоз")).not.toHaveClass("sr-only");
    expect(screen.getByText("· Казань")).toBeInTheDocument();
  });

  // Город больше не приглушается второй ступенью: muted-fg/70 в тёмной теме
  // стоял на самой границе 4.5:1.
  it("город — обычным приглушённым, без второй ступени", () => {
    render(card({}, { view: "list" }));
    expect(screen.getByText("· Казань").className).not.toMatch(/\/70/);
  });

  it("с точкой «Где» — расстояние рядом с городом", () => {
    render(card({}, { view: "list" }, { distance: { km: 1.23, approx: false } }));
    expect(screen.getByText("1,2 км")).toHaveClass("shrink-0");
    const city = screen.getByText(/Казань/);
    expect(city).toHaveClass("hidden", "sm:inline");
    expect(city.parentElement).toHaveClass("flex-wrap", "h-[1lh]", "overflow-clip");
  });

  it("плашка продавца ведёт в его профиль", () => {
    render(card({}, { view: "list" }));
    expect(screen.getByRole("link", { name: /Артём/ }))
      .toHaveAttribute("href", "/u/01ARZ3NDEKTSV4RRFFQ69G5FAV");
  });
});

// Свобода считается на весь выбранный период — минимум по дням: аренде нужна
// одна и та же вещь с первого дня по последний. Показывается только «Занято».
describe("ListingCard — занятость на выбранные даты", () => {
  const range = { from: "2026-09-10", to: "2026-09-12" };
  const busyOn = (date: string, bookedQty: number): AvailabilityMap =>
    new Map([[date, { bookedQty, blockedQty: 0 }]]);

  it("свободно — плашки нет", () => {
    render(card({}, { ...range, availabilityMap: busyOn("2026-09-20", 3) }));
    expect(screen.queryByText(content.listingCard.busy)).toBeNull();
  });

  it("занята часть — плашки нет", () => {
    render(card({}, { ...range, availabilityMap: busyOn("2026-09-12", 1) }));
    expect(screen.queryByText(content.listingCard.busy)).toBeNull();
  });

  it("в какой-то из дней не осталось ни одной — «Занято»", () => {
    render(card({}, { ...range, availabilityMap: busyOn("2026-09-11", 3) }));
    expect(screen.getByText(content.listingCard.busy)).toHaveClass("glass-photo", "text-2xs");
  });

  it("без периода смотрит только на день from", () => {
    render(card({}, { from: "2026-09-10", availabilityMap: busyOn("2026-09-11", 3) }));
    expect(screen.queryByText(content.listingCard.busy)).toBeNull();
  });
});

describe("cardsShowCity", () => {
  it("один город, совпавший со страницей, — нет", () => {
    expect(cardsShowCity([{ citySlug: "krasnodar" }, { citySlug: "krasnodar" }], "krasnodar")).toBe(false);
  });

  it("несколько городов в выдаче — да", () => {
    expect(cardsShowCity([{ citySlug: "krasnodar" }, { citySlug: "yablonovskiy" }], "krasnodar")).toBe(true);
  });

  it("единственный город не тот, что у страницы, — да", () => {
    expect(cardsShowCity([{ citySlug: "yablonovskiy" }], "krasnodar")).toBe(true);
  });

  it("без города страницы — по самой выдаче", () => {
    expect(cardsShowCity([{ citySlug: "kazan" }])).toBe(false);
    expect(cardsShowCity([{ citySlug: "kazan" }, { citySlug: "krasnodar" }])).toBe(true);
  });
});

// Приоритет первого фото по месту в выдаче: две первые — high, остаток первого
// ряда — eager, дальше — ленивая загрузка.
describe("cardEager", () => {
  it("сетка при боковой панели (до трёх в ряду)", () => {
    expect([0, 1, 2, 3, 10].map((i) => cardEager(i, 3))).toEqual(["high", "high", "eager", undefined, undefined]);
  });

  it("список (две строки над сгибом) — eager никому", () => {
    expect([0, 1, 2].map((i) => cardEager(i, 2))).toEqual(["high", "high", undefined]);
  });
});
