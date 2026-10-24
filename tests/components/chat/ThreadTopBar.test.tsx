import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Внутри шапки живёт ThreadBackButton — ему нужен роутер.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

const { ThreadTopBar } = await import("@/components/chat/ThreadTopBar");

type Header = Parameters<typeof ThreadTopBar>[0]["header"];

// Картинок нет намеренно: next/image с удалённым src в jsdom не нужен, а на
// проверяемое поведение он не влияет.
const header: Header = {
  id: "01T",
  listingId: "01L",
  listingTitle: "Свадебное платье А-силуэт",
  listingSlug: "svadebnoe-plate",
  listingCitySlug: "kazan",
  listingCategorySlug: "odezhda",
  listingStatus: "active",
  listingImage: null,
  listingPriceDay: 5000,
  listingPriceWeek: null,
  listingPriceMonth: null,
  listingDepositType: "money",
  listingDepositAmount: 15000,
  ownerUserId: "01THEM",
  customerUserId: "01ME",
  counterpartId: "01THEM",
  counterpartName: "Марина",
  counterpartImage: null,
  counterpartBannedAt: null,
  viewerLastReadMessageId: null,
  counterpartLastReadMessageId: null,
};

describe("ThreadTopBar", () => {
  // Аватар обязан быть внутри той же ссылки: задача — «по имени И аватару
  // можно кликнуть», а тест на один только href этого не ловит. Без картинки
  // Avatar рисует кружок с буквой и помечает его aria-hidden.
  it("ведёт с имени и аватара в профиль собеседника", () => {
    render(<ThreadTopBar header={header} />);
    const link = screen.getByRole("link", { name: "Марина" });
    expect(link).toHaveAttribute("href", "/u/01THEM");
    expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  // Роль собеседника из шапки убрана: контекст сделки держит чип объявления,
  // а строка «вы арендуете» занимала место под именем и ничего не добавляла.
  it("роль собеседника не показывает", () => {
    render(<ThreadTopBar header={header} />);
    expect(screen.queryByText(/арендуе/)).toBeNull();
  });

  // Профиль забаненного отдаёт 404 — ссылки на него быть не должно.
  it("на забаненного собеседника не ссылается", () => {
    render(<ThreadTopBar header={{ ...header, counterpartBannedAt: new Date() }} />);
    expect(screen.getByRole("heading", { name: "Марина" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Марина" })).toBeNull();
  });

  // Снятое с публикации объявление отдаёт 404 — чип остаётся, ссылка нет.
  it("на снятое объявление не ссылается", () => {
    render(<ThreadTopBar header={{ ...header, listingStatus: "hidden" }} />);
    expect(screen.getByText(header.listingTitle)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: new RegExp(header.listingTitle) })).toBeNull();
  });

  // Имени может не быть у OAuth-профиля — ссылка обязана остаться рабочей.
  it("без имени подставляет заглушку и не теряет ссылку", () => {
    render(<ThreadTopBar header={{ ...header, counterpartName: null }} />);
    expect(screen.getByRole("heading", { name: "Собеседник" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Собеседник" }))
      .toHaveAttribute("href", "/u/01THEM");
  });
});
