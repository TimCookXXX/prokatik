import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
const url = { pathname: "/", search: "" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => url.pathname,
  useSearchParams: () => new URLSearchParams(url.search),
}));

import { content } from "@theme/content";
import { HeaderSearch } from "@/components/layout/HeaderSearch";
import { SearchBar } from "@/components/search/SearchBar";
import { MobileSearchScreen } from "@/components/search/MobileSearchScreen";
import { _resetSuggestCache } from "@/components/search/suggest-client";
import { _resetSearchQuery } from "@/components/search/search-query";

const CITIES = [
  { slug: "kazan", name: "Казань", geo: null },
  { slug: "spb", name: "Санкт-Петербург", geo: null },
];

const field = () => screen.getAllByRole("combobox")[0];

const submit = (query?: string) => {
  if (query !== undefined) {
    fireEvent.change(field(), { target: { value: query } });
  }
  fireEvent.submit(screen.getByRole("search"));
};

beforeEach(() => {
  _resetSearchQuery();
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

  // Поле, ушедшее из DOM в фокусе («назад» с главной), blur не присылает —
  // шапка всё равно снова следует за адресом.
  it("follows the address again after a focused field unmounts", () => {
    url.pathname = "/";
    url.search = "";
    const { rerender } = render(
      <><HeaderSearch cities={CITIES} /><SearchBar variant="hero" cities={[CITIES[0]]} citySlug="kazan" /></>,
    );
    const hero = screen.getAllByRole("combobox")[1];
    act(() => hero.focus());
    fireEvent.change(hero, { target: { value: "палатка" } });

    url.pathname = "/search";
    url.search = "q=дрель";
    rerender(<HeaderSearch cities={CITIES} />);
    expect(field()).toHaveValue("дрель");
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

  // Десктоп не меняется: форма в разметке всегда, ниже lg её прячет CSS, а
  // место занимает кнопка экрана поиска. Без JS-ветки — сервер ширины не знает.
  it("renders both the form and the phone trigger, switched by CSS only", () => {
    url.pathname = "/spb";
    url.search = "";

    render(<HeaderSearch cities={CITIES} />);
    const form = screen.getByRole("search", { name: content.search.headerLabel });
    expect(form).toHaveClass("hidden", "lg:flex");
    expect(form.querySelector("[data-what-input]")).not.toBeNull();
    const trigger = screen.getByRole("button", { name: content.search.whatLabel });
    expect(trigger).toHaveClass("lg:hidden");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  });

  // Тап по кнопке-полю открывает экран поиска и сразу ставит фокус в его поле
  // (iOS поднимает клавиатуру только так); текст — тот же, что в шапке.
  it("opens the search screen from the trigger with the focus in its field", () => {
    url.pathname = "/search";
    url.search = "q=дрель&city=spb";

    render(<><HeaderSearch cities={CITIES} /><MobileSearchScreen cities={CITIES} /></>);
    const trigger = screen.getByRole("button", { name: `${content.search.whatLabel}: дрель` });
    expect(trigger).toHaveTextContent("дрель");
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: content.search.screenLabel });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const input = within(dialog).getByRole("combobox");
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue("дрель");
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

    // Фокус пришёл, пока поиск был виден, а потом hero вернулся на экран.
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

  // Ниже lg hero и шапка открывают один и тот же экран; скрытый (inert)
  // поиск шапки при этом не трогается — экран живёт вне его обёртки.
  it("opens the same search screen from the hero, outside the hidden header search", () => {
    render(
      <>
        <header data-site-header><HeaderSearch cities={CITIES} /></header>
        <main><SearchBar variant="hero" cities={[CITIES[0]]} citySlug="kazan" /></main>
        <MobileSearchScreen cities={CITIES} />
      </>,
    );
    heroVisible(true);
    const hero = screen.getByRole("search", { name: content.search.heroLabel });
    fireEvent.click(within(hero).getByRole("button", { name: content.search.whatLabel }));

    const dialog = screen.getByRole("dialog", { name: content.search.screenLabel });
    expect(box()).not.toContainElement(dialog);
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: "палатка" } });
    // Текст общий: его видят и триггер hero, и триггер шапки.
    expect(screen.getAllByRole("button", { name: `${content.search.whatLabel}: палатка`, hidden: true })).toHaveLength(2);
    expect(box()).toHaveAttribute("inert");
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
