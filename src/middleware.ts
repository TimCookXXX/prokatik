import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/cookie-name";
import { analyticsAllowed } from "@/lib/analytics/allowed";
import { isBotUserAgent } from "@/lib/analytics/bot";
import {
  PREVIOUS_VISITORS_COOKIE, VISITOR_COOKIE, isVisitorId, visitorCookieOptions,
} from "@/lib/analytics/visitor-cookie";

// Маршруты, на которые анон не должен попадать вообще (префикс-match).
// /requests здесь больше нет: заявки арендатора переехали в общую ленту
// кабинета, а старый адрес просто удалён — редиректа с него нет.
const PROTECTED_PREFIXES: string[] = [
  "/profile", "/cabinet", "/admin", "/chat",
];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
}

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`));
}

/** Что сделать с кукой id браузера (vid) на этом ответе. */
type VisitorCookie =
  | { kind: "keep" }
  | { kind: "set"; id: string }
  /** Стереть оставшиеся куки id — эти имена. */
  | { kind: "clear"; names: string[] };

// Prefetch — не заход: его делает роутер Next или браузер наперёд, без
// человека. Он только получает id, если того нет, — чтобы события страницы,
// открытой из prefetch, было к чему отнести, — но срок не продлевает.
function isPrefetch(req: NextRequest): boolean {
  const purpose = `${req.headers.get("sec-purpose") ?? ""} ${req.headers.get("purpose") ?? ""}`;
  return req.headers.has("next-router-prefetch") || /prefetch|prerender/i.test(purpose);
}

// Кука vid — id браузера для своей статистики посещений. Выдаётся, если её нет
// или в ней не UUID; на загрузке документа переставляется с новым сроком, на
// остальных запросах не трогается. Отказ от учёта (noanalytics) — не выдаётся,
// а оставшаяся стирается вместе с прежними id (vid_prev). Ботам не выдаётся: строк в базе им всё равно не
// заведут, а Set-Cookie на каждом ответе краулеру незачем.
//
// Строку в базе кука не создаёт: её заводит роут сбора по первому событию,
// которое шлёт JS после монтирования. Поэтому id, выданный этим ответом, в
// запрос к приложению не подкладывается — браузер без cookies обязан остаться
// неучтённым, а не становиться новым гостем на каждом запросе.
function visitorCookieFor(req: NextRequest): VisitorCookie {
  const current = req.cookies.get(VISITOR_COOKIE)?.value;
  if (!analyticsAllowed((name) => req.cookies.get(name)?.value)) {
    const names = [VISITOR_COOKIE, PREVIOUS_VISITORS_COOKIE].filter((name) => req.cookies.has(name));
    return names.length === 0 ? { kind: "keep" } : { kind: "clear", names };
  }
  if (isBotUserAgent(req.headers.get("user-agent"))) return { kind: "keep" };
  if (!isVisitorId(current)) return { kind: "set", id: crypto.randomUUID() };
  const isDocument = req.headers.get("sec-fetch-dest") === "document";
  return isDocument && !isPrefetch(req) ? { kind: "set", id: current } : { kind: "keep" };
}

function applyVisitorCookie(req: NextRequest, res: NextResponse, cookie: VisitorCookie): NextResponse {
  if (cookie.kind === "set") {
    res.cookies.set(VISITOR_COOKIE, cookie.id, visitorCookieOptions(req.nextUrl.protocol === "https:"));
  } else if (cookie.kind === "clear") {
    for (const name of cookie.names) res.cookies.delete(name);
  }
  return res;
}

// Edge middleware без обращения к БД. Делает три дела:
// 1) Проверяет ПРИСУТСТВИЕ session-cookie на protected-роутах — это убирает
//    вспышку UI при анонимном заходе в кабинет. Валидность cookie проверит
//    page-level requireAuthState() (defence-in-depth для протухших сессий).
// 2) Прокидывает в RSC флаг x-has-session (зачем — у самой строки ниже).
// 3) Выдаёт и продлевает куку id браузера vid (visitorCookieFor) — и на
//    ответе-редиректе защищённого пути тоже.
//
// Адрес страницы сюда намеренно НЕ прокидывается, хотя приём известный: дать
// его через заголовок можно, а пользы корневому layout'у от этого нет — он при
// клиентской навигации не перерисовывается, и прочитанный им путь остаётся от
// первой загрузки. Текущий адрес берут клиентские компоненты хуками, см.
// src/components/layout/use-current-city.ts.
//
// По той же причине здесь не трогается и выбранный город: освежать куку по
// адресу пришлось бы отсюда, а для этого нужен список активных слагов, то есть
// поход в БД на каждый запрос — ровно то, чего этот middleware избегает.
// Поэтому предпочтение меняет только явный выбор в селекторе.
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const visitor = visitorCookieFor(req);

  if (isProtected(pathname) && !hasSessionCookie(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?from=${encodeURIComponent(pathname + search)}`;
    return applyVisitorCookie(req, NextResponse.redirect(url), visitor);
  }

  const headers = new Headers(req.headers);
  // Корневой layout по этому флагу решает, поднимать ли сокет. Наличие cookie
  // не означает живую сессию — валидность проверит сам сокет на рукопожатии;
  // здесь важно лишь не открывать соединение анонимам. Альтернативой был бы
  // третий auth() на каждой публичной странице (два уже делают Header и
  // MobileNav), то есть лишний поход в базу на весь каталог.
  headers.set("x-has-session", hasSessionCookie(req) ? "1" : "0");
  return applyVisitorCookie(req, NextResponse.next({ request: { headers } }), visitor);
}

export const config = {
  matcher: [
    // icon.svg, apple-icon.png и opengraph-image — метаданные-роуты Next из
    // src/app/, лежат в корне рядом с favicon.ico. Без них в списке middleware
    // отрабатывал бы на каждом запросе картинки впустую.
    //
    // Файлы public/ (covers, demo, mock) и индекс подсказок адресов
    // (/api/geo/client-index, public и immutable) — ответы, которые можно
    // положить в общий кэш. Set-Cookie: vid на них общий кэш раздал бы многим
    // браузерам, и разные люди стали бы одним гостем.
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon\\.png|opengraph-image|icons/.*|manifest\\.webmanifest|covers/|demo/|mock/|api/geo/client-index).*)",
  ],
};
