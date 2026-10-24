import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { content } from "@theme/content";

// Цели формы объявления: «Начал размещать» — первое изменение поля новой
// формы, «Разместил» — успех createListing. Правка своего объявления ни той,
// ни другой не даёт.
const createListing = vi.fn();
const updateListing = vi.fn();
vi.mock("@/server/actions/owner", () => ({
  createListing: (input: unknown) => createListing(input),
  updateListing: (id: string, input: unknown) => updateListing(id, input),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const reachGoal = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/goals", () => ({ reachGoal }));

const { ListingForm } = await import("@/components/cabinet/ListingForm");
type Props = Parameters<typeof ListingForm>[0];

const A = content.address.listing;
// Город без геоданных: адрес — свободный текст, геокодер не нужен.
const cities: Props["cities"] = [{ id: "c-kzn", name: "Казань", slug: "kazan", geo: null }];
const initial: Props["initial"] = {
  title: "", cityId: "c-kzn", categoryId: "cat", description: "",
  priceDay: "500", priceWeek: "", priceMonth: "", minDays: "1",
  depositType: "none", depositAmount: "", quantity: "1",
  handoverPickup: true, handoverDelivery: false, photos: [],
};

beforeEach(() => {
  reachGoal.mockClear();
  push.mockClear();
  createListing.mockReset();
  updateListing.mockReset();
  createListing.mockResolvedValue({ ok: true, data: { listingId: "l1" } });
  updateListing.mockResolvedValue({ ok: true, data: undefined });
});

const renderForm = (over: Partial<Props> = {}) => render(
  <ListingForm mode="create" cities={cities} categories={[{ id: "cat", name: "Перфораторы" }]} initial={initial} {...over} />,
);
const form = () => document.querySelector<HTMLFormElement>('form[name="listing"]')!;
const title = () => screen.getByRole("textbox", { name: "Название" });
const address = () => screen.getByRole("textbox", { name: A.label });
const goals = (name: string) => reachGoal.mock.calls.filter(([n]) => n === name);

describe("цель listing_started", () => {
  it("первое изменение поля новой формы — одна цель", () => {
    renderForm();
    expect(form()).not.toBeNull();
    fireEvent.change(title(), { target: { value: "П" } });
    fireEvent.change(title(), { target: { value: "Пе" } });
    fireEvent.change(address(), { target: { value: "ул. Баумана, 1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Доставка/ }));
    expect(goals("listing_started")).toEqual([["listing_started"]]);
  });

  // Перетаскивание фото события change не даёт — его отмечает загрузка.
  it("фото, брошенное перетаскиванием, — тоже начало", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderForm();
      const file = new File(["x"], "drill.jpg", { type: "image/jpeg" });
      fireEvent.drop(screen.getByText(/перетащите фото/).closest("label")!, { dataTransfer: { files: [file] } });
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(goals("listing_started")).toEqual([["listing_started"]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("без изменений полей цели нет", () => {
    renderForm();
    expect(goals("listing_started")).toEqual([]);
  });

  it("правка своего объявления — не начало размещения", () => {
    renderForm({ mode: "edit", listingId: "l1", initial: { ...initial, title: "Перфоратор" } });
    fireEvent.change(title(), { target: { value: "Перфоратор Bosch" } });
    expect(goals("listing_started")).toEqual([]);
  });
});

describe("цель listing_created", () => {
  const fill = () => {
    fireEvent.change(title(), { target: { value: "Перфоратор Bosch" } });
    fireEvent.change(address(), { target: { value: "ул. Баумана, 1" } });
  };

  it("успех создания — одна цель, до перехода в кабинет", async () => {
    renderForm();
    fill();
    fireEvent.submit(form());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(goals("listing_created")).toEqual([["listing_created"]]);
  });

  it("отказ сервера — цели нет", async () => {
    createListing.mockResolvedValue({ ok: false, error: "Укажите цену" });
    renderForm();
    fill();
    fireEvent.submit(form());
    await screen.findByRole("alert");
    expect(goals("listing_created")).toEqual([]);
  });

  it("сохранение правки — цели нет", async () => {
    renderForm({
      mode: "edit", listingId: "l1", initial: { ...initial, title: "Перфоратор" },
      savedAddress: { label: "ул. Баумана, 1" } as never,
    });
    fireEvent.submit(form());
    await waitFor(() => expect(updateListing).toHaveBeenCalled());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(reachGoal).not.toHaveBeenCalled();
  });
});
