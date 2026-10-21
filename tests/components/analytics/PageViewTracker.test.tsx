// Просмотр страницы для своей статистики: правило pageViewKey (как у хитов
// Метрики), вход только у первого просмотра загрузки документа.
import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const track = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/track", () => ({
  track,
  currentPath: () => `${window.location.pathname}${window.location.search}`,
}));

import { PageViewTracker } from "@/components/analytics/PageViewTracker";

function go(path: string) {
  const [pathname, search = ""] = path.split("?");
  nav.pathname = pathname;
  nav.search = search;
  window.history.replaceState(null, "", path);
}

beforeEach(() => {
  track.mockClear();
  go("/");
});
afterEach(() => {
  Object.defineProperty(document, "referrer", { value: "", configurable: true });
});

describe("<PageViewTracker>", () => {
  it("первый просмотр — со входом: адрес с метками и referrer; StrictMode не удваивает", () => {
    go("/krasnodar?utm_source=tg");
    Object.defineProperty(document, "referrer", { value: "https://t.me/x", configurable: true });
    render(<StrictMode><PageViewTracker /></StrictMode>);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("pageview", {
      path: "/krasnodar?utm_source=tg", doc: true, ref: "https://t.me/x",
    });
  });

  it("без referrer'а поля ref нет", () => {
    render(<PageViewTracker />);
    expect(track).toHaveBeenCalledWith("pageview", { path: "/", doc: true });
  });

  it("клиентский переход — просмотр без входа", () => {
    const { rerender } = render(<PageViewTracker />);
    go("/krasnodar/instrumenty");
    rerender(<PageViewTracker />);
    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenLastCalledWith("pageview", { path: "/krasnodar/instrumenty" });
  });

  // Правило то же, что у хитов Метрики: правка на месте — не просмотр.
  it("сортировка и фильтры — тот же просмотр, новая страница выдачи и запрос — новый", () => {
    go("/search?q=a&city=krasnodar");
    const { rerender } = render(<PageViewTracker />);
    go("/search?q=a&city=krasnodar&sort=new&price_max=100");
    rerender(<PageViewTracker />);
    expect(track).toHaveBeenCalledTimes(1);
    go("/search?q=a&city=krasnodar&page=2");
    rerender(<PageViewTracker />);
    go("/search?q=b&city=krasnodar");
    rerender(<PageViewTracker />);
    expect(track).toHaveBeenCalledTimes(3);
  });
});
