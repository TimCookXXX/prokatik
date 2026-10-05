// pnpm seo:check <baseUrl> [--delay 600] [--sample 15] [--browser-ua]
//
// Проверка технического SEO живого сайта одной командой: настоящие коды ответа
// (404, 308), порядок контента в HTML, canonical, noindex служебных страниц,
// robots.txt, Open Graph, JSON-LD и выборка адресов из sitemap. Ходит с UA
// YandexBot: Next считает его «HTML-limited» и отдаёт ему метаданные в <head>,
// а не стримом в body, — то есть видит то же, что поисковый робот.
//
// Нагрузка на прод: запросы строго последовательно, между ними пауза (по
// умолчанию 600 мс, для localhost — 0), карточек из sitemap — выборка.
//
// Вывод — таблица `PASS/FAIL/SKIP/INFO  проверка  адрес  подробности`; при любом
// FAIL код выхода 1, оборванный прогон (сеть, таймаут, плохие аргументы) — 2. Разбор HTML, robots.txt и sitemap — чистые функции ниже,
// тесты на них в tests/scripts/seo-check.test.ts.

import { realpathSync } from "node:fs";

export const BOT_UA = "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)";
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// ------------------------------------------------------------------ разбор HTML

export interface ContentOrder {
  h1: number;
  footer: number;
  /** Первая стримовая вставка `<div hidden id="S:…">`; -1 — её нет. */
  streamHole: number;
}

export function contentOrder(html: string): ContentOrder {
  return {
    h1: html.search(/<h1[\s>]/i),
    footer: html.search(/<footer[\s>]/i),
    streamHole: html.search(/<div hidden id="S:/),
  };
}

/** h1 есть, стоит раньше footer, и до него нет стримовой вставки. */
export function checkContentOrder(html: string): { ok: boolean; detail: string } {
  const o = contentOrder(html);
  if (o.h1 < 0) return { ok: false, detail: "нет <h1>" };
  if (o.footer >= 0 && o.footer < o.h1) {
    return { ok: false, detail: `<footer> на ${o.footer} раньше <h1> на ${o.h1}` };
  }
  if (o.streamHole >= 0 && o.streamHole < o.h1) {
    return { ok: false, detail: `стримовая вставка S: на ${o.streamHole} раньше <h1> на ${o.h1}` };
  }
  return { ok: true, detail: `<h1> на ${o.h1}, <footer> на ${o.footer}` };
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
}

export function findCanonical(html: string): string | null {
  for (const t of tags(html, "link")) {
    if ((attr(t, "rel") ?? "").toLowerCase() === "canonical") return attr(t, "href");
  }
  return null;
}

/** Содержимое `<meta name="…">` или `<meta property="…">`. */
export function findMeta(html: string, key: string): string | null {
  for (const t of tags(html, "meta")) {
    if (attr(t, "name") === key || attr(t, "property") === key) return attr(t, "content");
  }
  return null;
}

export function hasNoindex(html: string): boolean {
  return /(^|,)\s*noindex\s*(,|$)/i.test(findMeta(html, "robots") ?? "");
}

/** Все блоки JSON-LD страницы; битый JSON пропускается. */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try { out.push(JSON.parse(m[1]!)); } catch { /* не JSON — не наш блок */ }
  }
  return out;
}

/** unitCode из priceSpecification первого Product (или Offer внутри него). */
export function productUnitCode(blocks: unknown[]): string | null {
  for (const b of blocks) {
    const o = b as Record<string, unknown>;
    if (o?.["@type"] !== "Product") continue;
    const offers = (Array.isArray(o.offers) ? o.offers[0] : o.offers) as Record<string, unknown> | undefined;
    const spec = (Array.isArray(offers?.priceSpecification)
      ? offers!.priceSpecification[0]
      : offers?.priceSpecification) as Record<string, unknown> | undefined;
    return typeof spec?.unitCode === "string" ? spec.unitCode : null;
  }
  return null;
}

// ------------------------------------------------------------ robots и sitemap

export interface RobotsTxt {
  cleanParams: string[];
  /** Строки Clean-param длиннее 500 символов (лимит Яндекса). */
  longCleanParams: string[];
  sitemaps: string[];
  hasHost: boolean;
  disallow: string[];
}

export function parseRobotsTxt(text: string): RobotsTxt {
  const out: RobotsTxt = { cleanParams: [], longCleanParams: [], sitemaps: [], hasHost: false, disallow: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "clean-param") {
      out.cleanParams.push(value);
      if (line.length > 500) out.longCleanParams.push(line);
    } else if (key === "sitemap") out.sitemaps.push(value);
    else if (key === "host") out.hasHost = true;
    else if (key === "disallow") out.disallow.push(value);
  }
  return out;
}

export function parseSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decodeEntities(m[1]!));
}

const ULID_TAIL = /-[0-9A-HJKMNP-TV-Z]{26}$/i;

export type PathKind = "home" | "city" | "category" | "subcategory" | "listing" | "other";

/** Вид страницы каталога по пути: /{city}, /{city}/{root}, /{city}/{root}/{sub}, карточка. */
export function classifyPath(path: string): PathKind {
  const segs = path.split("?")[0]!.split("/").filter(Boolean);
  if (segs.length === 0) return "home";
  if (segs.length === 1) return "city";
  if (segs.length === 2) return "category";
  if (segs.length === 3) return ULID_TAIL.test(segs[2]!) ? "listing" : "subcategory";
  return "other";
}

export function pathOf(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

/**
 * Карточка с подменённым слагом: `/c/k/slug-ULID` → `/c/k/x-ULID`. Если слаг и
 * так `x`, подставляется `xx` — иначе адрес совпал бы с каноническим.
 */
export function wrongSlugPath(listingPath: string): string {
  const swap = (slug: string) => listingPath.replace(/\/[^/]*(-[0-9A-HJKMNP-TV-Z]{26})$/i, `/${slug}$1`);
  const wrong = swap("x");
  return wrong === listingPath ? swap("xx") : wrong;
}

/**
 * Корень, который в sitemap есть у одного города, но не у другого: адрес
 * `/{город без него}/{корень}` должен отдавать 404. null — такой пары нет.
 */
export function rootMissingInCity(paths: string[]): { path: string; presentIn: string } | null {
  const roots = new Map<string, Set<string>>();
  for (const p of paths) {
    if (classifyPath(p) === "city") roots.set(p.slice(1), roots.get(p.slice(1)) ?? new Set());
  }
  for (const p of paths) {
    if (classifyPath(p) !== "category") continue;
    const [city, root] = p.split("/").filter(Boolean) as [string, string];
    (roots.get(city) ?? roots.set(city, new Set()).get(city)!).add(root);
  }
  for (const [cityA, rootsA] of roots) {
    for (const [cityB, rootsB] of roots) {
      if (cityA === cityB) continue;
      const missing = [...rootsB].find((r) => !rootsA.has(r));
      if (missing) return { path: `/${cityA}/${missing}`, presentIn: cityB };
    }
  }
  return null;
}

/** Location ответа как путь с query (абсолютный и относительный одинаково). */
export function locationPath(location: string | null, base: string): string | null {
  if (!location) return null;
  return pathOf(new URL(location, base).toString());
}

// ---------------------------------------------------------------------- прогон

export type Status = "PASS" | "FAIL" | "SKIP" | "INFO";
export interface Row { status: Status; check: string; url: string; detail: string }

export function formatTable(rows: Row[]): string {
  const w = (k: "check" | "url") => Math.min(60, Math.max(k.length, ...rows.map((r) => r[k].length)));
  const cw = w("check");
  const uw = w("url");
  return rows
    .map((r) => `${r.status.padEnd(5)} ${r.check.padEnd(cw)}  ${r.url.padEnd(uw)}  ${r.detail}`)
    .join("\n");
}

interface Options { base: string; delay: number; sample: number; ua: string }

export function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  let delay: number | undefined;
  let sample = 15;
  let ua = BOT_UA;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--delay") delay = Number(argv[++i]);
    else if (a === "--sample") sample = Number(argv[++i]);
    else if (a === "--browser-ua") ua = BROWSER_UA;
    else positional.push(a);
  }
  const raw = positional[0];
  if (!raw) throw new Error("usage: pnpm seo:check <baseUrl> [--delay 600] [--sample 15] [--browser-ua]");
  const base = new URL(raw).origin;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(base).hostname);
  if (delay === undefined) delay = local ? 0 : 600;
  if (!Number.isFinite(delay) || delay < 0) throw new Error("--delay: число миллисекунд");
  if (!Number.isInteger(sample) || sample < 0) throw new Error("--sample: целое число");
  return { base, delay, sample, ua };
}

interface Res { status: number; location: string | null; contentType: string; body: string }

/** Сколько ждать один ответ: зависший запрос не должен вешать прогон. */
const REQUEST_TIMEOUT_MS = 30_000;

async function run(opts: Options): Promise<Row[]> {
  const rows: Row[] = [];
  const add = (status: Status, check: string, url: string, detail = "") => {
    rows.push({ status, check, url, detail });
  };
  const pass = (ok: boolean, check: string, url: string, detail = "") => add(ok ? "PASS" : "FAIL", check, url, detail);

  let first = true;
  const get = async (path: string, ua = opts.ua): Promise<Res> => {
    if (!first && opts.delay > 0) await new Promise((r) => setTimeout(r, opts.delay));
    first = false;
    try {
      const res = await fetch(new URL(path, opts.base), {
        redirect: "manual",
        headers: { "user-agent": ua },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return {
        status: res.status,
        location: res.headers.get("location"),
        contentType: res.headers.get("content-type") ?? "",
        body: await res.text(),
      };
    } catch (e) {
      // Сеть или таймаут обрывают весь прогон (код 2) — с адресом, на котором.
      throw new Error(`${path}: ${(e as Error).message}`);
    }
  };

  // --- sitemap: из него берутся все остальные адреса
  const sm = await get("/sitemap.xml");
  const paths = sm.status === 200 ? parseSitemap(sm.body).map(pathOf) : [];
  pass(sm.status === 200 && paths.length > 0, "sitemap", "/sitemap.xml", `${sm.status}, адресов: ${paths.length}`);
  const ofKind = (k: PathKind) => paths.filter((p) => classifyPath(p) === k);
  const listings = ofKind("listing");
  const subcats = ofKind("subcategory");
  const categories = ofKind("category");
  const citiesInMap = ofKind("city");

  // 1. Несуществующий адрес — настоящий 404 и роботу, и браузеру.
  const nope = `/seo-check-nope-${Math.random().toString(36).slice(2, 8)}`;
  for (const [label, ua] of [["бот", BOT_UA], ["браузер", BROWSER_UA]] as const) {
    const r = await get(nope, ua);
    pass(r.status === 404, `1 404 (${label})`, nope, String(r.status));
  }

  // 2. Карточка с неверным слагом — 301/308 на канонический путь.
  if (listings[0]) {
    const wrong = wrongSlugPath(listings[0]);
    const r = await get(wrong);
    const to = locationPath(r.location, opts.base);
    pass((r.status === 308 || r.status === 301) && to === listings[0], "2 слаг карточки → 308", wrong,
      `${r.status} → ${to ?? "—"}`);
  } else add("SKIP", "2 слаг карточки → 308", "—", "в sitemap нет карточек");

  // 3. Подкатегория по прямому слагу — 308 на /{city}/{root}/{sub}.
  if (subcats[0]) {
    const [city, , sub] = subcats[0].split("/").filter(Boolean);
    const direct = `/${city}/${sub}`;
    const r = await get(direct);
    const to = locationPath(r.location, opts.base);
    pass((r.status === 308 || r.status === 301) && to === subcats[0], "3 подкатегория → 308", direct,
      `${r.status} → ${to ?? "—"}`);
  } else add("SKIP", "3 подкатегория → 308", "—", "в sitemap нет подкатегорий");

  // 4. Пустой в городе корень и страница за пределом выдачи — 404.
  const missing = rootMissingInCity(paths);
  if (missing) {
    const r = await get(missing.path);
    pass(r.status === 404, "4 пустой корень → 404", missing.path, `${r.status} (корень есть в ${missing.presentIn})`);
  } else add("SKIP", "4 пустой корень → 404", "—", "нет корня, который есть у одного города и нет у другого");
  if (citiesInMap[0]) {
    const far = `${citiesInMap[0]}?page=9999`;
    const r = await get(far);
    pass(r.status === 404, "4 ?page за пределом → 404", far, String(r.status));
  } else add("SKIP", "4 ?page за пределом → 404", "—", "в sitemap нет городов");

  // 5. Порядок контента: h1 раньше footer и стримовых вставок.
  const pages = new Map<string, Res>();
  const page = async (path: string) => {
    const hit = pages.get(path);
    if (hit) return hit;
    const r = await get(path);
    pages.set(path, r);
    return r;
  };
  for (const [label, path] of [["категория", categories[0]], ["карточка", listings[0]]] as const) {
    if (!path) { add("SKIP", `5 h1 до footer (${label})`, "—", "нет в sitemap"); continue; }
    const r = await page(path);
    const c = checkContentOrder(r.body);
    pass(r.status === 200 && c.ok, `5 h1 до footer (${label})`, path, `${r.status}, ${c.detail}`);
  }

  // 6. Canonical: есть, абсолютный, того же origin.
  const canonicalTargets: Array<[string, string | undefined]> = [
    ["главная", "/"], ["город", citiesInMap[0]], ["категория", categories[0]], ["карточка", listings[0]],
    ["privacy", "/privacy"], ["sources", "/sources"],
  ];
  for (const [label, path] of canonicalTargets) {
    if (!path) { add("SKIP", `6 canonical (${label})`, "—", "нет в sitemap"); continue; }
    const r = await page(path);
    const href = findCanonical(r.body);
    let ok = false;
    try { ok = href !== null && new URL(href).origin === opts.base; } catch { ok = false; }
    pass(r.status === 200 && ok, `6 canonical (${label})`, path, href ?? "нет canonical");
  }

  // 7. noindex на служебных страницах.
  for (const path of ["/search", "/login", "/reset"]) {
    const r = await get(path);
    pass(r.status === 200 && hasNoindex(r.body), "7 noindex", path,
      `${r.status}, robots: ${findMeta(r.body, "robots") ?? "—"}`);
  }

  // 8. robots.txt.
  {
    const r = await get("/robots.txt");
    const t = parseRobotsTxt(r.body);
    const problems: string[] = [];
    if (r.status !== 200) problems.push(`статус ${r.status}`);
    if (!r.contentType.startsWith("text/plain")) problems.push(`content-type ${r.contentType}`);
    if (t.cleanParams.length === 0) problems.push("нет Clean-param");
    if (t.longCleanParams.length > 0) problems.push("Clean-param длиннее 500");
    if (!t.sitemaps.includes(`${opts.base}/sitemap.xml`)) problems.push(`Sitemap не ${opts.base}/sitemap.xml`);
    if (t.hasHost) problems.push("есть Host:");
    pass(problems.length === 0, "8 robots.txt", "/robots.txt",
      problems.join("; ") || `Clean-param: ${t.cleanParams.length}, Disallow: ${t.disallow.join(" ")}`);
  }

  // 9. Open Graph.
  if (listings[0]) {
    const r = await page(listings[0]);
    const image = findMeta(r.body, "og:image");
    const missingOg = ["og:title", "og:url", "og:image"].filter((k) => !findMeta(r.body, k));
    const absolute = image ? /^https?:\/\//.test(image) : false;
    pass(missingOg.length === 0 && absolute, "9 og (карточка)", listings[0],
      missingOg.length ? `нет ${missingOg.join(", ")}` : `og:image ${image}`);
  } else add("SKIP", "9 og (карточка)", "—", "в sitemap нет карточек");
  {
    const r = await page("/");
    const image = findMeta(r.body, "og:image");
    pass(Boolean(image), "9 og:image (главная)", "/", image ?? "нет og:image");
  }

  // 10. JSON-LD карточки: цена за сутки.
  if (listings[0]) {
    const r = await page(listings[0]);
    const unit = productUnitCode(extractJsonLd(r.body));
    pass(unit === "DAY", "10 JSON-LD unitCode", listings[0], unit ?? "нет priceSpecification.unitCode");
  } else add("SKIP", "10 JSON-LD unitCode", "—", "в sitemap нет карточек");

  // 11. Выборка sitemap: все не-карточки и N случайных карточек — 200 без редиректа.
  {
    const shuffled = [...listings].sort(() => Math.random() - 0.5).slice(0, opts.sample);
    const targets = [...paths.filter((p) => classifyPath(p) !== "listing"), ...shuffled];
    const bad: string[] = [];
    for (const path of targets) {
      const r = pages.get(path) ?? await get(path);
      if (r.status !== 200) bad.push(`${path} ${r.status}`);
    }
    pass(bad.length === 0, "11 sitemap → 200", `${targets.length} адресов`, bad.join("; ") || "все 200");
  }

  // 12. Ключ IndexNow. Ключ сайту не обязателен: 404 — только печать. Если
  // адрес отвечает 200, это должен быть ключ — hex в text/plain, а не HTML.
  {
    const r = await get("/indexnow.txt");
    if (r.status === 404) {
      add("INFO", "12 indexnow.txt", "/indexnow.txt", "404 — ключа нет, пинги IndexNow не уходят");
    } else {
      const key = r.body.trim();
      pass(
        r.status === 200 && r.contentType.startsWith("text/plain") && /^[a-f0-9]{8,128}$/.test(key),
        "12 indexnow.txt", "/indexnow.txt",
        `${r.status} ${r.contentType}${r.status === 200 ? `, ключ ${key.length} символов` : ""}`,
      );
    }
  }

  return rows;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`seo:check ${opts.base} (delay ${opts.delay} мс, выборка ${opts.sample}, UA ${opts.ua === BOT_UA ? "YandexBot" : "браузер"})\n`);
  const rows = await run(opts);
  console.log(formatTable(rows));
  const failed = rows.filter((r) => r.status === "FAIL").length;
  console.log(`\n${failed ? `FAIL: ${failed}` : "все проверки PASS"}`);
  process.exitCode = failed ? 1 : 0;
}

// Запуск командой, а не импорт из тестов. Сравнение по realpath: путь в argv
// может идти через симлинк, и тогда прогон молча не начался бы — с кодом 0.
function isMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(import.meta.filename);
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(2);
  });
}
