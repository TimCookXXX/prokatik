import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
// Header renders HeaderSearch and CitySelector: both read the URL with client
// hooks, and useRouter() is called at render — without mocks jsdom throws
// "invariant expected app router to be mounted".
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(""),
}));
// City row is untyped in the mock: only slug/name are read; no need to satisfy the
// full City type (real rows have more columns).
const activeCities = vi.hoisted(() => ({
  current: [{ id: "1", slug: "msk", name: "Москва" }] as { id: string; slug: string; name: string }[],
}));
vi.mock("@/server/catalog", () => ({
  getActiveCities: vi.fn(async () => activeCities.current),
}));
// The geo context of the search panel comes from geo_imports, not from the
// engine. By default no city has geodata, so «Где» is not rendered.
const citiesGeo = vi.hoisted(() => ({ current: new Map<string, unknown>() }));
vi.mock("@/server/city", () => ({
  getCitiesGeo: vi.fn(async () => citiesGeo.current),
}));

// Экшен выбора города ходит в куки и в базу — в jsdom его не поднять.
vi.mock("@/server/actions/city", () => ({ setCityPreference: vi.fn() }));

import { content } from "@theme/content";
import { Header } from "@/components/layout/Header";
import { CityPreferenceProvider } from "@/components/layout/CityPreference";

describe("Header", () => {
  it("renders search, city selector, place CTA and login for anon", async () => {
    // Внутри провайдера, как в корневом layout'е: без него шапка не знала бы
    // города на страницах, где его нет в адресе.
    render(<CityPreferenceProvider initialSlug="msk">{await Header()}</CityPreferenceProvider>);
    // Одна форма поиска на всю шапку: телефон и десктоп отличаются классами,
    // а не второй копией в DOM.
    expect(screen.getAllByRole("search")).toHaveLength(1);
    expect(screen.getByRole("search", { name: content.search.headerLabel })).toBeInTheDocument();
    // Именно название города, а не заглушка «Город»: на «/» города в адресе
    // нет, и раньше здесь стояло слово «Город» над выдачей конкретного города.
    expect(screen.getByRole("button", { name: /Москва/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Разместить/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Войти/ })).toBeInTheDocument();
  });

  // Знак — не то, чем платят за селектор. Пока город один, выбирать в нём
  // нечего, и на телефоне он молчит; с двумя городами появляется, а место ему
  // уступает название города, которое режется по ширине.
  it("keeps the wordmark and hides the lone city selector on phones", async () => {
    activeCities.current = [{ id: "1", slug: "msk", name: "Москва" }];
    render(<CityPreferenceProvider initialSlug="msk">{await Header()}</CityPreferenceProvider>);

    expect(screen.getByText("inrenta")).toBeInTheDocument();
    // Обёртка селектора, а не разделитель рядом: тот тоже hidden md:block.
    const wrapper = screen.getByRole("button", { name: /Москва/ }).parentElement;
    expect(wrapper?.className).toContain("hidden");
    expect(wrapper?.className).toContain("md:block");
  });

  it("shows the city selector on phones once there is a choice", async () => {
    activeCities.current = [
      { id: "1", slug: "msk", name: "Москва" },
      { id: "2", slug: "spb", name: "Санкт-Петербург" },
    ];
    render(<CityPreferenceProvider initialSlug="msk">{await Header()}</CityPreferenceProvider>);

    const wrapper = screen.getByRole("button", { name: /Москва/ }).parentElement;
    expect(wrapper?.className).not.toContain("hidden");
  });
});

describe("Header search", () => {
  // Город шапка узнаёт на клиенте, поэтому панели нужен список активных: город
  // из адреса уходит скрытым полем и в отправку без JS.
  it("hands the active cities to the search panel", async () => {
    activeCities.current = [
      { id: "1", slug: "msk", name: "Москва" },
      { id: "2", slug: "spb", name: "Санкт-Петербург" },
    ];
    render(<CityPreferenceProvider initialSlug="spb">{await Header()}</CityPreferenceProvider>);

    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("action", "/search");
    expect(form.querySelector('input[type="hidden"][name="city"]')).toHaveValue("spb");
  });

  // Город шапка узнаёт на клиенте и при переходе не перерисовывается
  // сервером: «Где» и его мини-индекс обязаны следовать за городом адреса.
  it("follows the city of the address: «Где» only where the city has geodata", async () => {
    activeCities.current = [
      { id: "1", slug: "krasnodar", name: "Краснодар" },
      { id: "2", slug: "kazan", name: "Казань" },
    ];
    citiesGeo.current = new Map([
      ["krasnodar", { region: "krasnodar", centre: { lat: 45.035, lon: 38.975 }, token: "krasnodar:v1" }],
    ]);
    const whereField = () => document.getElementById("where-header-input");
    try {
      nav.pathname = "/krasnodar";
      const header = await Header();
      const { rerender } = render(<CityPreferenceProvider initialSlug="kazan">{header}</CityPreferenceProvider>);
      expect(whereField()).toBeInTheDocument();

      nav.pathname = "/kazan/instrumenty";
      rerender(<CityPreferenceProvider initialSlug="kazan">{header}</CityPreferenceProvider>);
      expect(whereField()).toBeNull();

      nav.pathname = "/krasnodar/instrumenty";
      rerender(<CityPreferenceProvider initialSlug="kazan">{header}</CityPreferenceProvider>);
      expect(whereField()).toBeInTheDocument();
    } finally {
      nav.pathname = "/";
      citiesGeo.current = new Map();
    }
  });
});
