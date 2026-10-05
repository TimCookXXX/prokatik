import { beforeEach, describe, expect, it, vi } from "vitest";

// sitemap.xml: пустой город и его разделы не попадают (витрина живёт с
// noindex), подкатегории — каноническим адресом под корнем.

const krasnodar = { id: "C-KRD", slug: "krasnodar" };
const kazan = { id: "C-KZN", slug: "kazan" };
const tools = { id: "R-TOOLS", slug: "instrumenty", parentId: null };
const drills = { id: "S-DRILL", slug: "dreli", parentId: "R-TOOLS" };
const kids = { id: "R-KIDS", slug: "detskie-tovary", parentId: null };

const catalog = vi.hoisted(() => ({
  getActiveCities: vi.fn(),
  getAllCategories: vi.fn(),
  getListingCountsByCategory: vi.fn(),
  getAllActiveListingPaths: vi.fn(),
  rollupToRoots: (all: Array<{ id: string; parentId: string | null }>, direct: Map<string, number>) => {
    const parentOf = new Map(all.map((c) => [c.id, c.parentId]));
    const out = new Map<string, number>();
    for (const [id, n] of direct) {
      const root = parentOf.get(id) ?? id;
      out.set(root, (out.get(root) ?? 0) + n);
    }
    return out;
  },
}));
vi.mock("@/server/catalog", () => catalog);

const { default: sitemap } = await import("@/app/sitemap");

beforeEach(() => {
  catalog.getActiveCities.mockResolvedValue([kazan, krasnodar]);
  catalog.getAllCategories.mockResolvedValue([kids, tools, drills]);
  // В Казани пусто; в Краснодаре — две дрели.
  catalog.getListingCountsByCategory.mockImplementation(async ([id]: string[]) =>
    new Map(id === krasnodar.id ? [[drills.id, 2]] : []));
  catalog.getAllActiveListingPaths.mockResolvedValue([]);
});

describe("sitemap()", () => {
  it("пропускает город без объявлений вместе с его разделами", async () => {
    const paths = (await sitemap()).map((e) => new URL(e.url).pathname);
    expect(paths).toEqual(["/", "/krasnodar", "/krasnodar/instrumenty", "/krasnodar/instrumenty/dreli"]);
  });

  it("адреса абсолютные, от NEXTAUTH_URL", async () => {
    const base = process.env.NEXTAUTH_URL!.replace(/\/$/, "");
    for (const e of await sitemap()) expect(e.url.startsWith(`${base}/`)).toBe(true);
  });
});
