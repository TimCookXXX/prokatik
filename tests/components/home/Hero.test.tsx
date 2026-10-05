import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// В hero теперь клиентская панель поиска: она читает адрес хуками и зовёт
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
  it("keeps a still accessible name for the heading and links the catalog into the city", () => {
    render(<Hero city={KAZAN} placeHref="/cabinet/listings/new" />);

    // Слово в скобках меняется каждые пару секунд и скринридеру не отдаётся:
    // доступное имя заголовка обязано быть неподвижным.
    expect(
      screen.getByRole("heading", {
        name: `${content.home.heroLead} ${content.home.heroTitleTail}`,
      }),
    ).toBeInTheDocument();

    expect(screen.getByRole("link", { name: content.home.heroCatalog })).toHaveAttribute(
      "href",
      "/kazan",
    );
    expect(screen.getByRole("link", { name: content.home.heroPlace })).toHaveAttribute(
      "href",
      "/cabinet/listings/new",
    );
  });

  it("sends the catalog button to search when there is no active city", () => {
    render(<Hero placeHref="/login" />);
    expect(screen.getByRole("link", { name: content.home.heroCatalog })).toHaveAttribute(
      "href",
      "/search",
    );
    // Искать без города негде: подсказки и выдача — городские.
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  // Своё имя ориентира: в шапке тоже есть role="search", и два безымянных
  // «поиска» скринридер не различит.
  it("shows the search panel of its city with its own name", () => {
    render(<Hero city={KAZAN} placeHref="/login" />);

    const form = screen.getByRole("search", { name: content.search.heroLabel });
    expect(form).toHaveAttribute("action", "/search");
    expect(form.querySelector('input[type="hidden"][name="city"]')).toHaveValue("kazan");
    expect(screen.getByRole("combobox", { name: content.search.whatLabel })).toHaveAttribute("name", "q");
    expect(screen.getByRole("button", { name: content.nav.search })).toHaveAttribute("type", "submit");
  });

  it("sends an anonymous visitor to the login route with the place page to return to", () => {
    // Ветка с LoginTrigger идёт через Radix Slot: тот прокидывает className
    // кнопки в чужой компонент, и молча потерять весь вид тут проще всего.
    render(
      <Hero
        city={KAZAN}
        placeHref="/login"
        authProps={{ nextAuthProviders: [], vkEnabled: false, canRegisterByEmail: false }}
      />,
    );
    const place = screen.getByRole("link", { name: content.home.heroPlace });
    expect(place).toHaveAttribute("href", "/login?from=%2Fcabinet%2Flistings%2Fnew");
    expect(place).toHaveClass("bg-transparent");
  });

  it("shows every info tile", () => {
    render(<Hero city={KAZAN} placeHref="/login" />);
    for (const fact of content.home.heroFacts) {
      expect(screen.getByText(fact.title)).toBeInTheDocument();
    }
  });
});
