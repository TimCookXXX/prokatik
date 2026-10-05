import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const push = vi.fn();
const url = { pathname: "/", search: "" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => url.pathname,
  useSearchParams: () => new URLSearchParams(url.search),
}));

import { content } from "@theme/content";
import { HeaderSearch } from "@/components/layout/HeaderSearch";
import { SearchBar } from "@/components/search/SearchBar";
import { _resetSuggestCache } from "@/components/search/suggest-client";

const CITIES = [
  { slug: "kazan", name: "Казань", geo: null },
  { slug: "spb", name: "Санкт-Петербург", geo: null },
];

const field = () => screen.getByRole("combobox");

const submit = (query?: string) => {
  if (query !== undefined) {
    fireEvent.change(field(), { target: { value: query } });
  }
  fireEvent.submit(screen.getByRole("search"));
};

beforeEach(() => {
  push.mockClear();
  _resetSuggestCache();
  // Подсказки здесь не проверяются (WhatField.test) — сервер молчит.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ queries: [], categories: [] }) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HeaderSearch", () => {
  // Без JS и до гидрации поиск — обычная GET-форма.
  it("is a plain GET form to /search with named fields", () => {
    url.pathname = "/spb/instrumenty";
    url.search = "";

    render(<HeaderSearch cities={CITIES} />);
    const form = screen.getByRole("search", { name: content.search.headerLabel });

    expect(form).toHaveAttribute("action", "/search");
    expect(form).toHaveAttribute("method", "get");
    expect(field()).toHaveAttribute("name", "q");
    expect(form.querySelector('input[type="hidden"][name="city"]')).toHaveValue("spb");
  });

  it("navigates to /search with the query on submit", () => {
    url.pathname = "/";
    url.search = "";

    render(<HeaderSearch />);
    submit("дрель");

    expect(push).toHaveBeenCalledWith("/search?q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C");
  });

  // Без города поиск уводил бы в город по умолчанию: листающий Петербург
  // получал бы выдачу Казани.
  it("carries the city of the page you are searching from", () => {
    url.pathname = "/spb/instrumenty";
    url.search = "";

    render(<HeaderSearch cities={CITIES} />);
    submit("дрель");

    expect(push).toHaveBeenCalledWith("/search?q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C&city=spb");
  });

  it("keeps the city already chosen on the search page", () => {
    url.pathname = "/search";
    url.search = "q=old&city=spb";

    render(<HeaderSearch cities={CITIES} />);
    submit("дрель");

    expect(push).toHaveBeenCalledWith("/search?q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C&city=spb");
  });

  // Первый сегмент пути городом быть не обязан.
  it("does not mistake a non-city route for a city", () => {
    url.pathname = "/cabinet/listings";
    url.search = "";

    render(<HeaderSearch cities={CITIES} />);
    submit("дрель");

    expect(push).toHaveBeenCalledWith("/search?q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C");
  });

  // Пустая отправка вне выдачи — не переход: человек не сказал, что ищет.
  it("stays put and focuses the field when nothing is filled in", () => {
    url.pathname = "/cabinet/listings";
    url.search = "";

    render(<HeaderSearch cities={CITIES} />);
    submit();

    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field());
  });

  it("prefills the query from /search and follows the address when it changes", () => {
    url.pathname = "/search";
    url.search = "q=дрель&city=spb";

    const { rerender } = render(<HeaderSearch cities={CITIES} />);
    expect(field()).toHaveValue("дрель");

    // Ушли с выдачи — «дрель» в шапке больше не висит.
    url.pathname = "/spb";
    url.search = "";
    rerender(<HeaderSearch cities={CITIES} />);
    expect(field()).toHaveValue("");

    url.pathname = "/search";
    url.search = "q=палатка";
    rerender(<HeaderSearch cities={CITIES} />);
    expect(field()).toHaveValue("палатка");
  });

  it("does not overwrite what is being typed", () => {
    url.pathname = "/search";
    url.search = "q=дрель";

    const { rerender } = render(<HeaderSearch cities={CITIES} />);
    act(() => field().focus());
    fireEvent.change(field(), { target: { value: "перфоратор" } });

    url.search = "q=дрель&sort=price_asc";
    url.pathname = "/spb";
    rerender(<HeaderSearch cities={CITIES} />);
    expect(field()).toHaveValue("перфоратор");
  });

  // Настоящее поле, а не кнопка-сводка: тап сразу ставит фокус и поднимает
  // клавиатуру, панель подсказок открывается под шапкой.
  it("takes the focus right on the tap on phones", () => {
    url.pathname = "/spb";
    url.search = "";

    render(<HeaderSearch cities={CITIES} />);
    act(() => field().focus());

    expect(document.activeElement).toBe(field());
    expect(document.querySelector("[data-suggest-panel]")).not.toBeNull();
  });
});

// На главной поиск шапки не дублирует hero: скрыт, пока поиск hero виден под
// шапкой (IntersectionObserver), и показывается фокусом.
describe("HeaderSearch on the home page", () => {
  type Callback = (entries: { isIntersecting: boolean }[]) => void;
  const observers: { cb: Callback; options?: IntersectionObserverInit; target?: Element }[] = [];

  class FakeObserver {
    private rec: (typeof observers)[number];
    constructor(cb: Callback, options?: IntersectionObserverInit) {
      this.rec = { cb, options };
      observers.push(this.rec);
    }
    observe(target: Element) { this.rec.target = target; }
    disconnect() {}
  }

  const box = () => document.querySelector<HTMLElement>("[data-header-search]")!;
  const heroVisible = (isIntersecting: boolean) => act(() => {
    for (const o of observers) o.cb([{ isIntersecting }]);
  });

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    url.pathname = "/";
    url.search = "";
  });

  function renderHome() {
    return render(
      <>
        <header data-site-header><HeaderSearch cities={CITIES} /></header>
        <main>
          <SearchBar variant="hero" cities={[CITIES[0]]} citySlug="kazan" />
        </main>
      </>,
    );
  }

  it("hides itself while the hero search is on screen, keeping its place", () => {
    renderHome();
    // До ответа наблюдателя (сервер, первый кадр) — только метка: прячет её
    // CSS и лишь при поиске hero на странице, так что без JS и без города
    // поиск шапки работает.
    expect(box()).toHaveAttribute("data-hero-pending");
    expect(box()).not.toHaveAttribute("inert");
    // Наблюдается именно поиск hero, верх — под липкой шапкой.
    expect(observers[0].target).toHaveAttribute("data-hero-search");
    expect(observers[0].options?.rootMargin).toMatch(/^-\d+(\.\d+)?px 0px 0px 0px$/);

    heroVisible(true);
    expect(box()).not.toHaveAttribute("data-hero-pending");
    // Вне касаний, табуляции и дерева доступности, но не выкинут из вёрстки.
    expect(box()).toHaveAttribute("inert");
    expect(box()).toHaveClass("opacity-0", "pointer-events-none");

    // Поиск hero ушёл под шапку — свой поиск виден.
    heroVisible(false);
    expect(box()).not.toHaveAttribute("inert");
    expect(box()).not.toHaveClass("opacity-0");
  });

  // Пока поток был занят, прокрутили туда и обратно: в одном вызове несколько
  // записей, и верна последняя.
  it("follows the latest of batched observer entries", () => {
    renderHome();
    act(() => { for (const o of observers) o.cb([{ isIntersecting: false }, { isIntersecting: true }]); });
    expect(box()).toHaveAttribute("inert");
    act(() => { for (const o of observers) o.cb([{ isIntersecting: true }, { isIntersecting: false }]); });
    expect(box()).not.toHaveAttribute("inert");
  });

  // Ушли с «/», прокрутив ниже hero, и вернулись к его верху: старый ответ
  // «hero не виден» не должен показать поиск шапки поверх hero.
  it("forgets the old observer answer after leaving the home page", () => {
    const { rerender } = renderHome();
    heroVisible(false);
    expect(box()).not.toHaveAttribute("data-hero-pending");

    url.pathname = "/kazan";
    rerender(
      <>
        <header data-site-header><HeaderSearch cities={CITIES} /></header>
        <main><SearchBar variant="hero" cities={[CITIES[0]]} citySlug="kazan" /></main>
      </>,
    );
    expect(box()).not.toHaveAttribute("data-hero-pending");

    url.pathname = "/";
    rerender(
      <>
        <header data-site-header><HeaderSearch cities={CITIES} /></header>
        <main><SearchBar variant="hero" cities={[CITIES[0]]} citySlug="kazan" /></main>
      </>,
    );
    expect(box()).toHaveAttribute("data-hero-pending");
  });

  it("shows itself while it holds the focus", () => {
    renderHome();
    heroVisible(true);
    const input = box().querySelector<HTMLInputElement>("[data-what-input]")!;

    // Программно: inert снимают те, кто отдаёт фокус (поле «Что» hero).
    box().removeAttribute("inert");
    act(() => input.focus());
    expect(document.activeElement).toBe(input);
    expect(box()).not.toHaveAttribute("inert");
    // Пока фокус внутри, ответ наблюдателя его не прячет.
    heroVisible(true);
    expect(box()).not.toHaveAttribute("inert");

    act(() => input.blur());
    expect(box()).toHaveAttribute("inert");
  });

  // Ниже lg поле «Что» hero отдаёт фокус полю шапки: скрытое поле обязано его
  // принять и показаться вместе с панелью подсказок.
  it("takes the focus redirected from the hero field on phones", () => {
    // jsdom inert не знает: как браузер, не даём фокус элементу внутри inert.
    const focus = HTMLElement.prototype.focus;
    const spy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, o) {
      if (!this.closest("[inert]")) focus.call(this, o);
    });
    renderHome();
    heroVisible(true);
    const hero = screen.getByRole("search", { name: content.search.heroLabel })
      .querySelector<HTMLInputElement>("[data-what-input]")!;

    fireEvent.pointerDown(hero);
    act(() => hero.focus());
    spy.mockRestore();

    const header = box().querySelector("[data-what-input]");
    expect(document.activeElement).toBe(header);
    expect(box()).not.toHaveAttribute("inert");
    expect(document.querySelector("[data-suggest-panel]")).not.toBeNull();
  });

  it("is visible on any other page without waiting for the observer", () => {
    url.pathname = "/kazan";
    renderHome();
    expect(box()).not.toHaveAttribute("inert");
    expect(box()).not.toHaveAttribute("data-hero-pending");
    expect(observers).toHaveLength(0);
  });

  it("is visible when there is no hero search on the page", () => {
    render(<HeaderSearch cities={CITIES} />);
    expect(box()).not.toHaveAttribute("inert");
    expect(box()).not.toHaveAttribute("data-hero-pending");
  });

  it("is visible without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    renderHome();
    expect(box()).not.toHaveAttribute("inert");
    expect(box()).not.toHaveAttribute("data-hero-pending");
  });
});
