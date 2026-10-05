// Страницы входа и сброса пароля — служебные: свой заголовок вместо заголовка
// главной и noindex. Ссылки с них робот проходит (follow), а в robots.txt они
// не закрыты — иначе метатег никто бы не прочитал (docs/seo.md).
import { describe, expect, it, vi } from "vitest";

// Страницы тянут auth и базу на импорте; метаданным они не нужны.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/store", () => ({ drizzleAuthStore: vi.fn() }));

const login = await import("@/app/(auth)/login/page");
const reset = await import("@/app/(auth)/reset/page");

describe("метаданные /login и /reset", () => {
  it.each([
    ["/login", login.metadata, "Вход"],
    ["/reset", reset.metadata, "Восстановление пароля"],
  ])("%s: свой title и noindex, follow", (_path, metadata, title) => {
    expect(metadata.title).toBe(title);
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});
