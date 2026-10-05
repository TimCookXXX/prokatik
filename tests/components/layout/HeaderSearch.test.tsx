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
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [], categories: [] }) })));
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
