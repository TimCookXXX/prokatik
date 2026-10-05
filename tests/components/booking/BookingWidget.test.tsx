import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// Виджет тянет две ветки, которых в jsdom не бывает: окно входа уходит в
// next-auth, а форма заявки — в server action, и оба заканчиваются на
// next/server. К способу получения ни одна отношения не имеет.
// (OwnerCard этим не болен: он грузит окно входа через LoginTrigger, а виджет
// импортирует его напрямую.)
// Окно входа — заглушка, которая запоминает свой callbackUrl: куда человек
// вернётся после входа.
const login = vi.hoisted(() => ({ callbackUrl: "" }));
vi.mock("@/components/auth/LoginDialog", () => ({
  LoginDialog: (p: { callbackUrl: string }) => {
    login.callbackUrl = p.callbackUrl;
    return null;
  },
}));
vi.mock("@/server/actions/booking", () => ({
  createBookingRequest: async () => ({ ok: true, data: undefined }),
}));

const { BookingWidget } = await import("@/components/booking/BookingWidget");

// Способ получения показывается ровно в одном месте — в блоке брони. Тест на
// formatHandover проверяет сами подписи, а этот — что они туда доезжают:
// раньше строка жила на странице товара, и её перенос ничем не был закреплён.
const base = {
  listingId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  listingTitle: "Перфоратор Bosch",
  initialPhone: "",
  pathname: "/kazan/elektroinstrumenty/perforator-01ARZ3NDEKTSV4RRFFQ69G5FAW",
  initial: { from: "2026-09-04", to: "2026-09-04", qty: 1 },
  today: "2026-09-04",
  maxDate: "2027-03-03",
  availability: {},
  quantity: 1,
  priceDay: 500,
  depositType: "none" as const,
  depositAmount: null,
  sellerName: "Артём",
  sellerHref: "/u/01ARZ3NDEKTSV4RRFFQ69G5FAV",
  isAuthed: true,
  isOwn: false,
  authProps: { nextAuthProviders: ["yandex"], vkEnabled: false, canRegisterByEmail: true },
};

describe("BookingWidget — способ получения", () => {
  it("показывает оба способа под подписью «Получение»", () => {
    render(<BookingWidget {...base} handoverPickup handoverDelivery />);
    expect(screen.getByText("Получение")).toBeInTheDocument();
    expect(screen.getByText("Самовывоз или доставка")).toBeInTheDocument();
  });

  it("показывает единственный способ", () => {
    render(<BookingWidget {...base} handoverPickup={false} handoverDelivery />);
    expect(screen.getByText("Только доставка")).toBeInTheDocument();
  });
});

describe("BookingWidget — своё объявление", () => {
  // Кнопок брони две (в виджете и в липкой полосе на мобиле), и обе должны
  // исчезнуть разом: мутация владельцу всё равно ответит own_listing.
  it("владельцу не предлагает бронь", () => {
    render(<BookingWidget {...base} isOwn handoverPickup handoverDelivery />);
    expect(screen.queryByRole("button", { name: "Забронировать" })).not.toBeInTheDocument();
  });

  // На месте кнопки — подпись, а не другое действие.
  it("владельцу объясняет, почему кнопки нет", () => {
    render(<BookingWidget {...base} isOwn handoverPickup handoverDelivery />);
    expect(screen.getByText("Это ваше объявление")).toBeInTheDocument();
  });

  // Липкая полоса без кнопки носила бы владельцу его же цену через весь экран,
  // а таб-бар под её маркером прячется (globals.css) — владелец остался бы без
  // навигации.
  it("владельцу не показывает липкую полосу на мобиле", () => {
    const { container } = render(<BookingWidget {...base} isOwn handoverPickup handoverDelivery />);
    expect(container.querySelector("[data-booking-bar]")).toBeNull();
  });

  it("чужое объявление бронируется по-прежнему", () => {
    render(<BookingWidget {...base} handoverPickup handoverDelivery />);
    expect(screen.getAllByRole("button", { name: "Забронировать" })).toHaveLength(2);
  });
});

describe("BookingWidget — выбор дат", () => {
  const day = (d: string) => document.querySelector<HTMLButtonElement>(`[data-day="${d}"] button`)!;
  const query = () => new URLSearchParams(window.location.search);

  // Выбор — pickRange, как у поля «Когда»: первый клик расширяет стартовый
  // день в период, дальше два клика в любом порядке.
  it("собирает период двумя кликами в любом порядке", () => {
    window.history.replaceState(null, "", base.pathname);
    render(<BookingWidget {...base} handoverPickup handoverDelivery={false} />);

    fireEvent.click(day("2026-09-10"));
    expect(query().get("from")).toBe("2026-09-04");
    expect(query().get("to")).toBe("2026-09-10");

    fireEvent.click(day("2026-09-08"));
    fireEvent.click(day("2026-09-06"));
    expect(query().get("from")).toBe("2026-09-06");
    expect(query().get("to")).toBe("2026-09-08");
  });

  // Сегодня занято — виджет сам ставит первый свободный день. В адрес он его
  // не пишет: from/to адреса шапка показывает как даты поиска, а их никто не
  // выбирал. Выбор человека в адрес попадает как раньше.
  it("стартовый день по умолчанию не пишет в адрес", () => {
    window.history.replaceState(null, "", base.pathname);
    render(
      <BookingWidget
        {...base}
        initial={{ from: "2026-09-06", to: "2026-09-06", qty: 1 }}
        handoverPickup
        handoverDelivery={false}
      />,
    );
    expect(window.location.search).toBe("");

    fireEvent.click(day("2026-09-08"));
    expect(query().get("from")).toBe("2026-09-06");
    expect(query().get("to")).toBe("2026-09-08");
  });

  // Виджет переписывает адрес через replaceState. Собирай он query с нуля —
  // «Где» и прочие чужие параметры пропадали бы из адреса, из «поделиться» и
  // из возврата после входа.
  it("не стирает чужие параметры, и они доезжают до callbackUrl входа", () => {
    window.history.replaceState(null, "", `${base.pathname}?loc=p:45.035,38.975&utm_source=tg`);
    render(<BookingWidget {...base} isAuthed={false} handoverPickup handoverDelivery={false} />);

    fireEvent.click(day("2026-09-10"));
    expect(query().get("loc")).toBe("p:45.035,38.975");
    expect(query().get("utm_source")).toBe("tg");
    expect(query().get("to")).toBe("2026-09-10");

    fireEvent.click(screen.getAllByRole("button", { name: "Забронировать" })[0]!);
    const callback = new URL(login.callbackUrl, "http://x");
    expect(callback.pathname).toBe(base.pathname);
    expect(callback.searchParams.get("loc")).toBe("p:45.035,38.975");
    expect(callback.searchParams.get("utm_source")).toBe("tg");
    expect(callback.searchParams.get("from")).toBe("2026-09-04");
    expect(callback.searchParams.get("to")).toBe("2026-09-10");
  });

  // «Где» целиком — точка, подпись, источник и точность: по нему OwnerCard
  // показывает расстояние, и после выбора дат перезагрузка его не теряет.
  it("«Где» переживает выбор дат целиком", () => {
    const where = { loc: "p:44.988,38.948", la: "улица Базовская, Яблоновский", src: "geo", lp: "s" };
    window.history.replaceState(null, "", `${base.pathname}?${new URLSearchParams(where)}`);
    render(<BookingWidget {...base} handoverPickup handoverDelivery={false} />);

    fireEvent.click(day("2026-09-10"));
    expect(Object.fromEntries(query())).toEqual({ ...where, from: "2026-09-04", to: "2026-09-10" });
  });
});

describe("BookingWidget — кнопка нижней панели", () => {
  const bar = () => document.querySelector<HTMLElement>("[data-booking-bar]")!;
  const barButton = () => within(bar()).getByRole("button");
  const calendar = () => document.querySelector("[data-day]")!.closest(".surface")!;

  afterEach(() => vi.restoreAllMocks());

  // Серая неактивная «Выберите даты» внизу экрана не говорила, куда идти, а
  // календарь от неё далеко. Пока дат нет, кнопка ведёт к нему.
  it("без дат ведёт к календарю на странице", () => {
    window.history.replaceState(null, "", base.pathname);
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<BookingWidget {...base} handoverPickup handoverDelivery={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Очистить даты" }));
    expect(barButton()).toHaveTextContent("Выбрать даты");
    expect(barButton()).toBeEnabled();

    fireEvent.click(barButton());
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(calendar());
    // Форма заявки не открылась: к брони кнопка не вела.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Выбран только «Забрать» — бронировать ещё нечего, ровно как без дат.
  it("с одной выбранной датой тоже ведёт к календарю", () => {
    window.history.replaceState(null, "", base.pathname);
    render(<BookingWidget {...base} handoverPickup handoverDelivery={false} />);
    const day = (d: string) => document.querySelector<HTMLButtonElement>(`[data-day="${d}"] button`)!;
    fireEvent.click(screen.getByRole("button", { name: "Очистить даты" }));
    fireEvent.click(day("2026-09-10"));
    expect(barButton()).toHaveTextContent("Выбрать даты");
  });

  // Даты заняты — в виджете бронь недоступна, а полоса зовёт их поменять.
  it("при занятых датах зовёт их изменить", () => {
    window.history.replaceState(null, "", base.pathname);
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    render(
      <BookingWidget
        {...base}
        availability={{ "2026-09-04": { bookedQty: 1, blockedQty: 0 } }}
        handoverPickup
        handoverDelivery={false}
      />,
    );
    expect(barButton()).toHaveTextContent("Изменить даты");
    expect(barButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Забронировать" })).toBeDisabled();

    fireEvent.click(barButton());
    expect(scroll.mock.contexts[0]).toBe(calendar());
  });

  it("с выбранными свободными датами бронирует", () => {
    window.history.replaceState(null, "", base.pathname);
    render(<BookingWidget {...base} handoverPickup handoverDelivery={false} />);
    expect(barButton()).toHaveTextContent("Забронировать");
    expect(barButton()).toBeEnabled();
  });

  // Полоса — нижняя панель вместо таб-бара: во всю ширину, вплотную к низу,
  // непрозрачная и с отступом под полосу «домой».
  it("стоит вплотную к нижней кромке", () => {
    render(<BookingWidget {...base} handoverPickup handoverDelivery={false} />);
    expect(bar()).toHaveClass("fixed", "inset-x-0", "bottom-0", "bg-card", "border-t");
    expect(bar().className).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(bar().querySelector(".glass")).toBeNull();
  });
});
