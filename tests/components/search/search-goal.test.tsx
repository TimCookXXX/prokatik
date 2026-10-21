import { fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Цель `search` — отправка панели поиска с любого входа: шапка, hero, экран на
// телефоне. Параметр — что выбрано в «Что», без самого текста. Формы названы,
// чтобы Метрика их различала.
const push = vi.fn();
const replace = vi.fn();
const url = { pathname: "/kazan", search: "" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => url.pathname,
  useSearchParams: () => new URLSearchParams(url.search),
}));
const reachGoal = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/goals", () => ({ reachGoal }));

import { content } from "@theme/content";
import { SearchBar } from "@/components/search/SearchBar";
import { MobileSearchScreen } from "@/components/search/MobileSearchScreen";
import { useSearchPanel } from "@/components/search/use-search-panel";
import { _resetPanelDates } from "@/components/search/panel-dates";
import { _resetSuggestCache } from "@/components/search/suggest-client";
import { _resetSearchQuery } from "@/components/search/search-query";
import { Hero } from "@/components/home/Hero";

const CITIES = [{ slug: "kazan", name: "Казань", geo: null }];
const t = content.search;

beforeEach(() => {
  _resetSearchQuery();
  _resetPanelDates();
  _resetSuggestCache();
  push.mockClear();
  replace.mockClear();
  reachGoal.mockClear();
  url.pathname = "/kazan";
  url.search = "";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ queries: [], categories: [] }) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const searchGoals = () => reachGoal.mock.calls.filter(([name]) => name === "search");

describe("цель search", () => {
  it("шапка: набранный текст — kind text, один раз, до перехода", () => {
    render(<SearchBar variant="header" cities={CITIES} />);
    const form = screen.getByRole("search", { name: t.headerLabel });
    expect(form).toHaveAttribute("name", "search_header");
    fireEvent.change(within(form).getByRole("combobox"), { target: { value: "перфоратор" } });
    push.mockImplementation(() => expect(searchGoals()).toHaveLength(1));
    fireEvent.submit(form);
    expect(push).toHaveBeenCalledTimes(1);
    expect(searchGoals()).toEqual([["search", { kind: "text" }]]);
    push.mockReset();
  });

  it("hero: отправка — та же цель", () => {
    render(<SearchBar variant="hero" cities={CITIES} citySlug="kazan" />);
    const form = screen.getByRole("search", { name: t.heroLabel });
    expect(form).toHaveAttribute("name", "search_hero");
    fireEvent.change(within(form).getByRole("combobox"), { target: { value: "дрель" } });
    fireEvent.submit(form);
    expect(searchGoals()).toEqual([["search", { kind: "text" }]]);
  });

  it("экран поиска на телефоне: отправка и «Часто ищут»", () => {
    render(<><header data-site-header><SearchBar variant="header" cities={CITIES} /></header><MobileSearchScreen cities={CITIES} /></>);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${t.whatLabel}`), hidden: true }));
    const dialog = screen.getByRole("dialog", { name: t.screenLabel });
    const form = dialog.querySelector("form")!;
    expect(form).toHaveAttribute("name", "search_mobile");
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "палатка" } });
    fireEvent.submit(form);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(searchGoals()).toEqual([["search", { kind: "text" }]]);
  });

  it("экран поиска: тот же адрес — экран закрывается, поиском не считается", () => {
    url.pathname = "/search";
    url.search = "q=палатка&city=kazan";
    const { result } = renderHook(() => useSearchPanel(CITIES));
    result.current.submit({ kind: "text", q: "палатка" }, { fromScreen: true });
    expect(replace).not.toHaveBeenCalled();
    expect(searchGoals()).toEqual([]);
    // Другой запрос с того же экрана — переход и цель.
    result.current.submit({ kind: "text", q: "спальник" }, { fromScreen: true });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(searchGoals()).toEqual([["search", { kind: "text" }]]);
  });

  // Одни и те же «Часто ищут» на главной и на экране поиска телефона — одна и
  // та же цель: иначе верх воронки зависел бы от набора чипов.
  it("«Часто ищут» на главной и на экране телефона — одна цель с одним kind", () => {
    const { unmount } = render(<Hero city={CITIES[0]} popular={["перфоратор"]} />);
    const chip = screen.getByRole("link", { name: "перфоратор" });
    // Без роутера Next ссылка ушла бы настоящим переходом, которого в jsdom нет.
    chip.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(chip);
    expect(searchGoals()).toEqual([["search", { kind: "text" }]]);
    unmount();
    reachGoal.mockClear();

    render(<><header data-site-header><SearchBar variant="header" cities={CITIES} /></header><MobileSearchScreen cities={CITIES} /></>);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${t.whatLabel}`), hidden: true }));
    const dialog = screen.getByRole("dialog", { name: t.screenLabel });
    fireEvent.click(within(dialog).getByRole("link", { name: content.home.popularQueries[0] }));
    expect(searchGoals()).toEqual([["search", { kind: "text" }]]);
  });

  it("пустая отправка, которой некуда вести, — без цели", () => {
    url.pathname = "/cabinet";
    render(<SearchBar variant="header" cities={CITIES} />);
    fireEvent.submit(screen.getByRole("search"));
    expect(push).not.toHaveBeenCalled();
    expect(searchGoals()).toEqual([]);
  });

  it("подсказка-запрос и раздел — свои kind, без адреса и текста", () => {
    const { result } = renderHook(() => useSearchPanel(CITIES));
    result.current.submit({ kind: "query", href: "/search?q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C&city=kazan" });
    result.current.submit({ kind: "category", href: "/kazan/instrumenty" });
    expect(searchGoals()).toEqual([["search", { kind: "query" }], ["search", { kind: "category" }]]);
    expect(JSON.stringify(reachGoal.mock.calls)).not.toMatch(/kazan|instrumenty|%D0/);
  });
});
