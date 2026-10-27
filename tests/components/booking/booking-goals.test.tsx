import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Цели брони: «Забронировать» с признаком входа и отправленная заявка — один
// раз на успех, без телефона и комментария в параметрах.
vi.mock("@/components/auth/LoginDialog", () => ({ LoginDialog: () => null }));
const createBookingRequest = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/booking", () => ({ createBookingRequest }));
const submitLeadForm = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/lead", () => ({ submitLeadForm }));
const reachGoal = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/goals", () => ({ reachGoal }));
// Настоящий track (он и шлёт цель), но с записью вызовов.
vi.mock("@/components/analytics/track", async (orig) => {
  const real = await orig<typeof import("@/components/analytics/track")>();
  return { ...real, track: vi.fn(real.track) };
});
const { track } = await import("@/components/analytics/track");

const { BookingWidget } = await import("@/components/booking/BookingWidget");
const { BookingFormDialog } = await import("@/components/booking/BookingFormDialog");
const { LeadFormDialog } = await import("@/components/booking/LeadFormDialog");
const { requestYmClientId, _resetYmClientForTests } = await import("@/components/analytics/ym-client");

const base = {
  listingId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  listingTitle: "Перфоратор Bosch",
  initialPhone: "+79001234567",
  pathname: "/kazan/elektroinstrumenty/perforator-01ARZ3NDEKTSV4RRFFQ69G5FAW",
  initial: { from: "2026-09-04", to: "2026-09-04", qty: 1 },
  today: "2026-09-04",
  maxDate: "2027-03-03",
  availability: {},
  quantity: 1,
  tariff: { priceDay: 500, priceWeek: null, priceMonth: null },
  minDays: 1,
  depositType: "none" as const,
  depositAmount: null,
  sellerName: "Артём",
  sellerHref: "/u/01ARZ3NDEKTSV4RRFFQ69G5FAV",
  isAuthed: true,
  isOwn: false,
  handoverPickup: true,
  handoverDelivery: false,
  authProps: { nextAuthProviders: ["yandex"], vkEnabled: false, canRegisterByEmail: true },
};

beforeEach(() => {
  reachGoal.mockClear();
  vi.mocked(track).mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  createBookingRequest.mockReset();
  createBookingRequest.mockResolvedValue({ ok: true, data: undefined });
  submitLeadForm.mockReset();
  submitLeadForm.mockResolvedValue({ ok: true, data: { code: "INR-4821" } });
  _resetYmClientForTests();
  window.history.replaceState(null, "", base.pathname);
});

const goals = (name: string) => reachGoal.mock.calls.filter(([n]) => n === name);

describe("цель booking_click", () => {
  it("в аккаунте — authed: true", () => {
    render(<BookingWidget {...base} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Забронировать" })[0]);
    expect(goals("booking_click")).toEqual([["booking_click", { authed: true }]]);
  });

  it("гостю — authed: false, хотя дальше окно входа", () => {
    render(<BookingWidget {...base} isAuthed={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Забронировать" })[1]);
    expect(goals("booking_click")).toEqual([["booking_click", { authed: false }]]);
  });

  it("на занятых датах кнопка ведёт к календарю — цели нет", () => {
    render(<BookingWidget {...base} availability={{ "2026-09-04": { bookedQty: 1, blockedQty: 0 } }} />);
    for (const b of screen.getAllByRole("button", { name: /Изменить даты|Выберите даты|Забронировать/ })) fireEvent.click(b);
    expect(goals("booking_click")).toEqual([]);
  });
});

describe("цель booking_sent", () => {
  const dialog = () => render(
    <BookingFormDialog
      open onOpenChange={() => {}}
      listingId={base.listingId} listingTitle={base.listingTitle}
      sel={base.initial} tariff={base.tariff} initialPhone={base.initialPhone}
    />,
  );
  const form = () => document.querySelector<HTMLFormElement>('form[name="booking"]')!;

  it("форма названа booking; успех — одна цель без параметров", async () => {
    dialog();
    expect(form()).not.toBeNull();
    fireEvent.submit(form());
    await screen.findByText("Заявка отправлена");
    expect(goals("booking_sent")).toEqual([["booking_sent"]]);
  });

  // Отказ по минимальному сроку называет минимум словами, а не кодом.
  it("min_days — понятный текст с числом", async () => {
    createBookingRequest.mockResolvedValue({ ok: false, error: "min_days:7" });
    dialog();
    fireEvent.submit(form());
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Минимальный срок аренды — 7 дней. Выберите даты длиннее.");
  });

  it("отказ сервера — цели нет", async () => {
    createBookingRequest.mockResolvedValue({ ok: false, error: "dates_unavailable" });
    dialog();
    fireEvent.submit(form());
    await waitFor(() => expect(createBookingRequest).toHaveBeenCalled());
    await screen.findByRole("alert");
    expect(goals("booking_sent")).toEqual([]);
  });
});

// «Забронировать» — и событие своей статистики: объявление в подписанном
// токене страницы, «в аккаунте ли» сервер знает сам.
describe("событие booking_click", () => {
  it("с токеном страницы — событие с ним", () => {
    render(<BookingWidget {...base} trackToken="TOKEN" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Забронировать" })[0]);
    expect(track).toHaveBeenCalledWith("booking_click", { token: "TOKEN", authed: true });
  });

  it("без токена — только цель", () => {
    render(<BookingWidget {...base} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Забронировать" })[0]);
    expect(track).toHaveBeenCalledWith("booking_click", { token: undefined, authed: true });
    expect(goals("booking_click")).toHaveLength(1);
  });
});

// BOOKING_FLOW=telegram (ADR 0028): клик по ссылке на бота — те же
// booking_click и событие, плюс tg_booking_click и маяк черновика с тем же
// токеном, что в ссылке. Всё синхронно, в обработчике клика: переход не ждёт.
describe("бронь через Telegram", () => {
  const tg = { ...base, bookingFlow: "telegram" as const, botUsername: "inrenta_bot" };
  const beacon = vi.fn((_url: string, _body?: BodyInit | null) => true);
  // jsdom не умеет переходить по ссылке — переход отменяется после обработчиков.
  const stopNav = (e: Event) => e.preventDefault();

  beforeEach(() => {
    beacon.mockClear();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    document.addEventListener("click", stopNav);
    return () => document.removeEventListener("click", stopNav);
  });

  const clickBot = () => {
    const link = screen.getByRole("link", { name: "Забронировать в Telegram" }) as HTMLAnchorElement;
    fireEvent.click(link);
    return link;
  };
  const sentDraft = () => {
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0];
    expect(url).toBe("/api/leads/draft");
    return JSON.parse(String(body)) as Record<string, unknown>;
  };

  it("booking_click с признаком входа, tg_booking_click и событие своей статистики", () => {
    render(<BookingWidget {...tg} isAuthed={false} trackToken="TOKEN" />);
    clickBot();
    expect(goals("booking_click")).toEqual([["booking_click", { authed: false }]]);
    expect(goals("tg_booking_click")).toEqual([["tg_booking_click"]]);
    expect(track).toHaveBeenCalledWith("booking_click", { token: "TOKEN", authed: false });
  });

  it("маяк черновика: токен из ссылки, выбор и увиденные цены", () => {
    render(<BookingWidget {...tg} />);
    const link = clickBot();
    const draft = sentDraft();
    expect(draft).toEqual({
      token: new URL(link.href).searchParams.get("start"),
      listingId: base.listingId,
      from: "2026-09-04",
      to: "2026-09-04",
      qty: "1",
      priceDay: "500",
      priceWeek: "",
      priceMonth: "",
    });
  });

  it("метки кампании из адреса и ClientID, если счётчик его уже отдал", () => {
    window.history.replaceState(null, "", `${base.pathname}?utm_source=yandex&utm_term=${encodeURIComponent("прокат велосипеда")}&loc=x`);
    window.ym = (_id: unknown, method: unknown, cb?: unknown) => {
      if (method === "getClientID") (cb as (v: string) => void)("1697712345123456789");
    };
    requestYmClientId(42);
    delete window.ym;
    render(<BookingWidget {...tg} />);
    clickBot();
    const draft = sentDraft();
    expect(draft.utm).toEqual({ utm_source: "yandex", utm_term: "прокат велосипеда" });
    expect(draft.ymClientId).toBe("1697712345123456789");
  });

  it("без sendBeacon — fetch с keepalive", () => {
    Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
    render(<BookingWidget {...tg} />);
    clickBot();
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/leads/draft");
    expect(call?.[1]).toMatchObject({ method: "POST", keepalive: true });
  });

  it("ветка входа не меняется: кнопка, а не ссылка, и маяка нет", () => {
    render(<BookingWidget {...base} />);
    expect(screen.queryByRole("link", { name: /Telegram/ })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Забронировать" })[0]);
    expect(goals("tg_booking_click")).toEqual([]);
    expect(beacon).not.toHaveBeenCalled();
  });
});

// Запасная форма «Имя + телефон»: при telegram booking_sent значит её успех.
describe("запасная форма", () => {
  const dialog = () => render(
    <LeadFormDialog
      open onOpenChange={() => {}}
      listingId={base.listingId} listingTitle={base.listingTitle}
      sel={base.initial} tariff={base.tariff} minDays={1}
    />,
  );
  const form = () => document.querySelector<HTMLFormElement>('form[name="booking_lead"]')!;
  const fill = () => {
    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Тимур" } });
    fireEvent.change(screen.getByLabelText("Телефон"), { target: { value: "+7 900 123-45-67" } });
  };

  it("успех — обещание связаться без кода и одна цель booking_sent без параметров", async () => {
    dialog();
    fill();
    fireEvent.submit(form());
    await screen.findByText("Заявка принята");
    expect(screen.queryByText(/INR-4821/)).toBeNull();
    expect(screen.getByText(/свяжемся с вами/)).toBeTruthy();
    expect(goals("booking_sent")).toEqual([["booking_sent"]]);
    expect(submitLeadForm).toHaveBeenCalledWith(expect.objectContaining({
      listingId: base.listingId, from: "2026-09-04", to: "2026-09-04", qty: "1",
      priceDay: "500", priceWeek: "", priceMonth: "",
      name: "Тимур", phone: "+7 (900) 123-45-67", website: "",
    }));
  });

  it("телефон форматируется маской по мере ввода", () => {
    dialog();
    const phone = screen.getByLabelText("Телефон") as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "8" } });
    expect(phone.value).toBe("+7");
    fireEvent.change(phone, { target: { value: "+79001" } });
    expect(phone.value).toBe("+7 (900) 1");
    fireEvent.change(phone, { target: { value: "8 900 123 45 67" } });
    expect(phone.value).toBe("+7 (900) 123-45-67");
  });

  it("правка в середине — каретка остаётся у правленой цифры", () => {
    dialog();
    const phone = screen.getByLabelText("Телефон") as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "+7 (900) 123-45-6" } });
    phone.focus();
    // Вписали 9 после «1»: «+7 (900) 19|23-45-6».
    fireEvent.change(phone, { target: { value: "+7 (900) 1923-45-6", selectionStart: 11, selectionEnd: 11 } });
    expect(phone.value).toBe("+7 (900) 192-34-56");
    expect(phone.selectionStart).toBe(11);
  });

  it("неполный номер не уходит на сервер, подсказка — до следующей правки", async () => {
    dialog();
    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Тимур" } });
    const phone = screen.getByLabelText("Телефон");
    fireEvent.change(phone, { target: { value: "+7 900 123" } });
    fireEvent.submit(form());
    expect(await screen.findByRole("alert")).toHaveTextContent("Укажите номер полностью");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(submitLeadForm).not.toHaveBeenCalled();
    fireEvent.change(phone, { target: { value: "+7 (900) 1234" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("нецифра в середине — значение то же, каретка не уезжает в конец", () => {
    dialog();
    const phone = screen.getByLabelText("Телефон") as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "+7 (900) 123-45-67" } });
    phone.focus();
    fireEvent.change(phone, { target: { value: "+7 (900) 12 3-45-67", selectionStart: 12, selectionEnd: 12 } });
    expect(phone.value).toBe("+7 (900) 123-45-67");
    expect(phone.selectionStart).toBe(11);
  });

  it("правка телефона не стирает ошибку сервера", async () => {
    submitLeadForm.mockResolvedValue({ ok: false, error: "dates_taken:2026-09-04" });
    dialog();
    fill();
    fireEvent.submit(form());
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("Телефон"), { target: { value: "+7 (900) 123-45-6" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Выбранные даты уже заняты");
  });

  it("отказ — текст по коду, как у заявки из кабинета, и цели нет", async () => {
    submitLeadForm.mockResolvedValue({ ok: false, error: "dates_taken:2026-09-04" });
    dialog();
    fill();
    fireEvent.submit(form());
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Выбранные даты уже заняты — обновите страницу и выберите другие.");
    expect(goals("booking_sent")).toEqual([]);
  });

  it("лимит — сколько ждать", async () => {
    submitLeadForm.mockResolvedValue({ ok: false, error: "rate_limited:42" });
    dialog();
    fill();
    fireEvent.submit(form());
    expect(await screen.findByRole("alert")).toHaveTextContent("Попробуйте через 42 с.");
  });
});
