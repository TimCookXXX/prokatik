import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CategorySheet } from "@/components/catalog/CategorySheet";

describe("CategorySheet", () => {
  // Шторка живёт ниже md: Modal меряет ширину через matchMedia, в jsdom его нет.
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => ({
      matches: false, addEventListener: () => {}, removeEventListener: () => {},
    }) });
  });
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  // На /search раздел — параметр того же адреса (?category=): дерево страницы
  // переиспользуется, и шторка оставалась открытой поверх новой выдачи.
  it("закрывается по выбору раздела", async () => {
    render(
      <CategorySheet label="Все разделы">
        <ul>
          <li><a href="#tools">Инструменты</a></li>
        </ul>
      </CategorySheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Категория/ }));
    const sheet = screen.getByRole("dialog");

    fireEvent.click(within(sheet).getByRole("link", { name: "Инструменты" }));
    await waitFor(() => expect(sheet).toHaveAttribute("data-state", "closed"));
  });

  it("клик мимо ссылок шторку не закрывает", () => {
    render(
      <CategorySheet label="Все разделы">
        <p>Разделы</p>
      </CategorySheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Категория/ }));
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByText("Разделы"));
    expect(sheet).toHaveAttribute("data-state", "open");
  });
});
