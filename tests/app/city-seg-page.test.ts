import { beforeEach, describe, expect, it, vi } from "vitest";

// /{city}/{seg}: корневой раздел и подкатегория по прямому слагу.
//
// Корень, пустой в самом городе, — 404 (без стриминга это настоящий код
// ответа). Исключение — действующая точка «Где» и ненулевая выдача по региону:
// подсказки разделов и дерево с точкой ведут и туда, страница живёт с noindex.

const krasnodar = { id: "C-KRD", slug: "krasnodar", name: "Краснодар", nameLocative: "Краснодаре" };
const yablonovskiy = { id: "C-YAB", slug: "yablonovskiy", name: "Яблоновский", nameLocative: "Яблоновском" };
const kids = { id: "R-KIDS", slug: "detskie-tovary", parentId: null, name: "Детские товары" };
const strollers = { id: "S-STROLL", slug: "kolyaski", parentId: "R-KIDS", name: "Коляски" };
const tools = { id: "R-TOOLS", slug: "instrumenty", parentId: null, name: "Инструменты" };
const cats = [kids, strollers, tools];

const catalog = vi.hoisted(() => ({
  getCityBySlug: vi.fn(),
  getCategoryBySlug: vi.fn(),
  getAllCategories: vi.fn(),
  getListingCountsByCategory: vi.fn(),
  getCategoryStats: vi.fn(),
  // Настоящий роллап: он чистый, а именно по нему решается «пусто ли».
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
const city = vi.hoisted(() => ({ getCityScope: vi.fn() }));

vi.mock("@/server/catalog", () => catalog);
vi.mock("@/server/city", () => city);
vi.mock("@/components/catalog/CategoryListing", () => ({ CategoryListing: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (href: string) => { throw new Error(`REDIRECT ${href}`); },
}));

const { default: CitySegPage, generateMetadata } = await import("@/app/(public)/[city]/[seg]/page");

const POINT = "p:44.990,39.000";
const props = (seg: string, sp: Record<string, string> = {}) => ({
  params: Promise.resolve({ city: "krasnodar", seg }),
  searchParams: Promise.resolve(sp),
});

/** Страница корня отдаёт элемент RootCategoryPage — рендерим его как функцию. */
async function render(seg: string, sp: Record<string, string> = {}) {
  const el = await CitySegPage(props(seg, sp));
  const Root = el.type as (p: unknown) => Promise<unknown>;
  return Root(el.props);
}

const noPoint = { region: true, near: null, cityIds: [krasnodar.id], nearby: false };
const withPoint = {
  region: true, nearby: true, cityIds: [krasnodar.id, yablonovskiy.id],
  near: { point: { lat: 44.99, lon: 39 }, label: null, source: "address", precision: "house" },
};

beforeEach(() => {
  catalog.getCityBySlug.mockImplementation(async (slug: string) => (slug === "krasnodar" ? krasnodar : null));
  catalog.getCategoryBySlug.mockImplementation(async (slug: string) => cats.find((c) => c.slug === slug) ?? null);
  catalog.getAllCategories.mockResolvedValue(cats);
  // Инструменты есть в Краснодаре, коляски — только в Яблоновском.
  catalog.getListingCountsByCategory.mockImplementation(async (ids: string[]) => {
    const m = new Map<string, number>();
    if (ids.includes(krasnodar.id)) m.set(tools.id, 4);
    if (ids.includes(yablonovskiy.id)) m.set(strollers.id, 2);
    return m;
  });
  city.getCityScope.mockImplementation(async (_c: unknown, sp: { loc?: string }) => (sp.loc ? withPoint : noPoint));
  catalog.getCategoryStats.mockResolvedValue({
    listingCount: 4, ownerCount: 2, minPriceDay: 700, maxPriceDay: 1500, avgDeposit: null,
  });
});

describe("/{city}/{root} пустой в городе", () => {
  it("без точки «Где» — 404", async () => {
    await expect(render("detskie-tovary")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("с точкой и выдачей по региону — 200 и noindex", async () => {
    await expect(render("detskie-tovary", { loc: POINT })).resolves.toBeTruthy();
    expect(catalog.getListingCountsByCategory).toHaveBeenCalledWith(withPoint.cityIds);
    const meta = await generateMetadata(props("detskie-tovary", { loc: POINT }));
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(String(meta.alternates?.canonical)).toMatch(/\/krasnodar\/detskie-tovary$/);
  });

  it("с точкой, но пусто и по региону — всё равно 404", async () => {
    catalog.getListingCountsByCategory.mockImplementation(async (ids: string[]) =>
      new Map(ids.includes(krasnodar.id) ? [[tools.id, 4]] : []));
    await expect(render("detskie-tovary", { loc: POINT })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("точка в городе без геоданных не действует — 404", async () => {
    city.getCityScope.mockResolvedValue({ region: false, near: null, cityIds: [krasnodar.id], nearby: false });
    await expect(render("detskie-tovary", { loc: POINT })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("/{city}/{root} с объявлениями в городе", () => {
  it("рендерится, в метаданных нет robots", async () => {
    await expect(render("instrumenty")).resolves.toBeTruthy();
    const meta = await generateMetadata(props("instrumenty"));
    expect(meta.robots).toBeUndefined();
    expect(String(meta.alternates?.canonical)).toMatch(/^https?:\/\/[^/]+\/krasnodar\/instrumenty$/);
  });
});

describe("/{city}/{sub} — подкатегория по прямому слагу", () => {
  it("308 на /{city}/{root}/{sub} с переносимым query", async () => {
    await expect(CitySegPage(props("kolyaski", { from: "2026-10-10", utm_source: "x" })))
      .rejects.toThrow("REDIRECT /krasnodar/detskie-tovary/kolyaski?from=2026-10-10");
  });

  it("canonical — тоже на канонический адрес, не на себя", async () => {
    const meta = await generateMetadata(props("kolyaski"));
    expect(String(meta.alternates?.canonical)).toMatch(/\/krasnodar\/detskie-tovary\/kolyaski$/);
    expect(meta.robots).toBeUndefined();
  });
});

// Заголовок и описание — из src/lib/seo/titles.ts, цена «от» и счётчики — по
// самому городу и по разделу вместе с подразделами, как его выдача.
describe("заголовки раздела", () => {
  it("title без шаблона сайта, с ценой «от»; описание из данных", async () => {
    const meta = await generateMetadata(props("detskie-tovary"));
    // Цены форматируются с неразрывными пробелами; сравнение — по обычным.
    const plain = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/\u00a0/g, " "));
    expect(plain(meta.title)).toEqual({ absolute: "Детские товары — аренда и прокат в Краснодаре, от 700 ₽/сутки" });
    expect(plain(meta.description)).toBe(
      "4 позиции, 2 продавца: детские товары напрокат в Краснодаре, от 700 ₽ до 1 500 ₽/сутки. Залог, даты и заявка на бронь онлайн.",
    );
    expect(catalog.getCategoryStats).toHaveBeenCalledWith([krasnodar.id], [kids.id, strollers.id]);
  });

  it("H1 — «{Раздел} — аренда и прокат {в городе}»", async () => {
    const tree = await render("instrumenty") as { props: { children: unknown[] } };
    const h1 = tree.props.children.find((c) => (c as { type?: unknown })?.type === "h1") as { props: { children: unknown } };
    expect(h1.props.children).toBe("Инструменты — аренда и прокат в Краснодаре");
  });
});
