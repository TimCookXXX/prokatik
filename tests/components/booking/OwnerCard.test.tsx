import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { OwnerCard } from "@/components/booking/OwnerCard";

const authProps = { nextAuthProviders: ["yandex"], vkEnabled: false, canRegisterByEmail: true };

const base = {
  name: "Артём",
  href: "/u/01ARZ3NDEKTSV4RRFFQ69G5FAV",
  image: null,
  cityName: "Казань",
  isVerified: true,
  createdAt: new Date("2023-05-01"),
  chatHref: "/chat/new/01ARZ3NDEKTSV4RRFFQ69G5FAW",
  isAuthed: true,
  isOwn: false,
  authProps,
};

describe("OwnerCard", () => {
  it("links the seller name and shows the verified badge when verified", () => {
    render(<OwnerCard {...base} location="ул. Баумана" />);
    expect(screen.getByRole("link", { name: /Артём/ })).toHaveAttribute("href", base.href);
    expect(screen.getByText(/Проверен/)).toBeInTheDocument();
  });

  it("omits the badge when not verified", () => {
    render(<OwnerCard {...base} name="Частник" isVerified={false} />);
    expect(screen.queryByText(/Проверен/)).toBeNull();
  });

  it("sends a logged-in visitor straight to the chat", () => {
    render(<OwnerCard {...base} />);
    expect(screen.getByRole("link", { name: "Написать" })).toHaveAttribute("href", base.chatHref);
  });

  // Аноним не должен уезжать на /login редиректом middleware: обычный клик
  // открывает модалку поверх страницы. Ссылкой на /login элемент остаётся —
  // это путь для ctrl-клика и работы без JS, и адрес чата едет в ?from=,
  // иначе после входа человек приземлится не туда, куда шёл.
  it("offers the login dialog to an anonymous visitor and keeps the chat as the destination", () => {
    render(<OwnerCard {...base} isAuthed={false} />);
    expect(screen.getByRole("link", { name: "Написать" })).toHaveAttribute(
      "href",
      `/login?from=${encodeURIComponent(base.chatHref)}`,
    );
  });

  it("hides the write button on your own listing", () => {
    render(<OwnerCard {...base} isOwn />);
    expect(screen.queryByRole("link", { name: "Написать" })).toBeNull();
    expect(screen.getByRole("link", { name: "Профиль" })).toBeInTheDocument();
  });

  // Публичная подпись адреса — улица без номера дома, город OwnerCard
  // дописывает сам. Полного адреса у компонента нет вовсе.
  it("shows the public address label followed by the city", () => {
    render(<OwnerCard {...base} location="улица Баумана" />);
    expect(screen.getByText("улица Баумана, Казань")).toBeInTheDocument();
  });

  it("shows just the city when there is no label or the label is the city", () => {
    const { unmount } = render(<OwnerCard {...base} location={null} />);
    expect(screen.getByText("Казань")).toBeInTheDocument();
    unmount();
    render(<OwnerCard {...base} location="Казань" />);
    expect(screen.getByText("Казань")).toBeInTheDocument();
    expect(screen.queryByText("Казань, Казань")).toBeNull();
  });
});
