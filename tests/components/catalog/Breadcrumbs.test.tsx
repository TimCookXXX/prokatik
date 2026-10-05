import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";

const items = [
  { label: "Главная", href: "/" },
  { label: "Краснодар", href: "/krasnodar" },
  { label: "Инструменты", href: "/krasnodar/instrumenty" },
  { label: "Перфоратор Makita" },
];

describe("Breadcrumbs", () => {
  // На телефоне цепочка занимала две строки над заголовком; там остаётся
  // один шаг вверх — к ближайшему звену со ссылкой.
  it("на мобиле — одна ссылка на раздел выше", () => {
    render(<Breadcrumbs items={items} />);
    const up = screen.getByRole("link", { name: "На уровень выше: Инструменты" });
    expect(up).toHaveAttribute("href", "/krasnodar/instrumenty");
    expect(up).toHaveClass("md:hidden", "min-h-11");
    expect(up).toHaveTextContent(/^Инструменты$/);
  });

  // «Назад» звучит как история браузера, а ссылка ведёт по иерархии. Видимая
  // подпись входит в имя: голосовой ввод находит ссылку по тому, что на ней
  // написано (WCAG 2.5.3).
  it("имя шага вверх — по иерархии и содержит видимую подпись", () => {
    render(<Breadcrumbs items={items} />);
    const up = screen.getAllByRole("link").find((a) => a.classList.contains("md:hidden"))!;
    const name = up.getAttribute("aria-label")!;
    expect(name).not.toMatch(/назад/i);
    expect(name).toContain(up.textContent!);
  });

  it("с md — вся цепочка, текущая страница без ссылки", () => {
    render(<Breadcrumbs items={items} />);
    const list = screen.getByRole("list");
    expect(list).toHaveClass("hidden", "md:flex");
    expect(within(list).getAllByRole("link").map((a) => a.textContent)).toEqual(["Главная", "Краснодар", "Инструменты"]);
    expect(within(list).getByText("Перфоратор Makita").tagName).toBe("SPAN");
  });

  it("без звеньев со ссылкой шагать вверх некуда", () => {
    render(<Breadcrumbs items={[{ label: "Главная" }]} />);
    expect(screen.queryByRole("link", { name: /^На уровень выше/ })).toBeNull();
  });
});
