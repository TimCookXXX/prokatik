import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/cookie-name";

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

// Edge middleware без обращения к БД. Делает два дела:
// 1) Проверяет ПРИСУТСТВИЕ session-cookie на protected-роутах — это убирает
//    вспышку UI при анонимном заходе в кабинет. Валидность cookie проверит
//    page-level requireAuthState() (defence-in-depth для протухших сессий).
// 2) Прокидывает в RSC флаг x-has-session (зачем — у самой строки ниже).
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

  if (isProtected(pathname) && !hasSessionCookie(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?from=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const headers = new Headers(req.headers);
  // Корневой layout по этому флагу решает, поднимать ли сокет. Наличие cookie
  // не означает живую сессию — валидность проверит сам сокет на рукопожатии;
  // здесь важно лишь не открывать соединение анонимам. Альтернативой был бы
  // третий auth() на каждой публичной странице (два уже делают Header и
  // MobileNav), то есть лишний поход в базу на весь каталог.
  headers.set("x-has-session", hasSessionCookie(req) ? "1" : "0");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    // icon.svg, apple-icon.png и opengraph-image — метаданные-роуты Next из
    // src/app/, лежат в корне рядом с favicon.ico. Без них в списке middleware
    // отрабатывал бы на каждом запросе картинки впустую.
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon\\.png|opengraph-image|icons/.*|manifest\\.webmanifest).*)",
  ],
};
