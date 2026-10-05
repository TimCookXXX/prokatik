import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// next/image валидирует remotePatterns даже под jsdom. Тестам нужен голый <img>.
vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => React.createElement("img", props),
}));

// SearchBar и DateRangeFilter переходят через useRouter из nextjs-toploader:
// он оборачивает роутер Next и запускает полосу загрузки. В тестах обёртка
// отдаёт роутер из next/navigation — тот, что подменил сам тест.
vi.mock("nextjs-toploader/app", async () => {
  const nav = await import("next/navigation");
  return { useRouter: () => nav.useRouter() };
});

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV ??= "test";
env.DATABASE_URL ??= "postgres://app:test@localhost:5432/app";
env.NEXTAUTH_URL ??= "http://localhost:3000";
env.NEXTAUTH_SECRET ??= "x".repeat(32);

// jsdom не реализует ResizeObserver, а на нём держится AutoHeight (плавная
// смена высоты карточки входа). Заглушки достаточно: тесты проверяют разметку,
// а не реальные размеры.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Ровно та же история со scrollIntoView: в браузерах он есть, в jsdom его нет.
// На нём держится доводка ленты переписки до конца там, где у неё нет
// собственного скролла (мобильная раскладка чата).
// Проверка на существование обязательна: часть файлов (роут-хендлеры, storage)
// объявляет окружение node, и DOM-глобалей там нет вовсе.
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
}
