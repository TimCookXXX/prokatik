import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// jsdom не применяет Tailwind, поэтому «видимость» колонок проверяется по
// мобильному классу hidden на обёртке, а не через toBeVisible().

let segment: string | null = null;
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => segment,
  useRouter: () => ({ push }),
}));

const { ChatPanes } = await import("@/components/chat/ChatPanes");

const panes = (hasThreads = true) =>
  render(
    <ChatPanes list={<span data-testid="list" />} hasThreads={hasThreads}>
      <span data-testid="child" />
    </ChatPanes>,
  );

const wrapperOf = (testId: string) => screen.getByTestId(testId).parentElement!;

beforeEach(() => {
  segment = null;
  push.mockClear();
});

describe("ChatPanes", () => {
  it("на /chat показывает список, диалог скрыт", () => {
    panes();
    expect(wrapperOf("list").classList.contains("hidden")).toBe(false);
    expect(wrapperOf("child").classList.contains("hidden")).toBe(true);
  });

  it("с открытым тредом показывает диалог, список скрыт", () => {
    segment = "01A";
    panes();
    expect(wrapperOf("list").classList.contains("hidden")).toBe(true);
    expect(wrapperOf("child").classList.contains("hidden")).toBe(false);
  });

  it("композер /chat/new — такой же открытый диалог", () => {
    segment = "new";
    panes();
    expect(wrapperOf("list").classList.contains("hidden")).toBe(true);
    expect(wrapperOf("child").classList.contains("hidden")).toBe(false);
  });

  // Без переписок список колонкой не занимает места — иначе на десктопе выходят
  // две заглушки рядом, обе про одно и то же.
  it("без переписок рендерит только содержимое, без колонки списка", () => {
    panes(false);
    expect(screen.queryByTestId("list")).toBeNull();
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  // Пустой раздел на мобиле — та же шапка, что над списком: заголовок и путь
  // назад в кабинет. Без неё экран состоял из одной заглушки, а заголовок
  // каркаса прятался под fixed-панелью.
  it("без переписок показывает мобильную шапку раздела над заглушкой", () => {
    const { container } = panes(false);
    const header = container.querySelector("[data-chat-mobile-header]")!;
    expect(header).not.toBeNull();
    expect(header).toHaveClass("md:hidden");
    expect(header).toHaveTextContent("Сообщения");
    // Шапка — над заглушкой, внутри той же панели.
    expect(header.compareDocumentPosition(screen.getByTestId("child")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(header.querySelector("button")!);
    expect(push).toHaveBeenCalledWith("/cabinet");
  });

  // С переписками шапку рисует список — второй экземпляр был бы дублем.
  it("с переписками своей шапки не добавляет", () => {
    const { container } = panes();
    expect(container.querySelector("[data-chat-mobile-header]")).toBeNull();
  });
});
