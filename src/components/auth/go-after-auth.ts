import type { Route } from "next";
import { isMetrikaSkipped } from "@/components/analytics/metrika-url";
import { loadDocument } from "@/components/analytics/document-nav";

interface AuthRouter {
  push(href: Route): void;
  refresh(): void;
}

/**
 * Переход после входа по почте или смены пароля. В админку — полной загрузкой:
 * форма стоит на публичной странице или на /login, и там уже поднят счётчик
 * Метрики с Вебвизором. Клиентский переход оставил бы его записывать админку
 * (metrika-url.ts). Остальное — клиентский переход, как раньше.
 *
 * Путь приходит из рантайма и уже пропущен через safeCallback на сервере, а
 * typedRoutes ждёт литерал — отсюда приведение.
 */
export function goAfterAuth(router: AuthRouter, href: string): void {
  if (isMetrikaSkipped(new URL(href, window.location.origin).pathname)) {
    loadDocument(href);
    return;
  }
  router.push(href as Route);
  router.refresh();
}
