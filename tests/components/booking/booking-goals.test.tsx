import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Цели брони: «Забронировать» с признаком входа и отправленная заявка — один
// раз на успех, без телефона и комментария в параметрах.
vi.mock("@/components/auth/LoginDialog", () => ({ LoginDialog: () => null }));
const createBookingRequest = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/booking", () => ({ createBookingRequest }));
const reachGoal = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/goals", () => ({ reachGoal }));

const { BookingWidget } = await import("@/components/booking/BookingWidget");
const { BookingFormDialog } = await import("@/components/booking/BookingFormDialog");

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
  priceDay: 500,
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
  createBookingRequest.mockReset();
  createBookingRequest.mockResolvedValue({ ok: true, data: undefined });
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
      sel={base.initial} priceDay={500} initialPhone={base.initialPhone}
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

  it("отказ сервера — цели нет", async () => {
    createBookingRequest.mockResolvedValue({ ok: false, error: "dates_unavailable" });
    dialog();
    fireEvent.submit(form());
    await waitFor(() => expect(createBookingRequest).toHaveBeenCalled());
    await screen.findByRole("alert");
    expect(goals("booking_sent")).toEqual([]);
  });
});
