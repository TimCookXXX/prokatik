import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Вход в админку — полная загрузка документа: Метрика решает, подниматься ли,
// по пути, с которого документ открыт (isMetrikaSkipped). Клиентский переход
// через next/link оставил бы работать счётчик публичной страницы.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} data-next-link="" {...rest}>{children}</a>
  ),
}));
vi.mock("@/components/auth/useSignOut", () => ({ useSignOut: () => ({ pending: false, run: vi.fn() }) }));
vi.mock("@/components/providers/ThemeSegmented", () => ({ ThemeSegmented: () => null }));

import { UserMenu } from "@/components/auth/UserMenu";

function openMenu(isAdmin: boolean) {
  render(<UserMenu email="a@b.c" name="Админ" image={null} isAdmin={isAdmin} />);
  fireEvent.mouseEnter(screen.getByLabelText("Кабинет"));
}

describe("ссылка «Админка» в меню пользователя", () => {
  it("обычная ссылка с полной загрузкой, не next/link", () => {
    openMenu(true);
    const link = screen.getByRole("menuitem", { name: /Админка/ });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/admin");
    expect(link).not.toHaveAttribute("data-next-link");
    // Остальные пункты — клиентские переходы, как и были.
    expect(screen.getByRole("menuitem", { name: /Настройки/ })).toHaveAttribute("data-next-link");
  });

  it("не показывается без роли admin", () => {
    openMenu(false);
    expect(screen.queryByRole("menuitem", { name: /Админка/ })).toBeNull();
  });
});
