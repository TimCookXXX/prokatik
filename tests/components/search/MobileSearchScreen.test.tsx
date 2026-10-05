import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
const url = { pathname: "/kazan", search: "" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => url.pathname,
  useSearchParams: () => new URLSearchParams(url.search),
}));

import { content } from "@theme/content";
import { SearchBar } from "@/components/search/SearchBar";
import { MobileSearchScreen } from "@/components/search/MobileSearchScreen";
import { RECENT_QUERIES_KEY } from "@/components/search/recent-queries";
import { _resetPanelDates } from "@/components/search/panel-dates";
import { _resetSuggestCache } from "@/components/search/suggest-client";
import {
  SCREEN_HISTORY_MARKER, _resetSearchQuery, closeSearchScreen, openSearchScreen,
} from "@/components/search/search-query";

const CITIES = [{ slug: "kazan", name: "Казань", geo: null }];
const t = content.search;

beforeEach(() => {
  _resetSearchQuery();
  _resetPanelDates();
  _resetSuggestCache();
  push.mockClear();
  replace.mockClear();
  url.pathname = "/kazan";
  url.search = "";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ queries: [], categories: [] }) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

function renderPage() {
  return render(
    <>
      <header data-site-header><SearchBar variant="header" cities={CITIES} /></header>
      <MobileSearchScreen cities={CITIES} />
    </>,
  );
}

const trigger = () => screen.getByRole("button", { name: new RegExp(`^${t.whatLabel}`), hidden: true });
const dialog = () => screen.queryByRole("dialog", { name: t.screenLabel });
const screenField = () => within(dialog()!).getByRole("combobox");
const open = () => fireEvent.click(trigger());

describe("search screen: opening and closing", () => {
  it("opens on a tap with the focus in its field and pushes a history entry without a new URL", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const before = window.location.href;
    renderPage();
    expect(dialog()).toBeNull();

    open();
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(screenField());
    expect(screenField()).toHaveClass("text-base");
    expect(screenField()).toHaveAttribute("enterkeyhint", "search");
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState.mock.calls[0][0]).toEqual({ [SCREEN_HISTORY_MARKER]: true });
    expect(pushState.mock.calls[0][2]).toBeUndefined();
    expect(window.location.href).toBe(before);
  });

  it("«←» goes back in history and returns the focus to the trigger", async () => {
    const back = vi.spyOn(window.history, "back");
    renderPage();
    open();

    fireEvent.click(within(dialog()!).getByRole("button", { name: t.screenBack }));
    expect(dialog()).toBeNull();
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("Esc goes back in history too", () => {
    const back = vi.spyOn(window.history, "back");
    renderPage();
    open();

    fireEvent.keyDown(screenField(), { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("the browser «back» (popstate) closes the screen, and «←» then does not go back again", () => {
    const back = vi.spyOn(window.history, "back");
    renderPage();
    open();

    act(() => { window.dispatchEvent(new PopStateEvent("popstate", { state: null })); });
    expect(dialog()).toBeNull();
    // Наша запись ушла с «назад» — второй раз назад не идём.
    act(() => closeSearchScreen());
    expect(back).not.toHaveBeenCalled();
  });

  it("popstate closes the When sheet together with the screen", async () => {
    renderPage();
    open();
    fireEvent.click(within(dialog()!).getByRole("button", { name: /^Когда:/ }));
    expect(await screen.findByRole("dialog", { name: t.when.title })).toBeInTheDocument();

    act(() => { window.dispatchEvent(new PopStateEvent("popstate", { state: null })); });
    // vaul в jsdom анимацию закрытия не досматривает — смотрим на состояние.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: t.when.title, hidden: true }))
      .not.toHaveAttribute("data-state", "open"));
    expect(dialog()).toBeNull();
  });

  it("losing the focus does not close the screen", () => {
    renderPage();
    open();
    act(() => screenField().blur());
    expect(dialog()).not.toBeNull();
  });

  it("stays open when the viewport grows past lg while it is open", () => {
    renderPage();
    open();
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: (q: string) => ({
      matches: q === "(min-width: 1024px)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }) });
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(dialog()).not.toBeNull();
  });
});

describe("search screen: the shared query", () => {
  it("keeps the typed text after closing, in the trigger and on the next opening", () => {
    renderPage();
    open();
    fireEvent.change(screenField(), { target: { value: "палатка" } });
    act(() => closeSearchScreen());

    expect(trigger()).toHaveAccessibleName(`${t.whatLabel}: палатка`);
    open();
    expect(screenField()).toHaveValue("палатка");
  });

  it("follows the address q, but not while the screen is open", () => {
    url.pathname = "/search";
    url.search = "q=дрель";
    const { rerender } = renderPage();
    expect(trigger()).toHaveAccessibleName(`${t.whatLabel}: дрель`);

    open();
    fireEvent.change(screenField(), { target: { value: "перф" } });
    url.search = "q=палатка";
    rerender(
      <>
        <header data-site-header><SearchBar variant="header" cities={CITIES} /></header>
        <MobileSearchScreen cities={CITIES} />
      </>,
    );
    expect(screenField()).toHaveValue("перф");
  });
});

describe("search screen: leaving it", () => {
  it("submits with router.replace, not push, and remembers the query", () => {
    renderPage();
    open();
    fireEvent.change(screenField(), { target: { value: "перфоратор" } });
    fireEvent.submit(screenField().closest("form")!);

    expect(replace).toHaveBeenCalledWith(`/search?${new URLSearchParams({ q: "перфоратор", city: "kazan" })}`);
    expect(push).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(JSON.parse(localStorage.getItem(RECENT_QUERIES_KEY)!)).toEqual(["перфоратор"]);
  });

  it("does not go back in history after leaving with replace", () => {
    const back = vi.spyOn(window.history, "back");
    renderPage();
    open();
    fireEvent.change(screenField(), { target: { value: "дрель" } });
    fireEvent.submit(screenField().closest("form")!);
    expect(back).not.toHaveBeenCalled();
  });

  it("an empty submit stays on the screen with the focus in the field", () => {
    url.pathname = "/cabinet";
    renderPage();
    open();
    fireEvent.submit(screenField().closest("form")!);
    expect(replace).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(screenField());
  });

  it("the same address just closes the screen instead of replacing its entry", () => {
    const back = vi.spyOn(window.history, "back");
    url.pathname = "/search";
    url.search = "q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C&city=kazan";
    renderPage();
    open();
    fireEvent.submit(screenField().closest("form")!);
    expect(replace).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
});

describe("search screen: a submit waiting for «Где»", () => {
  const KRASNODAR = { slug: "krasnodar", name: "Краснодар", geo: { region: "krasnodar", centre: { lat: 45.03, lon: 38.97 }, token: "t" } };

  it("is dropped when the screen is closed before «Где» resolves", async () => {
    url.pathname = "/krasnodar";
    let resolveGeo!: (pos: GeolocationPosition) => void;
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: { getCurrentPosition: (ok: (pos: GeolocationPosition) => void) => { resolveGeo = ok; } },
    });
    render(<><header data-site-header><SearchBar variant="header" cities={[KRASNODAR]} /></header><MobileSearchScreen cities={[KRASNODAR]} /></>);
    open();
    fireEvent.change(screenField(), { target: { value: "дрель" } });
    fireEvent.click(within(dialog()!).getByRole("button", { name: /^Где:/ }));
    const sheet = await screen.findByRole("dialog", { name: content.search.where.title });
    fireEvent.click(within(sheet).getByRole("button", { name: content.search.where.myLocation }));
    // Пока геолокация думает, человек жмёт «Найти» на экране, а потом «назад».
    act(() => { fireEvent.submit(document.querySelector<HTMLFormElement>("[data-search-screen] form")!); });
    act(() => closeSearchScreen());
    await act(async () => {
      resolveGeo?.({ coords: { latitude: 45.04, longitude: 38.98, accuracy: 20 } } as GeolocationPosition);
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("search screen: the empty state", () => {
  it("offers popular queries from the content, as links that replace the entry", () => {
    renderPage();
    open();
    const popular = within(dialog()!).getByRole("region", { name: content.home.popularLabel });
    const first = content.home.popularQueries[0];
    const link = within(popular).getByRole("link", { name: first });
    expect(link).toHaveAttribute("href", `/search?${new URLSearchParams({ q: first, city: "kazan" })}`);

    fireEvent.click(link);
    expect(replace).toHaveBeenCalledWith(`/search?${new URLSearchParams({ q: first, city: "kazan" })}`);
  });

  it("lists recent queries, hidden from the session recorder, each with its own delete", () => {
    localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(["дрель", "палатка"]));
    renderPage();
    open();
    const recent = within(dialog()!).getByRole("region", { name: t.recentHeading });
    expect(recent).toHaveClass("ym-hide-content");
    expect(within(recent).getAllByRole("link").map((a) => a.textContent)).toEqual(["дрель", "палатка"]);

    fireEvent.click(within(recent).getByRole("button", { name: t.recentRemove("дрель") }));
    expect(within(recent).getAllByRole("link").map((a) => a.textContent)).toEqual(["палатка"]);
    expect(JSON.parse(localStorage.getItem(RECENT_QUERIES_KEY)!)).toEqual(["палатка"]);
  });

  it("has no recent block without storage, and no counts anywhere", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    renderPage();
    open();
    expect(within(dialog()!).queryByRole("region", { name: t.recentHeading })).toBeNull();
    expect(within(dialog()!).getByRole("region", { name: content.home.popularLabel }).textContent).not.toMatch(/\d/);
  });

  it("switches to suggestions once two letters are typed", async () => {
    renderPage();
    open();
    fireEvent.change(screenField(), { target: { value: "п" } });
    expect(within(dialog()!).getByRole("region", { name: content.home.popularLabel })).toBeInTheDocument();

    fireEvent.change(screenField(), { target: { value: "перф" } });
    expect(within(dialog()!).queryByRole("region", { name: content.home.popularLabel })).toBeNull();
    expect(await within(dialog()!).findByRole("option", { name: t.showAll("перф") })).toBeInTheDocument();
  });
});

describe("search screen: opening from code", () => {
  // iOS поднимает клавиатуру только при focus() в том же обработчике тапа:
  // поле обязано быть в DOM и в фокусе сразу после вызова, без ожидания.
  it("openSearchScreen mounts the screen and focuses its field synchronously", () => {
    renderPage();
    let focused: Element | null = null;
    act(() => {
      openSearchScreen(null);
      focused = document.activeElement;
    });
    expect(focused).toBe(screenField());
  });
});
