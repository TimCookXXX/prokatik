// Заведение дерева категорий (scripts/seed-categories.ts) на живой базе с
// --owners: только разделы, нужные объявлениям этих владельцев.
import { describe, expect, it } from "vitest";
import { ensureCategories, type SeedDb } from "../../scripts/seed-categories";
import { SEED_CATEGORIES, categoryPath } from "@/lib/seed/categories";
import { slugify } from "@/lib/slugify";

function fakeDb(existing: Array<{ id: string; slug: string; parentId: string | null }>) {
  const inserted: Array<{ slug: string; parentId: string | null }> = [];
  const db = {
    select: () => ({ from: async () => existing }),
    insert: () => ({ values: async (v: { slug: string; parentId: string | null }) => { inserted.push(v); } }),
    update: () => { throw new Error("ensureCategories не обновляет"); },
  } as unknown as SeedDb;
  return { db, inserted };
}

describe("ensureCategories", () => {
  it("с only заводит лишь нужный раздел и его корень, если их нет", async () => {
    const { db, inserted } = fakeDb([]);
    const created: string[] = [];
    const path = categoryPath("Транспорт", "Электровелосипеды");
    const paths = await ensureCategories(db, { only: new Set([path]), onCreate: (p) => created.push(p) });
    expect(inserted.map((r) => r.slug)).toEqual(["transport", "elektrovelosipedy"]);
    expect(created).toEqual(["Транспорт", path]);
    expect([...paths.keys()]).toEqual([path]);
  });

  it("существующий по слагу раздел не создаётся заново — как на проде", async () => {
    const { db, inserted } = fakeDb([
      { id: "T", slug: "transport", parentId: null },
      { id: "E", slug: "elektrovelosipedy", parentId: "T" },
    ]);
    const path = categoryPath("Транспорт", "Электровелосипеды");
    const paths = await ensureCategories(db, { only: new Set([path]) });
    expect(inserted).toEqual([]);
    expect(paths.get(path)).toBe("E");
  });

  it("без only — всё дерево", async () => {
    const { db, inserted } = fakeDb([]);
    await ensureCategories(db, { onCreate: () => {} });
    const total = SEED_CATEGORIES.reduce((n, r) => n + 1 + r.children.length, 0);
    expect(inserted).toHaveLength(total);
    expect(inserted.map((r) => r.slug)).toContain(slugify("Электровелосипеды"));
  });
});
