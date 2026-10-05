// Адрес выдачи в форме объявления: payload `keep` / `pick` / `text`, город
// в регионе с геоданными определяет адрес (выбора города там нет), город без
// геоданных выбирается отдельно и сбрасывает адрес, без адреса форма не
// уходит, ошибка сервера про адрес — у поля. Геокодер — фикстура движка: мини-индекс собирается в главном
// потоке (воркера в jsdom нет), сервер подсказок отвечает тем же движком.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { content } from "@theme/content";
import { buildClientIndex, createGeocoder, withSettlement } from "@/lib/geocoder";
import { FIXTURE } from "../../geocoder/fixture";

const ok = { ok: true as const, data: { listingId: "l1" } };
const createListing = vi.fn(async (_input: unknown) => ok);
const updateListing = vi.fn(async (_id: string, _input: unknown) => ({ ok: true as const, data: undefined }));

// Server actions тянут next-auth и next/server, которых в jsdom нет.
vi.mock("@/server/actions/owner", () => ({
  createListing: (input: unknown) => createListing(input),
  updateListing: (id: string, input: unknown) => updateListing(id, input),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { ListingForm } = await import("@/components/cabinet/ListingForm");
type Props = Parameters<typeof ListingForm>[0];

const A = content.address.listing;
const engine = createGeocoder(structuredClone(FIXTURE));
const clientIndex = JSON.stringify(buildClientIndex(structuredClone(FIXTURE)));
const CENTRE = { lat: 45.0355, lon: 38.9753 };

let token = 0;
// Задержать ответ подсказок сервера: промис, которого ждёт следующий запрос.
let serverGate: Promise<void> | null = null;
const fetchMock = vi.fn(async (input: string) => {
  const url = new URL(input, "http://localhost");
  if (url.pathname === "/api/geo/client-index") return new Response(clientIndex, { status: 200 });
  if (url.pathname === "/api/geo/suggest") {
    if (serverGate) await serverGate;
    const [lat, lon] = (url.searchParams.get("near") ?? "").split(",").map(Number);
    // Как сервер: с пунктами адреса, по ним форма видит город объявления.
    const items = engine.suggest(url.searchParams.get("q") ?? "", { near: { lat, lon }, limit: 7 })
      .map((h) => withSettlement(engine, h));
    return new Response(JSON.stringify({ items }), { status: 200 });
  }
  return new Response("", { status: 404 });
});

beforeEach(() => {
  createListing.mockClear();
  updateListing.mockClear();
  push.mockClear();
  serverGate = null;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

// Метка своя на каждый рендер: мини-индекс кэшируется на вкладку по метке.
const cities = (): Props["cities"] => [
  { id: "c-krd", name: "Краснодар", slug: "krasnodar", geo: { region: "krasnodar", centre: CENTRE, token: `t${++token}` } },
  { id: "c-yab", name: "Яблоновский", slug: "yablonovskiy", geo: { region: "krasnodar", centre: { lat: 44.988, lon: 38.9475 }, token: `t${token}` } },
  { id: "c-kzn", name: "Казань", slug: "kazan", geo: null },
];
const otherCity = () => fireEvent.click(screen.getByRole("button", { name: A.otherCity }));
// Город объявления под полем адреса: «В каталоге: Яблоновский».
const catalogLine = () => screen.getByText(A.catalogCity, { exact: false }).textContent;

const initial = (cityId: string): Props["initial"] => ({
  title: "Перфоратор Bosch", cityId, categoryId: "cat", description: "",
  priceDay: "500", depositType: "none", depositAmount: "", quantity: "1",
  handoverPickup: true, handoverDelivery: false, photos: [],
});

function renderForm(over: Partial<Props> & { cityId?: string } = {}) {
  const { cityId = "c-krd", ...rest } = over;
  return render(
    <ListingForm
      mode="create"
      cities={cities()}
      categories={[{ id: "cat", name: "Перфораторы" }]}
      initial={initial(cityId)}
      {...rest}
    />,
  );
}

const combobox = () => screen.getByRole("combobox", { name: A.label });
// Строки подсказок — только из списка адреса: у <select> формы тоже есть option.
const options = () => {
  const list = screen.queryByRole("listbox", { name: A.label });
  return list ? within(list).queryAllByRole("option") : [];
};
const submit = () => fireEvent.submit(screen.getByRole("button", { name: /Добавить позицию|Сохранить/ }).closest("form")!);
const sent = (fn: typeof createListing | typeof updateListing) =>
  (fn.mock.calls[0].at(-1) as { address: unknown }).address;
const sentCity = (fn: typeof createListing | typeof updateListing) =>
  (fn.mock.calls[0].at(-1) as { cityId: string }).cityId;

async function typeAddress(text: string) {
  fireEvent.focus(combobox());
  // мини-индекс скачан и собран (idle → setTimeout в jsdom)
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  fireEvent.change(combobox(), { target: { value: text } });
}

describe("ListingForm: адрес выдачи", () => {
  it("без адреса в городе с геоданными форма не уходит, ошибка — у поля", async () => {
    renderForm();
    expect(combobox()).toHaveValue("");
    submit();
    await waitFor(() => expect(screen.getByText(A.required)).toBeInTheDocument());
    expect(createListing).not.toHaveBeenCalled();
    expect(combobox()).toHaveAttribute("aria-invalid", "true");
    expect(combobox().getAttribute("aria-describedby")).toContain("listing-address-error");
  });

  it("выбранный дом уходит как pick, под полем — что увидят покупатели", async () => {
    renderForm();
    await typeAddress("красная 120");
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Красная, 120"));
    fireEvent.click(options()[0]);
    expect(screen.getByText(content.address.note.listing.house)).toBeInTheDocument();
    submit();
    await waitFor(() => expect(createListing).toHaveBeenCalled());
    expect(sent(createListing)).toEqual({
      mode: "pick", kind: "house", title: "улица Красная, 120", subtitle: expect.any(String),
      lat: expect.any(Number), lon: expect.any(Number),
    });
    expect(createListing.mock.calls[0][0]).not.toHaveProperty("location");
  });

  it("улица из мини-индекса — pick с «≈ до улицы»", async () => {
    renderForm();
    await typeAddress("ставропольск");
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Ставропольская"));
    fireEvent.click(options()[0]);
    expect(screen.getByText(content.address.note.listing.street)).toBeInTheDocument();
    submit();
    await waitFor(() => expect(createListing).toHaveBeenCalled());
    expect(sent(createListing)).toMatchObject({ mode: "pick", kind: "street", title: "улица Ставропольская" });
  });

  it("ввели и сразу «Добавить» — уходит первая подсказка, а не «Укажите адрес»", async () => {
    renderForm();
    await typeAddress("юбилейн");
    fireEvent.blur(combobox());
    submit();
    await waitFor(() => expect(createListing).toHaveBeenCalled());
    expect(sent(createListing)).toMatchObject({ mode: "pick", kind: "place", title: "Юбилейный" });
    expect(screen.queryByText(A.required)).not.toBeInTheDocument();
  });

  it("правка: сохранённый адрес в поле, уходит keep, пока его не трогали", async () => {
    renderForm({
      mode: "edit", listingId: "l1",
      savedAddress: { label: "улица Красная, 120", precision: "house", point: { lat: 45.035, lon: 38.98 } },
    });
    expect(combobox()).toHaveValue("улица Красная, 120");
    expect(screen.getByText(content.address.note.listing.house)).toBeInTheDocument();
    // фокус и уход без правки — всё ещё keep
    fireEvent.focus(combobox());
    fireEvent.blur(combobox());
    submit();
    await waitFor(() => expect(updateListing).toHaveBeenCalled());
    expect(updateListing.mock.calls[0][0]).toBe("l1");
    expect(sent(updateListing)).toEqual({ mode: "keep" });
  });

  it("правка: сохранённое место неизвестного вида подписано так, что верно и для пункта, и для ЖК", () => {
    renderForm({
      mode: "edit", listingId: "l1",
      savedAddress: { label: "ЖК Панорама", precision: "place", point: CENTRE },
    });
    expect(screen.getByText(content.address.note.listing.area)).toBeInTheDocument();
    expect(screen.queryByText(content.address.note.listing.place)).not.toBeInTheDocument();
  });

  it("правка: тронули поле и выбрали другое — уходит pick", async () => {
    renderForm({
      mode: "edit", listingId: "l1",
      savedAddress: { label: "улица Красная, 120", precision: "house", point: { lat: 45.035, lon: 38.98 } },
    });
    await typeAddress("ставропольск");
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Ставропольская"));
    fireEvent.click(options()[0]);
    submit();
    await waitFor(() => expect(updateListing).toHaveBeenCalled());
    expect(sent(updateListing)).toMatchObject({ mode: "pick", title: "улица Ставропольская" });
  });

  it("правка строки без точки в городе с геоданными: keep не предлагается, просим выбрать", async () => {
    renderForm({
      mode: "edit", listingId: "l1",
      savedAddress: { label: "ЖК Радуга", precision: "city", point: null },
    });
    expect(combobox()).toHaveValue("");
    expect(screen.getByText(A.legacy("ЖК Радуга"))).toBeInTheDocument();
    submit();
    await waitFor(() => expect(screen.getByText(A.required)).toBeInTheDocument());
    expect(updateListing).not.toHaveBeenCalled();
  });

  // Город объявления определяет адрес: выбора города рядом с поиском нет, под
  // полем — куда отойдёт вещь, и уходит этот город, а не город поиска.
  it("в регионе с геоданными города не выбирают: его определяет адрес", async () => {
    renderForm();
    expect(screen.queryByRole("combobox", { name: A.city })).not.toBeInTheDocument();
    expect(screen.getByText(A.catalogHint)).toBeInTheDocument();

    await typeAddress("базовская 21к1");
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Базовская, 21к1"));
    fireEvent.click(options()[0]);
    expect(catalogLine()).toBe(`${A.catalogCity} Яблоновский`);
    // Подпись — как сохранится: пункт и есть город объявления.
    expect(combobox()).toHaveValue("улица Базовская, 21к1, Яблоновский");
    submit();
    await waitFor(() => expect(createListing).toHaveBeenCalled());
    expect(sentCity(createListing)).toBe("c-yab");
    expect(sent(createListing)).toMatchObject({ mode: "pick", kind: "house" });
  });

  it("пункт, который не город сервиса, отходит ближайшему городу", async () => {
    renderForm({ cityId: "c-yab" });
    await typeAddress("садовая новая адыгея");
    await waitFor(() => expect(options().some((o) => o.textContent?.includes("Новая Адыгея"))).toBe(true));
    fireEvent.click(options().find((o) => o.textContent?.includes("Новая Адыгея"))!);
    expect(catalogLine()).toBe(`${A.catalogCity} Краснодар`);
    submit();
    await waitFor(() => expect(createListing).toHaveBeenCalled());
    expect(sentCity(createListing)).toBe("c-krd");
  });

  it("правка: под сохранённым адресом — город объявления", () => {
    renderForm({
      cityId: "c-yab", mode: "edit", listingId: "l1",
      savedAddress: { label: "улица Связи", precision: "street", point: { lat: 44.985, lon: 38.955 } },
    });
    expect(catalogLine()).toBe(`${A.catalogCity} Яблоновский`);
  });

  it("город без геоданных — отдельной ссылкой: адрес сбрасывается, уходит text с этим городом", async () => {
    renderForm({
      mode: "edit", listingId: "l1",
      savedAddress: { label: "улица Красная, 120", precision: "house", point: { lat: 45.035, lon: 38.98 } },
    });
    otherCity();
    expect(screen.queryByRole("combobox", { name: A.label })).not.toBeInTheDocument();
    // В выборе — только города без геоданных; единственный выбран сразу.
    const select = screen.getByRole("combobox", { name: A.city });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([A.cityPlaceholder, "Казань"]);
    expect(select).toHaveValue("c-kzn");
    const text = screen.getByRole("textbox", { name: A.label });
    expect(text).toHaveValue("");
    submit();
    await waitFor(() => expect(screen.getByText(A.required)).toBeInTheDocument());
    expect(updateListing).not.toHaveBeenCalled();

    fireEvent.change(text, { target: { value: "ул. Баумана" } });
    submit();
    await waitFor(() => expect(updateListing).toHaveBeenCalled());
    expect(sentCity(updateListing)).toBe("c-kzn");
    expect(sent(updateListing)).toEqual({ mode: "text", text: "ул. Баумана" });
  });

  it("из текстового режима — назад к поиску адреса, адрес снова пуст", () => {
    renderForm({ cityId: "c-kzn" });
    fireEvent.change(screen.getByRole("textbox", { name: A.label }), { target: { value: "ул. Баумана" } });
    fireEvent.click(screen.getByRole("button", { name: A.backToSearch }));
    expect(combobox()).toHaveValue("");
    expect(screen.queryByRole("combobox", { name: A.city })).not.toBeInTheDocument();
  });

  it("подсказка, пришедшая после перехода к другому городу, его адрес не занимает", async () => {
    let release = () => {};
    serverGate = new Promise((r) => { release = r; });
    renderForm();
    await typeAddress("красная 120");
    // ушли с поля: первая подсказка ждёт сервер, а город тем временем сменили
    fireEvent.blur(combobox());
    otherCity();
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByRole("textbox", { name: A.label })).toHaveValue("");
    submit();
    await waitFor(() => expect(screen.getByText(A.required)).toBeInTheDocument());
    expect(createListing).not.toHaveBeenCalled();
  });

  it("город без геоданных: обязательный текст с подсказкой «без номера дома», уходит text", async () => {
    renderForm({ cityId: "c-kzn" });
    expect(screen.queryByRole("combobox", { name: A.label })).not.toBeInTheDocument();
    const text = screen.getByRole("textbox", { name: A.label });
    expect(text).toBeRequired();
    expect(text).toHaveAttribute("minLength", "3");
    expect(text).toHaveAccessibleDescription(A.textHint);
    fireEvent.change(text, { target: { value: "ул. Баумана" } });
    submit();
    await waitFor(() => expect(createListing).toHaveBeenCalled());
    expect(sent(createListing)).toEqual({ mode: "text", text: "ул. Баумана" });
  });

  it("правка в городе без геоданных: keep, пока текст не тронули; смена города на него — пустое поле", async () => {
    const { unmount } = renderForm({
      cityId: "c-kzn", mode: "edit", listingId: "l1",
      savedAddress: { label: "ул. Баумана", precision: "city", point: null },
    });
    expect(screen.getByRole("textbox", { name: A.label })).toHaveValue("ул. Баумана");
    submit();
    await waitFor(() => expect(updateListing).toHaveBeenCalled());
    expect(sent(updateListing)).toEqual({ mode: "keep" });
    unmount();

    renderForm({
      mode: "edit", listingId: "l1",
      savedAddress: { label: "улица Красная, 120", precision: "house", point: { lat: 45.035, lon: 38.98 } },
    });
    otherCity();
    expect(screen.getByRole("textbox", { name: A.label })).toHaveValue("");
  });

  it("отказ сервера про адрес показывается у поля, прочие — внизу формы", async () => {
    updateListing.mockResolvedValueOnce({ ok: false, error: A.unavailable } as never);
    renderForm({
      mode: "edit", listingId: "l1",
      savedAddress: { label: "улица Красная, 120", precision: "house", point: { lat: 45.035, lon: 38.98 } },
    });
    submit();
    const err = await screen.findByText(A.unavailable);
    expect(err).toHaveAttribute("id", "listing-address-error");
    expect(combobox().getAttribute("aria-describedby")).toContain("listing-address-error");
    expect(push).not.toHaveBeenCalled();

    updateListing.mockResolvedValueOnce({ ok: false, error: A.stale } as never);
    submit();
    const stale = await screen.findByText(A.stale);
    expect(stale).not.toHaveAttribute("id", "listing-address-error");
    expect(screen.queryByText(A.unavailable)).not.toBeInTheDocument();

    // город или округ целиком сервер отвергает тоже про адрес
    updateListing.mockResolvedValueOnce({ ok: false, error: content.address.tooCoarse } as never);
    submit();
    const coarse = await screen.findByText(content.address.tooCoarse);
    expect(coarse).toHaveAttribute("id", "listing-address-error");
    expect(combobox()).toHaveAttribute("aria-invalid", "true");
  });
});
