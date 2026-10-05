import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ResultsToolbar } from "@/components/catalog/ResultsToolbar";

const props = {
  categoryLabel: "Электроинструменты",
  categoryNav: <div>tree</div>,
  filterForm: <form aria-label="filters" />,
  filterCount: 1,
  dates: { resetHref: "/kazan", today: "2026-09-01" },
  sortOptions: [
    { value: "new", label: "Сначала новые", href: "/kazan" },
    { value: "price_asc", label: "Сначала дешевле", href: "/kazan?sort=price_asc" },
  ],
  view: "grid" as const,
  gridHref: "/kazan",
  listHref: "/kazan?view=list",
};

describe("ResultsToolbar", () => {
  // Раньше на телефоне над выдачей стояли три ряда: раздел, фильтры и
  // отдельная панель дат с сортировкой. Теперь — одна лента, по контролу.
  it("держит «Категория · Фильтры (n) · Даты · Сортировка» одним рядом, по одному", () => {
    render(<ResultsToolbar {...props} />);
    const bar = screen.getByRole("group", { name: "Управление выдачей" });
    const button = (name: string | RegExp) => within(bar).getByRole("button", { name });
    expect(within(bar).getAllByRole("button")).toEqual([
      button("Категория: Электроинструменты"),
      button("Фильтры, выбрано: 1"),
      button("Любые даты"),
      button("Сначала новые"),
    ]);
    // Переключатель вида в ряду один — на мобиле он скрыт и живёт в шторке.
    expect(within(bar).getAllByRole("link", { name: "Сеткой" })).toHaveLength(1);
    expect(within(bar).getByRole("link", { name: "Сеткой" }).parentElement).toHaveClass("hidden", "md:flex");
  });

  it("чипы раздела и фильтров — только ниже md", () => {
    render(<ResultsToolbar {...props} />);
    const category = screen.getByRole("button", { name: /^Категория/ });
    expect(category.parentElement).toHaveClass("md:hidden");
    expect(screen.getByRole("button", { name: /^Фильтры/ }).parentElement).toBe(category.parentElement);
  });

  // Все чипы ленты — 44px на телефоне.
  it("чипы ленты высотой 44px на телефоне", () => {
    render(<ResultsToolbar {...props} />);
    for (const b of within(screen.getByRole("group")).getAllByRole("button")) {
      expect(b).toHaveClass("h-11");
    }
  });

  // Лента прилипает под шапкой на телефоне — по её полному следу.
  it("липкая под шапкой ниже md", () => {
    render(<ResultsToolbar {...props} />);
    const bar = screen.getByRole("group");
    expect(bar).toHaveClass("max-md:sticky");
    expect(bar.className).toContain("var(--header-total)");
  });
});
