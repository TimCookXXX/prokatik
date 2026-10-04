// «Рядом с вами» на главной: заглушка до гидрации, полоса по запомненному
// месту, приглашение без места, геолокация (успех и отказ) и сигнал «открыть
// „Где“» в hero на обеих раскладках. Сеть подменена.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
}));

import { content } from "@theme/content";
import type { UserPoint } from "@/lib/geo/location";
import { NearbyItems } from "@/components/home/NearbyItems";
import { SearchBar } from "@/components/search/SearchBar";
import { _resetPanelDates } from "@/components/search/panel-dates";
import { storeLocation } from "@/components/search/stored-location";
import { onWhereOpen } from "@/components/search/where-open";

const t = content.home.nearby;
const CENTRE = { lat: 45.0355, lon: 38.9753 };
const CITY = { slug: "krasnodar", name: "Краснодар", geo: { region: "krasnodar", centre: CENTRE, token: "t1" } };
const PLACE: UserPoint = {
  point: { lat: 45.0351, lon: 38.9752 }, label: "улица Красная", source: "address", precision: "street",
};
const ITEMS = [{
  id: "L1", title: "Перфоратор Bosch", priceDay: 500, href: "/krasnodar/instrumenty/perforator-L1",
  photoUrl: null, distanceLabel: "≈ 1 км", distanceTitle: "по прямой",
}];

const calls: URL[] = [];
let nearbyItems = ITEMS;

beforeEach(() => {
  calls.length = 0;
  nearbyItems = ITEMS;
  _resetPanelDates();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const u = new URL(input, "http://localhost");
    calls.push(u);
    if (u.pathname === "/api/listings/nearby") return Response.json({ items: nearbyItems });
    if (u.pathname === "/api/geo/reverse") return Response.json({ hit: null });
    if (u.pathname === "/api/search/suggest") return Response.json({ items: [], categories: [] });
    return new Response("{}", { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete (navigator as { geolocation?: unknown }).geolocation;
});

/** Геолокация, ответ которой приходит, когда тест скажет: окно разрешения висит. */
function slowGeolocation() {
  let answer: (coords: { latitude: number; longitude: number; accuracy: number }) => void = () => {};
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) => {
        answer = (coords) => ok({ coords } as GeolocationPosition);
      },
    },
  });
  return (coords: { latitude: number; longitude: number; accuracy: number }) => answer(coords);
}

function allowGeolocation(coords: { latitude: number; longitude: number; accuracy?: number } | null) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) => (coords
        ? ok({ coords } as GeolocationPosition)
        : fail({ code: 1, message: "denied" } as GeolocationPositionError)),
    },
  });
}

/** Раскладка с lg: поповеры вместо шторок. */
function desktop() {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === "(min-width: 1024px)", media: q,
    addEventListener: () => {}, removeEventListener: () => {},
  }));
}

/**
 * Шторка ниже lg — vaul: закрываясь, она ждёт конца анимации ухода, а jsdom
 * анимаций не проигрывает. Конец подаётся вручную — с именем текущей анимации,
 * иначе Radix его не примет; только после него шторка размонтируется и вернёт
 * фокус.
 */
function finishClosing(sheet: HTMLElement) {
  const end = new Event("animationend", { bubbles: true });
  Object.defineProperty(end, "animationName", { value: getComputedStyle(sheet).animationName });
  act(() => { sheet.dispatchEvent(end); });
}

const nearbyCalls = () => calls.filter((u) => u.pathname === "/api/listings/nearby");

describe("NearbyItems", () => {
  // Место живёт в localStorage — сервер и гидрация рисуют только место под
  // полосу, чтобы страница ниже не прыгала.
  it("renders a hidden placeholder on the server", () => {
    storeLocation("krasnodar", PLACE);
    const html = renderToString(<NearbyItems city={CITY} />);
    expect(html).toMatch(/^<div aria-hidden="true" class="[^"]*min-h-/);
    expect(html).not.toContain(t.heading);
    expect(html).not.toContain(t.ctaTitle);
  });

  it("shows the strip near the stored place with the place carried in every link", async () => {
    storeLocation("krasnodar", PLACE);
    render(<NearbyItems city={CITY} />);

    expect(screen.getByRole("heading", { name: t.heading })).toBeInTheDocument();
    expect(screen.getByText(t.from("улица Красная"))).toBeInTheDocument();
    const list = screen.getByRole("list", { name: t.listLabel });

    const card = await within(list).findByRole("link", { name: /Перфоратор Bosch/ });
    const carry = `loc=${encodeURIComponent("p:45.035,38.975")}&la=${encodeURIComponent("улица Красная").replace(/%20/g, "+")}&lp=s`;
    expect(card).toHaveAttribute("href", `/krasnodar/instrumenty/perforator-L1?${carry}`);
    expect(within(card).getByText("≈ 1 км")).toHaveAttribute("title", "по прямой");

    // «Все рядом» — выдача города с той же точкой; «Ближе» там и так по умолчанию.
    const all = screen.getByRole("link", { name: t.all });
    expect(all).toHaveAttribute("href", `/krasnodar?${carry}`);
    expect(all.getAttribute("href")).not.toContain("sort=");

    // Серверу — только точка и её точность.
    const [u] = nearbyCalls();
    expect(Object.fromEntries(u.searchParams)).toEqual({ city: "krasnodar", loc: "p:45.035,38.975", lp: "s" });
  });

  it("says so quietly when nothing is near", async () => {
    nearbyItems = [];
    storeLocation("krasnodar", PLACE);
    render(<NearbyItems city={CITY} />);
    expect(await screen.findByText(t.empty)).toBeInTheDocument();
  });

  it("ignores a place of another region and invites to set one", () => {
    storeLocation("adygea", PLACE);
    allowGeolocation(null);
    render(<NearbyItems city={CITY} />);
    expect(screen.getByRole("heading", { name: t.ctaTitle })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.locate })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.orAddress })).toBeInTheDocument();
    expect(nearbyCalls()).toHaveLength(0);
  });

  it("offers only the address without geolocation in the browser", () => {
    render(<NearbyItems city={CITY} />);
    expect(screen.queryByRole("button", { name: t.locate })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.pickAddress })).toBeInTheDocument();
  });

  it("stores the located place, applies it to the hero «Где» and shows the strip", async () => {
    allowGeolocation({ latitude: 45.03512, longitude: 38.97534, accuracy: 400 });
    render(
      <>
        <SearchBar variant="hero" cities={[CITY]} citySlug={CITY.slug} />
        <NearbyItems city={CITY} />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: t.locate }));
    await screen.findByRole("heading", { name: t.heading });

    // Записано как последнее место: геолокация, грубая точность — «до улицы».
    expect(JSON.parse(localStorage.getItem("inrenta_loc")!)).toMatchObject({
      region: "krasnodar", loc: "p:45.035,38.975", src: "geo", lp: "s",
    });
    // И сразу в черновике «Где» панели hero.
    const where = content.search.where;
    expect(screen.getByRole("button", { name: `${where.label}: ${where.myLocation}` })).toBeInTheDocument();
    await screen.findByRole("link", { name: /Перфоратор Bosch/ });
  });

  it("answers a refused geolocation with a quiet hint, not an error", async () => {
    allowGeolocation(null);
    render(<NearbyItems city={CITY} />);
    fireEvent.click(screen.getByRole("button", { name: t.locate }));
    expect(await screen.findByRole("status")).toHaveTextContent(t.denied);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(localStorage.getItem("inrenta_loc")).toBeNull();
  });

  it("asks to open «Где» from «Сменить место» and «или укажите адрес»", () => {
    const open = vi.fn();
    const off = onWhereOpen(open);
    try {
      allowGeolocation(null);
      const { unmount } = render(<NearbyItems city={CITY} />);
      fireEvent.click(screen.getByRole("button", { name: t.orAddress }));
      expect(open).toHaveBeenCalledTimes(1);
      unmount();

      storeLocation("krasnodar", PLACE);
      render(<NearbyItems city={CITY} />);
      fireEvent.click(screen.getByRole("button", { name: t.change }));
      expect(open).toHaveBeenCalledTimes(2);
    } finally {
      off();
    }
  });
});

describe("NearbyItems focus and a late geolocation", () => {
  const where = content.search.where;

  // Кнопка, ждущая геолокацию, держит фокус (aria-disabled, не disabled), а
  // когда приглашение сменилось полосой, фокус переходит к её заголовку.
  it("keeps the focus while locating and hands it to the strip heading", async () => {
    const answer = slowGeolocation();
    render(<NearbyItems city={CITY} />);
    const button = screen.getByRole("button", { name: t.locate });
    act(() => button.focus());
    fireEvent.click(button);

    const busy = await screen.findByRole("button", { name: t.locating });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).not.toBeDisabled();
    expect(document.activeElement).toBe(busy);

    await act(async () => answer({ latitude: 45.03512, longitude: 38.97534, accuracy: 30 }));
    const heading = await screen.findByRole("heading", { name: t.heading });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  // Геолокацию из полосы начали, место выбрали в «Где» hero, потом браузер
  // ответил: поздний ответ не затирает выбор — ни запомненное место, ни поле.
  it("drops its answer once a place is chosen in the hero «Где» meanwhile", async () => {
    const answer = slowGeolocation();
    storeLocation("krasnodar", PLACE);
    localStorage.clear();
    render(
      <>
        <SearchBar variant="hero" cities={[CITY]} citySlug={CITY.slug} />
        <NearbyItems city={CITY} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: t.locate }));
    await screen.findByRole("button", { name: t.locating });

    // «или укажите адрес» → шторка «Где» → «Весь город».
    fireEvent.click(screen.getByRole("button", { name: t.orAddress }));
    const sheet = await screen.findByRole("dialog", { name: where.title });
    fireEvent.click(within(sheet).getByRole("button", { name: where.any }));
    finishClosing(sheet);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Отмена в «Где» гасит ожидание и в полосе — сразу.
    expect(await screen.findByRole("button", { name: t.locate })).toBeInTheDocument();

    await act(async () => answer({ latitude: 45.03512, longitude: 38.97534, accuracy: 30 }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(localStorage.getItem("inrenta_loc")).toBeNull();
    expect(screen.getByRole("heading", { name: t.ctaTitle })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `${where.label}: ${where.myLocation}` })).not.toBeInTheDocument();
  });

  // «Сменить место» → «Весь город»: полоса и её кнопка исчезают, и фокус
  // после шторки возвращается к заголовку блока, а не в документ.
  it("returns the focus to the block heading when the trigger is gone", async () => {
    allowGeolocation(null);
    storeLocation("krasnodar", PLACE);
    render(
      <>
        <SearchBar variant="hero" cities={[CITY]} citySlug={CITY.slug} />
        <NearbyItems city={CITY} />
      </>,
    );
    const change = screen.getByRole("button", { name: t.change });
    act(() => change.focus());
    fireEvent.click(change);
    const sheet = await screen.findByRole("dialog", { name: where.title });
    fireEvent.click(within(sheet).getByRole("button", { name: where.any }));
    finishClosing(sheet);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const heading = await screen.findByRole("heading", { name: t.ctaTitle });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});

describe("open «Где» signal in the hero", () => {
  function renderPage() {
    allowGeolocation(null);
    return render(
      <>
        <SearchBar variant="hero" cities={[CITY]} citySlug={CITY.slug} />
        <NearbyItems city={CITY} />
      </>,
    );
  }

  it("opens the sheet below lg", async () => {
    renderPage();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.orAddress }));
    expect(await screen.findByRole("dialog", { name: content.search.where.title })).toBeInTheDocument();
  });

  it("focuses the «Где» field from lg", async () => {
    desktop();
    // jsdom раскладки не знает, прокрутки к элементу у него нет.
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      renderPage();
      act(() => { fireEvent.click(screen.getByRole("button", { name: t.orAddress })); });
      await waitFor(() => expect(document.activeElement).toBe(document.getElementById("where-hero-input")));
      expect(scroll).toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
