import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config } from "@/middleware";

// Гарда доступа к личным разделам. Проверяется первый её уровень — наличие
// session-cookie; валидность сессии проверяет requireAuthState() на странице,
// это отдельный слой и здесь не тестируется.
//
// Тесты держат именно middleware, а не выделенные хелперы: файл помечен в
// Next 16 устаревшим и однажды поедет на конвенцию proxy (см. ADR 0006).
// Смысл этих тестов — чтобы такой переезд нельзя было сделать молча сломав
// редиректы.

// Список берётся из модуля, а не переписывается: третья копия имени была бы
// ровно тем, что этот модуль и убирает.
import { SESSION_COOKIE_NAMES } from "@/lib/auth/cookie-name";
const SESSION_COOKIES = [...SESSION_COOKIE_NAMES];
// /requests в списке больше нет: адрес удалён вместе с переездом заявок в
// общую ленту кабинета.
const PROTECTED = ["/profile", "/cabinet", "/admin", "/chat"];

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(`https://inrenta.ru${path}`), {
    headers: cookie ? { cookie: `${cookie}=token-value` } : {},
  });
}

function locationOf(path: string, cookie?: string): string | null {
  return middleware(request(path, cookie)).headers.get("location");
}

describe("middleware access guard", () => {
  it("redirects anonymous visitors away from every protected prefix", () => {
    for (const prefix of PROTECTED) {
      const res = middleware(request(prefix));
      expect(res.status, `${prefix} must redirect`).toBe(307);
      expect(res.headers.get("location")).toBe(
        `https://inrenta.ru/login?from=${encodeURIComponent(prefix)}`,
      );
    }
  });

  it("redirects from nested paths too", () => {
    expect(locationOf("/cabinet/listings/01JABCDEF")).toBe(
      `https://inrenta.ru/login?from=${encodeURIComponent("/cabinet/listings/01JABCDEF")}`,
    );
  });

  // Потерянная query означает, что после входа человек приедет не туда, куда шёл.
  it("keeps the query string in the from parameter", () => {
    expect(locationOf("/cabinet/listings?tab=drafts&page=2")).toBe(
      `https://inrenta.ru/login?from=${encodeURIComponent("/cabinet/listings?tab=drafts&page=2")}`,
    );
  });

  it("lets the request through when a session cookie is present", () => {
    for (const cookie of SESSION_COOKIES) {
      for (const prefix of PROTECTED) {
        const res = middleware(request(prefix, cookie));
        expect(res.status, `${prefix} with ${cookie}`).toBe(200);
        expect(res.headers.get("location"), `${prefix} with ${cookie}`).toBeNull();
      }
    }
  });

  // Совпадение по префиксу должно кончаться на границе сегмента: иначе
  // публичный /adminpanel начал бы требовать вход.
  it("does not treat lookalike paths as protected", () => {
    for (const path of ["/adminpanel", "/profiles", "/requestsomething", "/cabinets", "/chats"]) {
      const res = middleware(request(path));
      expect(res.status, `${path} must stay public`).toBe(200);
      expect(res.headers.get("location"), `${path} must stay public`).toBeNull();
    }
  });

  it("leaves public routes alone", () => {
    for (const path of ["/", "/kazan", "/kazan/instrumenty/sadovaya-tekhnika", "/login", "/search"]) {
      const res = middleware(request(path));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
    }
  });
});

describe("middleware session flag", () => {
  // По этому заголовку корневой layout решает, поднимать ли сокет. Под своим
  // именем в ответе он не лежит: NextResponse.next({ request: { headers } })
  // кодирует переопределения через x-middleware-request-*.
  const flagOf = (path: string, cookie?: string) =>
    middleware(request(path, cookie)).headers.get("x-middleware-request-x-has-session");

  it("marks visitors with a session cookie", () => {
    for (const cookie of SESSION_COOKIES) {
      expect(flagOf("/", cookie), cookie).toBe("1");
    }
  });

  it("marks anonymous visitors on public routes", () => {
    expect(flagOf("/")).toBe("0");
    expect(flagOf("/kazan")).toBe("0");
  });
});

describe("middleware matcher", () => {
  // Матчер применяет Next, здесь проверяется само выражение: что оно
  // пропускает статику мимо гарды и накрывает страницы приложения.
  const pattern = new RegExp(`^${config.matcher[0]}$`);

  it("skips assets that must never pay for the guard", () => {
    for (const path of [
      "/_next/static/chunks/main.js",
      "/_next/image?url=%2Fdemo%2F1.webp",
      "/favicon.ico",
      "/icon.svg",
      "/apple-icon.png",
      "/opengraph-image",
      "/icons/icon-192.png",
      "/manifest.webmanifest",
    ]) {
      expect(pattern.test(path), `${path} must be skipped`).toBe(false);
    }
  });

  it("covers application routes", () => {
    for (const path of ["/", "/kazan", "/cabinet", "/admin/cities", "/api/health"]) {
      expect(pattern.test(path), `${path} must be matched`).toBe(true);
    }
  });
});

describe("middleware visitor cookie", () => {
  // Кука vid — id браузера для своей статистики посещений. Строку в базе она не
  // заводит (это делает роут сбора), поэтому здесь проверяется только сама кука.
  const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const VID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const YEAR = 60 * 60 * 24 * 365;

  function visit(
    path: string,
    { cookies = {}, headers = {}, base = "https://inrenta.ru" }: {
      cookies?: Record<string, string>; headers?: Record<string, string>; base?: string;
    } = {},
  ) {
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    return middleware(new NextRequest(new URL(`${base}${path}`), {
      headers: { "user-agent": BROWSER, ...(cookie ? { cookie } : {}), ...headers },
    }));
  }
  const docLoad = { "sec-fetch-dest": "document" };
  const fetchEmpty = { "sec-fetch-dest": "empty" };

  it("выдаёт vid, если куки нет: UUID, httpOnly, год, на весь сайт", () => {
    for (const headers of [docLoad, fetchEmpty, {}]) {
      const set = visit("/", { headers }).cookies.get("vid");
      expect(set?.value, JSON.stringify(headers)).toMatch(/^[0-9a-f-]{36}$/);
      expect(set).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: YEAR });
    }
  });

  it("каждому новому браузеру — свой id", () => {
    expect(visit("/").cookies.get("vid")?.value).not.toBe(visit("/").cookies.get("vid")?.value);
  });

  it("не трогает валидную куку на запросах, кроме загрузки документа", () => {
    expect(visit("/kazan", { cookies: { vid: VID }, headers: fetchEmpty }).cookies.get("vid")).toBeUndefined();
    expect(visit("/api/search/suggest?q=a", { cookies: { vid: VID } }).cookies.get("vid")).toBeUndefined();
  });

  it("продлевает валидную куку на загрузке документа, не меняя значения", () => {
    const set = visit("/kazan", { cookies: { vid: VID }, headers: docLoad }).cookies.get("vid");
    expect(set).toMatchObject({ value: VID, maxAge: YEAR });
  });

  it("переставляет битую куку", () => {
    for (const bad of ["garbage", `${VID}x`, "1' or '1'='1"]) {
      const set = visit("/", { cookies: { vid: bad }, headers: fetchEmpty }).cookies.get("vid");
      expect(set?.value, bad).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(set?.value, bad).not.toBe(bad);
    }
  });

  it("ставит куку и на редирект защищённого пути, редирект прежний", () => {
    const res = visit("/cabinet", { headers: docLoad });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`https://inrenta.ru/login?from=${encodeURIComponent("/cabinet")}`);
    expect(res.cookies.get("vid")?.value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("флаг сессии и пропуск запроса с кукой не сломаны", () => {
    const res = visit("/cabinet", { cookies: { [SESSION_COOKIES[0]]: "t" }, headers: docLoad });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-has-session")).toBe("1");
    expect(res.cookies.get("vid")).toBeDefined();
  });

  it("после отказа от учёта не выдаёт и стирает оставшуюся", () => {
    expect(visit("/", { cookies: { noanalytics: "1" }, headers: docLoad }).cookies.get("vid")).toBeUndefined();
    const cleared = visit("/", { cookies: { noanalytics: "1", vid: VID }, headers: docLoad }).cookies.get("vid");
    expect(cleared?.value).toBe("");
    expect(cleared?.expires).toEqual(new Date(0));
    // На редиректе — то же.
    expect(visit("/cabinet", { cookies: { noanalytics: "1" } }).cookies.get("vid")).toBeUndefined();
  });

  it("ботам не выдаёт", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "curl/8.4.0",
      "",
    ]) {
      expect(visit("/", { headers: { ...docLoad, "user-agent": ua } }).cookies.get("vid"), ua).toBeUndefined();
    }
  });

  // Prefetch — не заход: срок не продлевает, но id получает, если его нет, —
  // события открытой из него страницы должно быть к чему отнести.
  it("prefetch не продлевает куку, но выдаёт её, если нет", () => {
    const prefetches = [
      { ...fetchEmpty, "next-router-prefetch": "1", rsc: "1" },
      { ...docLoad, "sec-purpose": "prefetch" },
      { ...docLoad, "sec-purpose": "prefetch;prerender" },
      { ...docLoad, purpose: "prefetch" },
    ];
    for (const headers of prefetches) {
      expect(visit("/kazan", { cookies: { vid: VID }, headers }).cookies.get("vid"), JSON.stringify(headers)).toBeUndefined();
      expect(visit("/kazan", { headers }).cookies.get("vid")?.value, JSON.stringify(headers)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("без https кука без Secure", () => {
    expect(visit("/", { base: "http://localhost:3000" }).cookies.get("vid")?.secure).toBe(false);
  });
});
