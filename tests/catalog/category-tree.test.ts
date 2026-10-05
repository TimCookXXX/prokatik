import { describe, it, expect } from "vitest";
import { buildCategoryTree, type Category } from "@/server/catalog";

const cat = (id: string, name: string, parentId: string | null = null): Category => ({
  id, parentId, name, slug: id, vertical: null,
});

const counts = (rows: Record<string, number>) => new Map(Object.entries(rows));

describe("buildCategoryTree()", () => {
  it("корню отдаёт роллап, ребёнку — только его собственные позиции", () => {
    const cats = [
      cat("tools", "Инструменты"),
      cat("power", "Электроинструменты", "tools"),
      cat("hand", "Ручной инструмент", "tools"),
    ];
    const tree = buildCategoryTree(cats, counts({ tools: 5, power: 72, hand: 34 }));

    expect(tree).toHaveLength(1);
    expect(tree[0]!.count).toBe(111); // 5 своих + 72 + 34
    expect(tree[0]!.children.map((c) => [c.slug, c.count])).toEqual([
      ["power", 72], ["hand", 34],
    ]);
  });

  // Пустая подкатегория ведёт на страницу, которая по правилам отдаёт 404, —
  // показывать её в навигации нельзя.
  it("выбрасывает подкатегории без позиций", () => {
    const cats = [
      cat("tools", "Инструменты"),
      cat("power", "Электроинструменты", "tools"),
      cat("empty", "Пустая", "tools"),
    ];
    const tree = buildCategoryTree(cats, counts({ power: 7 }));
    expect(tree[0]!.children.map((c) => c.slug)).toEqual(["power"]);
  });

  it("выбрасывает корень, у которого пусто и у него, и у детей", () => {
    const cats = [
      cat("tools", "Инструменты"),
      cat("power", "Электроинструменты", "tools"),
      cat("clothes", "Одежда"),
      cat("evening", "Вечерняя", "clothes"),
    ];
    const tree = buildCategoryTree(cats, counts({ power: 3 }));
    expect(tree.map((r) => r.slug)).toEqual(["tools"]);
  });

  // Корень живёт и без детей: его страница показывает собственные позиции.
  it("оставляет корень со своими позициями и без подкатегорий", () => {
    const tree = buildCategoryTree([cat("misc", "Разное")], counts({ misc: 2 }));
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toEqual([]);
  });

  // Маршрут /{city}/{seg}/{sub} третьего сегмента не имеет, поэтому внуки в
  // дерево не попадают — ни своей строкой, ни в счётчике ребёнка.
  it("не строит третий уровень", () => {
    const cats = [
      cat("tools", "Инструменты"),
      cat("power", "Электроинструменты", "tools"),
      cat("drills", "Перфораторы", "power"),
    ];
    const tree = buildCategoryTree(cats, counts({ power: 10, drills: 8 }));
    expect(tree[0]!.children.map((c) => c.slug)).toEqual(["power"]);
    expect(tree[0]!.children[0]!.count).toBe(10);
  });

  // С точкой «Где» счётчики — по региону, а страница подкатегории живёт по
  // позициям самого города: ветка, где всё у соседа, в навигацию не попадает.
  it("с региональными счётчиками ведёт только в подкатегории, которые есть у города", () => {
    const cats = [
      cat("tools", "Инструменты"),
      cat("power", "Электроинструменты", "tools"),
      cat("hand", "Ручной инструмент", "tools"),
    ];
    const tree = buildCategoryTree(cats, counts({ power: 9, hand: 4 }), counts({ power: 2 }));
    expect(tree[0]!.count).toBe(13);
    expect(tree[0]!.children.map((c) => [c.slug, c.count])).toEqual([["power", 9]]);
  });

  // Корень — не подкатегория: с точкой «Где» его страница живёт и тогда, когда
  // всё лежит у соседа (200 + noindex, ссылка дерева несёт точку). Поэтому
  // корень по своему городу не отсеивается — отсеиваются только его дети.
  it("с региональными счётчиками оставляет корень, который есть только у соседа", () => {
    const cats = [
      cat("kids", "Детские товары"),
      cat("strollers", "Коляски", "kids"),
    ];
    const tree = buildCategoryTree(cats, counts({ strollers: 2 }), counts({}));
    expect(tree.map((r) => [r.slug, r.count])).toEqual([["kids", 2]]);
    expect(tree[0]!.children).toEqual([]);
  });

  it("пустой вход даёт пустое дерево", () => {
    expect(buildCategoryTree([], new Map())).toEqual([]);
  });
});
