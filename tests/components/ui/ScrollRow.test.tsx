import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ScrollRow } from "@/components/ui/ScrollRow";

// jsdom раскладки не считает: ширины задаём сами.
function widths(scroll: number, client: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => scroll });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => client });
}

afterEach(() => {
  delete (HTMLElement.prototype as { scrollWidth?: unknown }).scrollWidth;
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
});

describe("ScrollRow", () => {
  // Ширины сервер не знает, а без JS ленту на телефоне должно быть можно листать.
  it("is focusable in the server markup", () => {
    expect(renderToString(<ScrollRow as="ul" aria-label="Лента"><li>1</li></ScrollRow>))
      .toMatch(/^<ul[^>]*tabindex="0"/);
  });

  it("stays a Tab stop while it overflows", () => {
    widths(900, 300);
    render(<ScrollRow as="ol" aria-label="Лента"><li>1</li></ScrollRow>);
    expect(screen.getByRole("list", { name: "Лента" })).toHaveAttribute("tabindex", "0");
  });

  // Развёрнутая сеткой лента прокручиваться не может — лишней остановки Tab нет.
  it("leaves the Tab order when there is nothing to scroll", () => {
    widths(300, 300);
    render(<ScrollRow as="ul" aria-label="Лента"><li>1</li></ScrollRow>);
    expect(screen.getByRole("list", { name: "Лента" })).not.toHaveAttribute("tabindex");
  });
});
