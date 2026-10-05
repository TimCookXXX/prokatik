import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// «Поделиться»: телефон с Web Share — системный лист; десктоп и без Web Share —
// меню «Скопировать ссылку», Telegram, WhatsApp, ВКонтакте. Делится всегда
// переданный канонический адрес.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { ShareButton } = await import("@/components/catalog/ShareButton");

const URL_ = "https://inrenta.ru/krasnodar/instrumenty/drel-01JABCDEFGHJKMNPQRSTVWXYZ0";
const props = { url: URL_, title: "Дрель", text: "Дрель — аренда в Краснодаре, 500 ₽/сутки" };

/** Экран: touch — «основной ввод палец». */
function setTouch(touch: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: touch && query.includes("pointer: coarse"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const nav = navigator as unknown as { share?: unknown; clipboard?: unknown };
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(() => {
  delete nav.share;
  window.matchMedia = originalMatchMedia;
});

function openMenu() {
  const trigger = screen.getByRole("button", { name: "Поделиться" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return trigger;
}

describe("телефон с Web Share", () => {
  it("зовёт системный лист с title, text и url, меню не открывает", async () => {
    setTouch(true);
    const share = vi.fn().mockResolvedValue(undefined);
    nav.share = share;
    render(<ShareButton {...props} />);

    const trigger = openMenu();
    fireEvent.click(trigger);

    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ title: "Дрель", text: props.text, url: URL_ });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("отмена листа человеком — тишина, меню не всплывает", async () => {
    setTouch(true);
    nav.share = vi.fn().mockRejectedValue(Object.assign(new Error("cancel"), { name: "AbortError" }));
    render(<ShareButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Поделиться" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("лист не открылся — запасное меню", async () => {
    setTouch(true);
    nav.share = vi.fn().mockRejectedValue(Object.assign(new Error("nope"), { name: "NotAllowedError" }));
    render(<ShareButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Поделиться" }));
    expect(await screen.findByRole("menuitem", { name: /Скопировать ссылку/ })).toBeInTheDocument();
  });
});

describe("десктоп и без Web Share — меню", () => {
  it("на десктопе меню, даже если Web Share есть", async () => {
    setTouch(false);
    const share = vi.fn();
    nav.share = share;
    render(<ShareButton {...props} />);
    openMenu();
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
  });

  it("пункты: копирование и три мессенджера с каноническим адресом", async () => {
    setTouch(true); // палец, но Web Share нет
    render(<ShareButton {...props} />);
    const trigger = openMenu();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Скопировать ссылку", "Telegram", "WhatsApp", "ВКонтакте"]);

    const hrefs = items.slice(1).map((i) => i.getAttribute("href")!);
    for (const href of hrefs) {
      const params = [...new URL(href).searchParams.values()];
      // Адрес — ровно канонический, без дат, количества и «Где».
      expect(params.some((v) => v === URL_ || v.endsWith(` ${URL_}`))).toBe(true);
      expect(params.join(" ")).not.toMatch(/[?&](from|to|qty|loc|la|src|lp)=/);
    }
    for (const item of items.slice(1)) {
      expect(item).toHaveAttribute("target", "_blank");
      expect(item.getAttribute("rel")).toContain("noopener");
    }
  });

  it("«Скопировать ссылку» кладёт адрес в буфер и сообщает об этом", async () => {
    setTouch(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ShareButton {...props} />);
    openMenu();
    const copy = await screen.findByRole("menuitem", { name: "Скопировать ссылку" });
    fireEvent.click(copy);

    expect(writeText).toHaveBeenCalledWith(URL_);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ссылка скопирована"));
    // Меню закрылось, фокус вернулся на кнопку.
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Поделиться" })).toHaveFocus());
  });

  it("буфер отказал и запасной путь тоже — ошибка словами, а не тишина", async () => {
    setTouch(false);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true,
    });
    const exec = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    render(<ShareButton {...props} />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Скопировать ссылку" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(exec).toHaveBeenCalledWith("copy");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("Clipboard API нет (небезопасный контекст) — копирует запасной путь", async () => {
    setTouch(false);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    let copied = "";
    const exec = vi.fn(() => {
      copied = (document.activeElement as HTMLTextAreaElement | null)?.value ?? "";
      return true;
    });
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    render(<ShareButton {...props} />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Скопировать ссылку" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ссылка скопирована"));
    expect(copied).toBe(URL_);
    // Временное поле убрано.
    expect(document.querySelector("textarea")).toBeNull();
  });
});
