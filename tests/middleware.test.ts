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
