import { beforeEach, describe, expect, it, vi } from "vitest";

// /{city}/{seg}/{sub}: карточка товара и подкатегория.
//
// Город вещи задаёт её адрес: новый адрес переносит объявление в другой город
// региона, и старая ссылка под прежним городом должна уводить на настоящий, а
// не отдавать 404.

const krasnodar = { id: "C-KRD", slug: "krasnodar", name: "Краснодар", nameLocative: "Краснодаре" };
const yablonovskiy = { id: "C-YAB", slug: "yablonovskiy", name: "Яблоновский", nameLocative: "Яблоновском" };
const cities = [krasnodar, yablonovskiy];
const LISTING_ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";

const catalog = vi.hoisted(() => ({
  getCityBySlug: vi.fn(),
  getCityById: vi.fn(),
  getActiveListingById: vi.fn(),
  getCategoryById: vi.fn(),
  getSellerById: vi.fn(),
  getCategoryBySlug: vi.fn(),
  getAllCategories: vi.fn(),
  getListingCountsByCategory: vi.fn(),
  getCategoryStats: vi.fn(),
  listingPhotos: vi.fn((): Array<{ url: string; width: number; height: number }> => []),
  getAvailabilityRows: vi.fn(async () => []),
  getActiveListingCardsByOwner: vi.fn(async () => []),
  getListingsForCategories: vi.fn(async (): Promise<{ items: unknown[]; total: number }> => ({ items: [], total: 0 })),
  getListingDistance: vi.fn(),
}));
const city = vi.hoisted(() => ({ getCityScope: vi.fn() }));

vi.mock("@/server/catalog", () => catalog);
vi.mock("@/server/city", () => city);
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/auth/panel-props", () => ({ authPanelProps: () => ({}) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ insert: () => ({ values: async () => {} }) }) }));
vi.mock("@/server/booking", () => ({ getUserPhone: vi.fn() }));
vi.mock("@/server/chat", () => ({ findThreadByListing: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (href: string) => { throw new Error(`REDIRECT ${href}`); },
}));

const { default: CitySubPage, generateMetadata } = await import("@/app/(public)/[city]/[seg]/[sub]/page");

const props = (city: string, sp: Record<string, string> = {}) => ({
  params: Promise.resolve({ city, seg: "tools", sub: `drill-${LISTING_ID}` }),
  searchParams: Promise.resolve(sp),
});

beforeEach(() => {
  catalog.getCityBySlug.mockImplementation(async (slug: string) => cities.find((c) => c.slug === slug) ?? null);
  catalog.getCityById.mockImplementation(async (id: string) => cities.find((c) => c.id === id) ?? null);
  catalog.getActiveListingById.mockResolvedValue({
    id: LISTING_ID, slug: "drill", title: "Дрель", cityId: krasnodar.id, categoryId: "K1",
    ownerUserId: "U1", status: "active", priceDay: 500, description: null,
  });
  catalog.getCategoryById.mockResolvedValue({ id: "K1", slug: "tools", parentId: null, name: "Инструменты" });
  catalog.getSellerById.mockResolvedValue({ id: "U1", name: "Полина", bannedAt: null });
});

describe("/{city}/{cat}/{slug}-{id} under a former city", () => {
  it("redirects to the listing's own city and keeps the carried query", async () => {
    await expect(CitySubPage(props("yablonovskiy", { from: "2026-10-10", loc: "p:45.035,38.975", utm: "x" })))
      .rejects.toThrow(`REDIRECT /krasnodar/tools/drill-${LISTING_ID}?from=2026-10-10&loc=p%3A45.035%2C38.975`);
  });

  it("puts the real city into canonical instead of answering 404", async () => {
    const meta = await generateMetadata(props("yablonovskiy"));
    expect(String(meta.alternates?.canonical)).toMatch(new RegExp(`/krasnodar/tools/drill-${LISTING_ID}$`));
  });

  it("is still 404 when the listing's city is not active", async () => {
    catalog.getCityById.mockResolvedValue(null);
    catalog.getActiveListingById.mockResolvedValue({
      id: LISTING_ID, slug: "drill", title: "Дрель", cityId: "C-OFF", categoryId: "K1",
      ownerUserId: "U1", status: "active", priceDay: 500, description: null,
    });
    await expect(CitySubPage(props("yablonovskiy"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

// С точкой «Где» выдача идёт по региону, но страница подкатегории живёт по
// позициям самого города: иначе с точкой она есть, а её canonical — 404.
describe("/{city}/{root}/{sub} with a «Где» point", () => {
  beforeEach(() => {
    catalog.getCategoryBySlug.mockResolvedValue({ id: "K1", slug: "tools", parentId: null, name: "Инструменты" });
    catalog.getAllCategories.mockResolvedValue([
      { id: "K1", slug: "tools", parentId: null, name: "Инструменты" },
      { id: "K2", slug: "drills", parentId: "K1", name: "Дрели" },
    ]);
    city.getCityScope.mockResolvedValue({
      region: true, nearby: true, cityIds: [krasnodar.id, yablonovskiy.id],
      near: { point: { lat: 45, lon: 39 }, label: null, source: "address", precision: "house" },
    });
    // Дрели есть только в Яблоновском.
    catalog.getListingCountsByCategory.mockImplementation(async (ids: string[]) =>
      new Map(ids.includes(yablonovskiy.id) ? [["K2", 3]] : []));
  });

  const subProps = { params: Promise.resolve({ city: "krasnodar", seg: "tools", sub: "drills" }),
    searchParams: Promise.resolve({ loc: "p:45.000,39.000" }) };

  it("title подкатегории — по самому городу, без цены, когда позиций нет", async () => {
    catalog.getCategoryStats.mockResolvedValue({
      listingCount: 0, ownerCount: 0, minPriceDay: null, maxPriceDay: null, avgDeposit: null,
    });
    const meta = await generateMetadata(subProps);
    expect(meta.title).toEqual({ absolute: "Дрели — аренда и прокат в Краснодаре" });
    expect(catalog.getCategoryStats).toHaveBeenCalledWith([krasnodar.id], ["K2"]);
    expect(String(meta.alternates?.canonical)).toMatch(/\/krasnodar\/tools\/drills$/);
  });

  it("is 404 when the subcategory is empty in the city itself", async () => {
    const el = await CitySubPage(subProps);
    const Sub = el.type as (p: unknown) => Promise<unknown>;
    await expect(Sub(el.props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(catalog.getListingCountsByCategory).toHaveBeenCalledWith([krasnodar.id]);
  });
});

// Вещь в подкатегории: крошки, BreadcrumbList и «Ещё в категории» ведут на
// канонический /{city}/{root}/{sub}, а не на прямой /{city}/{sub} (тот лишь
// редиректит). Корень — отдельной крошкой.
describe("listing in a subcategory", () => {
  const root = { id: "K1", slug: "foto-i-video", parentId: null, name: "Фото и видео" };
  const sub = { id: "K2", slug: "ekshn-kamery", parentId: "K1", name: "Экшн-камеры" };

  beforeEach(() => {
    city.getCityScope.mockResolvedValue({ region: false, near: null, cityIds: [krasnodar.id], nearby: false });
    catalog.getActiveListingById.mockResolvedValue({
      id: LISTING_ID, slug: "gopro", title: "GoPro", cityId: krasnodar.id, categoryId: "K2",
      ownerUserId: "U1", status: "active", priceDay: 700, description: null, quantity: 1,
      depositType: "none", depositAmount: null, handoverPickup: true, handoverDelivery: false,
    });
    catalog.getCategoryById.mockImplementation(async (id: string) => [root, sub].find((c) => c.id === id) ?? null);
    catalog.getListingsForCategories.mockResolvedValue({
      items: [{ listing: { id: "01JZZZZZZZZZZZZZZZZZZZZZZZ" }, citySlug: "krasnodar" }], total: 1,
    });
  });

  // Рендер ListingPage как функции и обход дерева элементов: так видны пропсы
  // крошек и JSON-LD без DOM.
  async function renderListing() {
    const el = await CitySubPage({
      params: Promise.resolve({ city: "krasnodar", seg: "ekshn-kamery", sub: `gopro-${LISTING_ID}` }),
      searchParams: Promise.resolve({}),
    });
    const Page = el.type as (p: unknown) => Promise<unknown>;
    const found: Array<{ type: unknown; props: Record<string, unknown> }> = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === "object" && "props" in n) {
        const node = n as { type: unknown; props: Record<string, unknown> };
        found.push(node);
        walk(node.props.children);
      }
    };
    walk(await Page(el.props));
    return found;
  }

  it("крошки: Главная / Город / Корень / Подкатегория / Название", async () => {
    const nodes = await renderListing();
    const crumbs = nodes.find((n) => Array.isArray(n.props.items))!.props.items as Array<{ label: string; href?: string }>;
    expect(crumbs).toEqual([
      { label: "Главная", href: "/" },
      { label: "Краснодар", href: "/krasnodar" },
      { label: "Фото и видео", href: "/krasnodar/foto-i-video" },
      { label: "Экшн-камеры", href: "/krasnodar/foto-i-video/ekshn-kamery" },
      { label: "GoPro" },
    ]);
  });

  it("BreadcrumbList и «Ещё в категории» — на канонический адрес подкатегории", async () => {
    const nodes = await renderListing();
    const lists = nodes
      .map((n) => n.props.data as { "@type"?: string; itemListElement?: Array<{ item?: string }> } | undefined)
      .filter((d) => d?.["@type"] === "BreadcrumbList");
    expect(lists).toHaveLength(1);
    expect(lists[0]!.itemListElement!.map((i) => i.item && new URL(i.item).pathname)).toEqual([
      "/", "/krasnodar", "/krasnodar/foto-i-video", "/krasnodar/foto-i-video/ekshn-kamery", undefined,
    ]);
    const hrefs = nodes.map((n) => n.props.href).filter((h): h is string => typeof h === "string");
    expect(hrefs).toContain("/krasnodar/foto-i-video/ekshn-kamery");
    expect(hrefs).not.toContain("/krasnodar/ekshn-kamery");
  });

  it("вещь прямо в корне — одна крошка раздела", async () => {
    catalog.getActiveListingById.mockResolvedValue({
      id: LISTING_ID, slug: "gopro", title: "GoPro", cityId: krasnodar.id, categoryId: "K1",
      ownerUserId: "U1", status: "active", priceDay: 700, description: null, quantity: 1,
      depositType: "none", depositAmount: null, handoverPickup: true, handoverDelivery: false,
    });
    const el = await CitySubPage({
      params: Promise.resolve({ city: "krasnodar", seg: "foto-i-video", sub: `gopro-${LISTING_ID}` }),
      searchParams: Promise.resolve({}),
    });
    const Page = el.type as (p: unknown) => Promise<{ props: { children: unknown[] } }>;
    const tree = await Page(el.props);
    const crumbs = (tree.props.children as Array<{ props?: { items?: Array<{ label: string }> } }>)
      .find((c) => c?.props?.items)!.props!.items!;
    expect(crumbs.map((c) => c.label)).toEqual(["Главная", "Краснодар", "Фото и видео", "GoPro"]);
  });
});

// Карточка: title без шаблона сайта и не длиннее 65 символов, описание —
// сначала факты, свой openGraph (url, первое фото с размерами), «Поделиться»
// с каноническим адресом без дат, количества и «Где».
describe("listing metadata and share", () => {
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/\u00a0/g, " "));
  const listing = {
    id: LISTING_ID, slug: "drill", title: "Дрель", cityId: krasnodar.id, categoryId: "K1",
    ownerUserId: "U1", status: "active", priceDay: 500, quantity: 1,
    description: "Ударная,  с кейсом.", depositType: "money", depositAmount: 3000,
    handoverPickup: true, handoverDelivery: true,
  };
  const canonical = `/krasnodar/tools/drill-${LISTING_ID}`;

  beforeEach(() => {
    catalog.getActiveListingById.mockResolvedValue(listing);
    city.getCityScope.mockResolvedValue({ region: false, near: null, cityIds: [krasnodar.id], nearby: false });
    catalog.listingPhotos.mockReturnValue([]);
  });

  it("title absolute, описание с фактами впереди", async () => {
    const meta = await generateMetadata(props("krasnodar"));
    expect(plain(meta.title)).toEqual({ absolute: "Дрель — аренда в Краснодаре, 500 ₽/сутки" });
    expect(plain(meta.description)).toBe(
      "Аренда в Краснодаре: 500 ₽/сутки, залог 3 000 ₽, самовывоз или доставка. Ударная, с кейсом.",
    );
  });

  it("openGraph: канонический url и первое фото с размерами", async () => {
    catalog.listingPhotos.mockReturnValue([
      { url: "https://cdn.example/1.webp", width: 1600, height: 900 },
      { url: "https://cdn.example/2.webp", width: 800, height: 600 },
    ]);
    const meta = await generateMetadata(props("krasnodar"));
    const og = meta.openGraph as Record<string, unknown>;
    expect(String(og.url)).toMatch(new RegExp(`^https?://[^/]+${canonical}$`));
    expect(og.images).toEqual([{ url: "https://cdn.example/1.webp", width: 1600, height: 900, alt: "Дрель" }]);
    // Общая часть из корневого layout повторена: слияние поверхностное.
    expect(og).toMatchObject({ type: "website", siteName: "inrenta", locale: "ru_RU" });
  });

  it("без фото — картинка сайта из родительских метаданных", async () => {
    const parentImages = [{ url: "https://site.example/opengraph-image?abc", width: 1200, height: 630 }];
    const parent = Promise.resolve({ openGraph: { images: parentImages } }) as never;
    const meta = await generateMetadata(props("krasnodar"), parent);
    expect((meta.openGraph as Record<string, unknown>).images).toEqual(parentImages);
  });

  it("«Поделиться» получает абсолютный канонический адрес без query", async () => {
    const el = await CitySubPage(props("krasnodar", {
      from: "2026-10-10", to: "2026-10-12", qty: "2", loc: "p:45.035,38.975", la: "x", src: "address", lp: "house",
    }));
    const Page = el.type as (p: unknown) => Promise<unknown>;
    const found: Array<{ props: Record<string, unknown> }> = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === "object" && "props" in n) {
        const node = n as { props: Record<string, unknown> };
        found.push(node);
        walk(node.props.children);
      }
    };
    walk(await Page(el.props));
    const share = found.find((n) => typeof n.props.url === "string" && "text" in n.props)!;
    expect(String(share.props.url)).toMatch(new RegExp(`^https?://[^/?#]+${canonical}$`));
    expect(share.props.title).toBe("Дрель");
    expect(plain(share.props.text)).toBe("Дрель — аренда в Краснодаре, 500 ₽/сутки");
  });
});
