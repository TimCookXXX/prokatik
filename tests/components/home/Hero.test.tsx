import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// В hero клиентская панель поиска: она читает адрес хуками и зовёт
// useRouter() при рендере — без мока jsdom падает с «expected app router to be
// mounted» (как в Header.test.tsx).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
}));

import { Hero } from "@/components/home/Hero";
import { content } from "@theme/content";

const KAZAN = { slug: "kazan", name: "Казань", geo: null };

describe("Hero", () => {
  it("keeps a still accessible name for the heading", () => {
    render(<Hero city={KAZAN} />);

    // Слово в скобках меняется каждые пару секунд и скринридеру не отдаётся:
    // доступное имя заголовка обязано быть неподвижным.
    expect(
      screen.getByRole("heading", {
        name: `${content.home.heroLead} ${content.home.heroTitleTail}`,
      }),
    ).toBeInTheDocument();
  });

  // Поиск и есть действие героя: «Каталог» и «Разместить» дублировали шапку
  // и полосу внизу страницы.
  it("has no catalog or place buttons when the city has a search", () => {
    render(<Hero city={KAZAN} />);
    expect(screen.queryByRole("link", { name: content.home.heroCatalog })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Разместить/ })).not.toBeInTheDocument();
  });

  it("sends a lone catalog button to search when there is no active city", () => {
    render(<Hero />);
    expect(screen.getByRole("link", { name: content.home.heroCatalog })).toHaveAttribute("href", "/search");
    // Искать без города негде: подсказки и выдача — городские.
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  // Своё имя ориентира: в шапке тоже есть role="search", и два безымянных
  // «поиска» скринридер не различит.
  it("shows the search panel of its city with its own name and the hero mark", () => {
    render(<Hero city={KAZAN} />);

    const form = screen.getByRole("search", { name: content.search.heroLabel });
    expect(form).toHaveAttribute("action", "/search");
    // По метке шапка на главной прячет свой поиск, пока этот на экране.
    expect(form).toHaveAttribute("data-hero-search");
    expect(form.querySelector('input[type="hidden"][name="city"]')).toHaveValue("kazan");
    expect(screen.getByRole("combobox", { name: content.search.whatLabel })).toHaveAttribute("name", "q");
    expect(screen.getByRole("button", { name: content.nav.search })).toHaveAttribute("type", "submit");
  });

  it("shows every fact as an icon and a title only", () => {
    render(<Hero city={KAZAN} />);
    for (const fact of content.home.heroFacts) {
      const item = screen.getByText(fact.title).closest("li")!;
      expect(item).toHaveTextContent(new RegExp(`^${fact.title}$`));
      expect(item.querySelector("svg")).not.toBeNull();
    }
  });

  it("links popular queries into the search of its city", () => {
    render(<Hero city={KAZAN} popular={["палатка", "сапборд"]} />);
    const nav = screen.getByRole("navigation", { name: content.home.popularLabel });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["палатка", "сапборд"]);
    expect(links[0]).toHaveAttribute("href", `/search?city=kazan&q=${encodeURIComponent("палатка")}`);
  });

  it("hides the popular queries when there are none", () => {
    render(<Hero city={KAZAN} popular={[]} />);
    expect(screen.queryByRole("navigation", { name: content.home.popularLabel })).not.toBeInTheDocument();
  });
});
