// @vitest-environment node
// Разбор ответов для pnpm seo:check (scripts/seo-check.ts): порядок контента,
// метатеги, JSON-LD, robots.txt и sitemap. Сетевой прогон не тестируется —
// только чистые функции на фикстурах.
import { describe, expect, it } from "vitest";
import {
  checkContentOrder, classifyPath, extractJsonLd, findCanonical, findMeta, formatTable, hasNoindex,
  locationPath, parseArgs, parseRobotsTxt, parseSitemap, productUnitCode, rootMissingInCity, wrongSlugPath,
} from "../../scripts/seo-check";

const ID = "01M20NAPEB0TV3FHHNSDEY4GJ1";

// Так выглядел прод со стримингом: шапка, подвал и лоадер в оболочке, а
// страница приезжает позже скрытым блоком S:0 и h1 оказывается после footer.
const STREAMED = [
  "<html><head><title>x</title></head><body><header>…</header>",
  "<main>Ищем рядом…</main><footer>подвал</footer>",
  '<div hidden id="S:0"><main><h1>Дрель</h1></main></div></body></html>',
].join("");

const NORMAL = [
  '<html><head><link rel="canonical" href="https://inrenta.ru/krasnodar"/>',
  '<meta name="robots" content="noindex, follow"/>',
  '<meta property="og:title" content="Дрель &amp; бита"/>',
  "</head><body><header>…</header><main><h1>Дрель</h1></main><footer>подвал</footer></body></html>",
].join("");

describe("checkContentOrder", () => {
  it("стримовая страница — FAIL: footer раньше h1", () => {
    const r = checkContentOrder(STREAMED);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/footer/);
  });

  it("стримовая вставка раньше h1 без footer — тоже FAIL", () => {
    const html = '<body><div hidden id="S:1">x</div><h1>t</h1></body>';
    expect(checkContentOrder(html)).toMatchObject({ ok: false });
  });

  it("обычная страница — PASS", () => {
    expect(checkContentOrder(NORMAL).ok).toBe(true);
  });

  it("без h1 — FAIL", () => {
    expect(checkContentOrder("<body><footer/></body>").ok).toBe(false);
  });
});

describe("метатеги", () => {
  it("canonical, robots и og читаются с разэкранированием", () => {
    expect(findCanonical(NORMAL)).toBe("https://inrenta.ru/krasnodar");
    expect(hasNoindex(NORMAL)).toBe(true);
    expect(findMeta(NORMAL, "og:title")).toBe("Дрель & бита");
  });

  it("нет тегов — null и не noindex", () => {
    expect(findCanonical(STREAMED)).toBeNull();
    expect(hasNoindex(STREAMED)).toBe(false);
    expect(hasNoindex('<meta name="robots" content="index, follow"/>')).toBe(false);
  });
});

describe("JSON-LD", () => {
  it("достаёт unitCode из priceSpecification продукта", () => {
    const html = [
      '<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>',
      '<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer",',
      '"priceSpecification":{"@type":"UnitPriceSpecification","unitCode":"DAY"}}}</script>',
      '<script type="application/ld+json">{битый</script>',
    ].join("");
    const blocks = extractJsonLd(html);
    expect(blocks).toHaveLength(2);
    expect(productUnitCode(blocks)).toBe("DAY");
  });

  it("без priceSpecification — null", () => {
    expect(productUnitCode([{ "@type": "Product", offers: { price: 1 } }])).toBeNull();
  });
});

describe("robots.txt", () => {
  it("разбирает Clean-param, Sitemap, Host и длину строки", () => {
    const long = `Clean-param: ${"a&".repeat(260)}b`;
    const t = parseRobotsTxt([
      "User-agent: *", "Disallow: /admin", "Disallow: /api/", "",
      "Clean-param: from&to", long, "Host: inrenta.ru", "Sitemap: https://inrenta.ru/sitemap.xml",
    ].join("\n"));
    expect(t.cleanParams).toHaveLength(2);
    expect(t.longCleanParams).toEqual([long]);
    expect(t.hasHost).toBe(true);
    expect(t.sitemaps).toEqual(["https://inrenta.ru/sitemap.xml"]);
    expect(t.disallow).toEqual(["/admin", "/api/"]);
  });
});

describe("sitemap и адреса", () => {
  const xml = [
    "<urlset>",
    "<url><loc>https://inrenta.ru/</loc></url>",
    "<url><loc>https://inrenta.ru/krasnodar</loc></url>",
    "<url><loc>https://inrenta.ru/krasnodar/foto</loc></url>",
    "<url><loc>https://inrenta.ru/yablonovskiy</loc></url>",
    "<url><loc>https://inrenta.ru/yablonovskiy/foto</loc></url>",
    "<url><loc>https://inrenta.ru/yablonovskiy/deti</loc></url>",
    "<url><loc>https://inrenta.ru/krasnodar/foto/kamery</loc></url>",
    `<url><loc>https://inrenta.ru/krasnodar/kamery/gopro-${ID}</loc></url>`,
    "</urlset>",
  ].join("");
  const paths = parseSitemap(xml).map((u) => new URL(u).pathname);

  it("классифицирует страницы каталога", () => {
    expect(paths.map(classifyPath)).toEqual([
      "home", "city", "category", "city", "category", "category", "subcategory", "listing",
    ]);
  });

  it("находит корень, которого нет у другого города", () => {
    expect(rootMissingInCity(paths)).toEqual({ path: "/krasnodar/deti", presentIn: "yablonovskiy" });
    expect(rootMissingInCity(paths.filter((p) => !p.endsWith("/deti")))).toBeNull();
  });

  it("подменяет слаг карточки, сохраняя id", () => {
    expect(wrongSlugPath(`/krasnodar/kamery/gopro-hero-${ID}`)).toBe(`/krasnodar/kamery/x-${ID}`);
    // Слаг уже `x` — подмена обязана дать другой адрес, иначе ждали бы 308 от канона.
    expect(wrongSlugPath(`/krasnodar/kamery/x-${ID}`)).toBe(`/krasnodar/kamery/xx-${ID}`);
  });

  it("Location сводится к пути — абсолютный и относительный", () => {
    expect(locationPath("https://inrenta.ru/a/b?x=1", "https://inrenta.ru")).toBe("/a/b?x=1");
    expect(locationPath("/a/b", "https://inrenta.ru")).toBe("/a/b");
    expect(locationPath(null, "https://inrenta.ru")).toBeNull();
  });
});

describe("parseArgs", () => {
  it("для прода пауза 600 мс, для localhost — 0", () => {
    expect(parseArgs(["https://inrenta.ru/"])).toMatchObject({ base: "https://inrenta.ru", delay: 600, sample: 15 });
    expect(parseArgs(["http://localhost:3011"])).toMatchObject({ delay: 0 });
    expect(parseArgs(["http://localhost:3011", "--delay", "50", "--sample", "3"])).toMatchObject({ delay: 50, sample: 3 });
  });

  it("без адреса — ошибка с подсказкой", () => {
    expect(() => parseArgs([])).toThrow(/usage/);
  });
});

it("formatTable печатает статус первым столбцом", () => {
  const out = formatTable([
    { status: "PASS", check: "a", url: "/", detail: "ok" },
    { status: "FAIL", check: "bb", url: "/x", detail: "нет" },
  ]);
  expect(out.split("\n").map((l) => l.split(/\s+/)[0])).toEqual(["PASS", "FAIL"]);
});
