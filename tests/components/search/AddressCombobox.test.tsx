// Ядро поля адреса (AddressCombobox): мини-индекс при первом фокусе, дома с
// сервера, город и округ скрыты в форме объявления, подпись точности, Enter
// без выбора, ARIA. Воркера в jsdom нет — мини-индекс собирается в главном
// потоке (запасной путь address-client.ts); сервер отвечает тем же движком.
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { content } from "@theme/content";
import { buildClientIndex, createGeocoder } from "@/lib/geocoder";
import type { AddressHit } from "@/lib/geocoder/types";
import { AddressCombobox, addressValueOf, type AddressValue } from "@/components/search/AddressCombobox";
import { FIXTURE } from "../../geocoder/fixture";

const engine = createGeocoder(structuredClone(FIXTURE));
const clientIndex = JSON.stringify(buildClientIndex(structuredClone(FIXTURE)));
const CENTRE = { lat: 45.0355, lon: 38.9753 };

let token = 0;
let serverDown = false;
let indexDown = false;
const calls: string[] = [];
const fetchMock = vi.fn(async (input: string) => {
  const url = new URL(input, "http://localhost");
  calls.push(`${url.pathname}?${url.searchParams}`);
  if (url.pathname === "/api/geo/client-index") {
    return indexDown ? new Response("{}", { status: 503 }) : new Response(clientIndex, { status: 200 });
  }
  if (url.pathname === "/api/geo/suggest") {
    if (serverDown) return new Response(JSON.stringify({ items: [] }), { status: 503 });
    const [lat, lon] = (url.searchParams.get("near") ?? "").split(",").map(Number);
    const items = engine.suggest(url.searchParams.get("q") ?? "", { near: { lat, lon }, limit: 7 });
    return new Response(JSON.stringify({ items }), { status: 200 });
  }
  return new Response("", { status: 404 });
});

beforeEach(() => {
  calls.length = 0;
  serverDown = false;
  indexDown = false;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const serverCalls = () => calls.filter((c) => c.startsWith("/api/geo/suggest"));
const indexCalls = () => calls.filter((c) => c.startsWith("/api/geo/client-index"));

function Harness({
  mode, initial = null, onPick = () => {}, onClear = () => {}, inForm = false, onSubmit = () => {}, list = "inline",
}: {
  mode: "listing" | "where";
  list?: "popover" | "inline";
  initial?: AddressValue | null;
  onPick?: (hit: AddressHit) => void;
  onClear?: () => void;
  inForm?: boolean;
  onSubmit?: () => void;
}) {
  const [value, setValue] = useState<AddressValue | null>(initial);
  // Метка своя на каждый рендер: мини-индекс кэшируется на вкладку по метке.
  const [geo] = useState(() => ({ region: "krasnodar", centre: CENTRE, token: `t${++token}` }));
  const field = (
    <AddressCombobox
      id="addr"
      citySlug="krasnodar"
      cityName="Краснодар"
      geo={geo}
      value={value}
      onPick={(hit) => { onPick(hit); setValue(addressValueOf(hit, "Краснодар")); }}
      onClear={() => { onClear(); setValue(null); }}
      mode={mode}
      list={list}
      label="Адрес"
      placeholder="Улица, дом или ЖК"
    />
  );
  return inForm
    ? <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>{field}<button type="submit">Сохранить</button></form>
    : field;
}

const input = () => screen.getByRole("combobox");
const options = () => screen.queryAllByRole("option");
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });

async function focusReady({ real = false } = {}) {
  const before = indexCalls().length;
  // real — настоящий фокус (document.activeElement): нужен, где проверяется,
  // остаётся ли он в поле, и где поле само вызывает blur().
  if (real) act(() => input().focus());
  else fireEvent.focus(input());
  // мини-индекс скачан и собран (idle → setTimeout в jsdom)
  await waitFor(() => expect(indexCalls()).toHaveLength(before + 1));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

describe("AddressCombobox", () => {
  it("loads the mini index once on first focus and suggests streets without the server", async () => {
    render(<Harness mode="listing" />);
    expect(indexCalls()).toHaveLength(0); // не при рендере
    await focusReady();
    expect(indexCalls()[0]).toMatch(/city=krasnodar&v=t\d+$/);
    type("ставропольск");
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Ставропольская"));
    // строка подписана точностью
    expect(options()[0]).toHaveTextContent("≈ до улицы");
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(serverCalls()).toHaveLength(0);
    fireEvent.blur(input());
    fireEvent.focus(input());
    expect(indexCalls()).toHaveLength(1);
  });

  it("asks the server for houses, near the city centre, and picks one", async () => {
    const onPick = vi.fn();
    render(<Harness mode="listing" onPick={onPick} />);
    await focusReady();
    type("красная 120");
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Красная, 120"));
    expect(serverCalls()[0]).toContain(`near=${CENTRE.lat.toFixed(4)}%2C${CENTRE.lon.toFixed(4)}`);
    fireEvent.click(options()[0]);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: "house", title: "улица Красная, 120" }));
    expect(input()).toHaveValue("улица Красная, 120");
    // под полем — что увидят покупатели
    expect(screen.getByText(content.address.note.listing.house)).toBeInTheDocument();
    expect(input()).toHaveAttribute("aria-describedby", "addr-note");
  });

  it("listing: a whole city is not offered; «Где»: it is", async () => {
    const { unmount } = render(<Harness mode="listing" />);
    await focusReady();
    type("краснодар");
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(options().some((o) => o.textContent?.includes("город"))).toBe(false);
    unmount();

    render(<Harness mode="where" />);
    await focusReady();
    type("краснодар");
    await waitFor(() => expect(options().some((o) => o.textContent?.startsWith("Краснодар"))).toBe(true));
  });

  it("listing: typing only a city and leaving the field asks to be more precise", async () => {
    const onClear = vi.fn();
    render(<Harness mode="listing" onClear={onClear} />);
    await focusReady();
    type("краснодар");
    fireEvent.blur(input());
    await waitFor(() => expect(screen.getByText(content.address.tooCoarse)).toBeInTheDocument());
    expect(onClear).toHaveBeenCalled();
    expect(input()).toHaveValue("");
  });

  it("an approximate pick shows «≈» under the field", async () => {
    render(<Harness mode="listing" />);
    await focusReady();
    type("юбилейн");
    await waitFor(() => expect(options()[0]).toHaveTextContent("Юбилейный"));
    fireEvent.click(options()[0]);
    expect(screen.getByText(content.address.note.listing.place)).toBeInTheDocument();
  });

  it("Enter without a row takes the first suggestion; in the listing form it does not submit", async () => {
    const onPick = vi.fn();
    const onSubmit = vi.fn();
    render(<Harness mode="listing" inForm onPick={onPick} onSubmit={onSubmit} />);
    await focusReady();
    type("базовская 21к1");
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][0]).toMatchObject({ title: "улица Базовская, 21к1" });
    expect(input()).toHaveValue("улица Базовская, 21к1, Яблоновский");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("after an Enter pick the field stays focused, and text typed next is resolved on leaving", async () => {
    const onPick = vi.fn();
    const onClear = vi.fn();
    render(<Harness mode="listing" onPick={onPick} onClear={onClear} />);
    await focusReady({ real: true });
    type("базовская 21к1");
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(input());
    type("zzzzqqq");
    act(() => input().blur());
    await waitFor(() => expect(screen.getByText(content.address.notFound)).toBeInTheDocument());
    expect(onClear).toHaveBeenCalled();
    expect(input()).toHaveValue("");
  });

  it("keyboard keeps focus in the field: Escape and Enter on a row; a pointer pick blurs it", async () => {
    const onPick = vi.fn();
    render(<Harness mode="listing" onPick={onPick} />);
    await focusReady({ real: true });
    type("базовская");
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(options()).toHaveLength(0);
    expect(document.activeElement).toBe(input());

    type("ставропольск");
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Ставропольская"));
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(input());
    expect(input()).toHaveValue("улица Ставропольская");

    type("красная");
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Красная"));
    fireEvent.click(options()[0]);
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(document.activeElement).not.toBe(input());
  });

  it("popover: a tap outside that leaves focus in the field still resolves the typed text", async () => {
    const onPick = vi.fn();
    render(<Harness mode="listing" list="popover" onPick={onPick} />);
    await focusReady({ real: true });
    type("ставропольск");
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Ставропольская"));
    // Radix вешает слушатель pointerdown снаружи с задержкой после открытия.
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    // Тап мимо на телефоне: фокус в поле остаётся (jsdom тоже его не снимает),
    // Radix сообщает о нём по click.
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0][0]).toMatchObject({ title: "улица Ставропольская" });
    expect(document.activeElement).not.toBe(input());
    expect(input()).toHaveValue("улица Ставропольская");
  });

  it("«Где»: Enter resolves the address and then submits the search", async () => {
    const onSubmit = vi.fn();
    render(<Harness mode="where" inForm onSubmit={onSubmit} />);
    await focusReady();
    type("ставропольская");
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(input()).toHaveValue("улица Ставропольская");
  });

  it("not found — says so and clears the value; server down without the mini index — a retry hint", async () => {
    const onClear = vi.fn();
    const { unmount } = render(<Harness mode="listing" onClear={onClear} />);
    await focusReady();
    type("zzzzqqq");
    fireEvent.blur(input());
    await waitFor(() => expect(screen.getByText(content.address.notFound)).toBeInTheDocument());
    expect(onClear).toHaveBeenCalled();
    unmount();

    indexDown = true;
    serverDown = true;
    render(<Harness mode="listing" />);
    fireEvent.focus(input());
    type("красная 120");
    fireEvent.blur(input());
    await waitFor(() => expect(screen.getByText(content.address.failed)).toBeInTheDocument());
  });

  it("ARIA: aria-controls only for a mounted list, arrows move data-active, Escape closes", async () => {
    render(<Harness mode="listing" />);
    expect(input()).not.toHaveAttribute("aria-controls");
    await focusReady();
    expect(input()).toHaveAttribute("aria-expanded", "false");
    type("базовская");
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    expect(input()).toHaveAttribute("aria-controls", "addr-list");
    expect(input()).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveAttribute("aria-activedescendant", "addr-opt-0");
    expect(options()[0]).toHaveAttribute("data-active", "true");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input()).toHaveAttribute("aria-activedescendant", `addr-opt-${options().length - 1}`);
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(options()).toHaveLength(0);
    expect(input()).not.toHaveAttribute("aria-controls");
  });

  it("edit: shows the saved address, and focusing then leaving keeps it", async () => {
    const onPick = vi.fn();
    const onClear = vi.fn();
    const saved: AddressValue = { label: "улица Красная, 120", precision: "house", kind: "house", point: { lat: 45.035, lon: 38.98 } };
    render(<Harness mode="listing" initial={saved} onPick={onPick} onClear={onClear} />);
    expect(input()).toHaveValue("улица Красная, 120");
    await focusReady();
    fireEvent.blur(input());
    expect(onPick).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    expect(input()).toHaveValue("улица Красная, 120");
  });

  it("the clear button resets the value", async () => {
    const onClear = vi.fn();
    const saved: AddressValue = { label: "улица Красная", precision: "street", kind: "street", point: CENTRE };
    render(<Harness mode="where" initial={saved} onClear={onClear} />);
    expect(screen.getByText(content.address.note.where.street)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: content.address.clear }));
    expect(onClear).toHaveBeenCalled();
    expect(input()).toHaveValue("");
  });
});

describe("addressValueOf", () => {
  it("a city gives no point; a street gives an approximate one", () => {
    const krd = engine.suggest("краснодар", { limit: 1 })[0];
    expect(addressValueOf(krd, "Краснодар")).toMatchObject({ precision: "city", point: null });
    const st = engine.suggest("красная", { limit: 1 })[0];
    expect(addressValueOf(st, "Краснодар")).toMatchObject({ label: "улица Красная", precision: "street", kind: "street" });
  });
});
