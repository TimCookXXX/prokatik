import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CategoryTree } from "@/components/catalog/CategoryTree";
import type { CategoryNode } from "@/server/catalog";

// Дерево разделов — главный путь по каталогу, и выбранные даты на нём не
// должны теряться: каждая ссылка несёт переносимые параметры выдачи.

type Node = CategoryNode["children"][number];
const cat = (id: string, slug: string, name: string, parentId: string | null, count: number) =>
  ({ id, slug, name, parentId, count }) as Node;

// Девять подкатегорий: восьмая видна, девятая уходит под «Ещё 1».
const children = Array.from({ length: 9 }, (_, i) => cat(`s${i}`, `sub-${i}`, `Подраздел ${i}`, "r1", 1));
const TREE: CategoryNode[] = [
  { ...cat("r1", "instrumenty", "Инструменты", null, 9), children },
  { ...cat("r2", "sport", "Спорт", null, 4), children: [] },
];

const hrefs = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"));

describe("CategoryTree", () => {
  it("на витрине города дописывает carryQuery к каждому разделу", () => {
    render(<CategoryTree tree={TREE} citySlug="kazan" carryQuery="from=2026-09-10&to=2026-09-12" />);
    expect(hrefs()).toEqual([
      "/kazan/instrumenty?from=2026-09-10&to=2026-09-12",
      "/kazan/sport?from=2026-09-10&to=2026-09-12",
    ]);
  });

  it("внутри раздела — к «Все категории», корню и каждой подкатегории, в том числе под «Ещё»", () => {
    render(
      <CategoryTree
        tree={TREE}
        citySlug="kazan"
        activeRootSlug="instrumenty"
        carryQuery="from=2026-09-10&to=2026-09-12"
      />,
    );
    const all = hrefs();
    // «Все категории», корень и девять подкатегорий.
    expect(all).toHaveLength(11);
    for (const href of all) expect(href).toMatch(/\?from=2026-09-10&to=2026-09-12$/);
    expect(all).toContain("/kazan?from=2026-09-10&to=2026-09-12");
    expect(all).toContain("/kazan/instrumenty/sub-8?from=2026-09-10&to=2026-09-12");
  });

  it("без carryQuery ссылки чистые", () => {
    render(<CategoryTree tree={TREE} citySlug="kazan" activeRootSlug="instrumenty" />);
    for (const href of hrefs()) expect(href).not.toContain("?");
  });
});
