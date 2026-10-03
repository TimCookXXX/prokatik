import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

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
  // а таб-бар из-за неё терял бы верхние скругления (globals.css).
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
