import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TabBar } from "@/components/layout/TabBar";
import { CityPreferenceProvider } from "@/components/layout/CityPreference";

const AUTH = { nextAuthProviders: ["yandex"], vkEnabled: true, canRegisterByEmail: true };

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(),
}));

const user = { name: "Марина", image: null };
const CITIES = ["kazan"];

// Город таб-бар берёт из адреса, а где его там нет — из выбранного, ровно как
// шапка. Поэтому рендерим внутри провайдера: без него обе стороны экрана
// назвали бы разные города.
function renderTabBar(
  props: Partial<React.ComponentProps<typeof TabBar>> = {},
  // Объектом, а не голым аргументом: явный undefined проваливался бы в дефолт,
  // и «города не выбрано» не проверялось бы вовсе.
  { preferred }: { preferred?: string } = { preferred: "kazan" },
) {
  return render(
    <CityPreferenceProvider initialSlug={preferred}>
      <TabBar
        authProps={AUTH}
        placeHref="/cabinet/listings/new"
        cities={CITIES}
        user={user}
        {...props}
      />
    </CityPreferenceProvider>,
  );
}

describe("TabBar", () => {
  it("renders all five destinations", () => {
    pathname.current = "/";
    renderTabBar();
    for (const label of ["Каталог", "Объявления", "Сдать", "Чаты", "Кабинет"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
    // Каталог — это витрина города, а не пустой /search.
    expect(screen.getByRole("link", { name: /Каталог/ })).toHaveAttribute("href", "/kazan");
  });

  // Раньше вкладка вела в «первый активный город» и после смены города в шапке
  // продолжала звать в старый: таб-бар живёт в корневом layout'е и не
  // перерисовывается. Теперь он читает тот же выбор, что и шапка.
  it("follows the chosen city", () => {
    pathname.current = "/";
    renderTabBar({ cities: ["kazan", "spb"] }, { preferred: "spb" });
    expect(screen.getByRole("link", { name: /Каталог/ })).toHaveAttribute("href", "/spb");
  });

  // Адрес важнее выбора: стоя на витрине чужого города, вкладка ведёт туда же.
  it("prefers the city of the current address", () => {
    pathname.current = "/spb/instrumenty";
    renderTabBar({ cities: ["kazan", "spb"] }, { preferred: "kazan" });
    expect(screen.getByRole("link", { name: /Каталог/ })).toHaveAttribute("href", "/spb");
  });

  it("leads home when no city is active at all", () => {
    pathname.current = "/";
    renderTabBar({ cities: [] }, {});
    expect(screen.getByRole("link", { name: /Каталог/ })).toHaveAttribute("href", "/");
  });

  // У анонима закрытые вкладки открывают вход модалкой. Ссылка остаётся
  // запасным путём (без JS, ctrl-клик) и несёт ?from= — куда вернуть после входа.
  it("sends anonymous visitors to login, remembering where they were heading", () => {
    pathname.current = "/";
    renderTabBar({ placeHref: "/login", user: null });
    expect(screen.getByRole("link", { name: /Кабинет/ })).toHaveAttribute("href", "/login?from=%2Fcabinet");
    expect(screen.getByRole("link", { name: /Чаты/ })).toHaveAttribute("href", "/login?from=%2Fchat");
    expect(screen.getByRole("link", { name: /Объявления/ })).toHaveAttribute("href", "/login?from=%2Fcabinet%2Flistings");
  });

  it("marks the section containing the current path as active", () => {
    pathname.current = "/cabinet/listings/new";
    renderTabBar();
    expect(screen.getByRole("link", { name: /Объявления/ })).toHaveClass("text-primary");
    expect(screen.getByRole("link", { name: /Чаты/ })).toHaveClass("text-muted-foreground");
    // «Объявления» лежат внутри /cabinet — «Кабинет» не должен подсвечиваться заодно.
    expect(screen.getByRole("link", { name: /Кабинет/ })).toHaveClass("text-muted-foreground");
  });

  it("keeps the cabinet tab lit across its subsections", () => {
    for (const path of ["/cabinet", "/cabinet/requests", "/cabinet/calendar", "/profile"]) {
      pathname.current = path;
      const view = renderTabBar();
      expect(screen.getByRole("link", { name: /Кабинет/ }), path).toHaveClass("text-primary");
      view.unmount();
    }
  });

  // Панель вплотную к низу экрана: непрозрачная, во всю ширину, с кантом
  // сверху. Парящая стеклянная пилюля с полями оставляла под собой щель.
  it("sits flush against the bottom edge", () => {
    pathname.current = "/";
    renderTabBar();
    const nav = screen.getByRole("navigation", { name: "Основная навигация" });
    expect(nav).toHaveAttribute("data-tabbar");
    expect(nav).toHaveClass("fixed", "inset-x-0", "bottom-0", "bg-card", "border-t");
    expect(nav.className).not.toMatch(/\bglass\b|\brounded|\bmax-w-/);
    expect(nav.querySelector(".glass")).toBeNull();
  });

  it("lights the catalog tab inside the city and its categories", () => {
    for (const path of ["/kazan", "/kazan/instrumenty", "/kazan/instrumenty/sadovaya-tekhnika"]) {
      pathname.current = path;
      const view = renderTabBar();
      expect(screen.getByRole("link", { name: /Каталог/ }), path).toHaveClass("text-primary");
      view.unmount();
    }
  });
});
