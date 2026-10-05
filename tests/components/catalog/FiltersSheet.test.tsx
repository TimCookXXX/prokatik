import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { FiltersSheet } from "@/components/catalog/FiltersSheet";

// Шторка — мобильный режим Modal: matchMedia отвечает «уже md».
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => ({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
  }) });
});
afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("FiltersSheet", () => {
  it("без фильтров — просто «Фильтры»", () => {
    render(<FiltersSheet count={0}><div>form</div></FiltersSheet>);
    const chip = screen.getByRole("button", { name: "Фильтры" });
    expect(chip).toHaveTextContent(/^Фильтры$/);
  });

  // Число на чипе — цифра; скринридеру нужно сказать, что она значит.
  it("показывает число применённых фильтров", () => {
    render(<FiltersSheet count={2}><div>form</div></FiltersSheet>);
    const chip = screen.getByRole("button", { name: "Фильтры, выбрано: 2" });
    expect(chip).toHaveTextContent("Фильтры2");
  });

  it("чип — цель для пальца в 44px на телефоне", () => {
    render(<FiltersSheet count={0}><div>form</div></FiltersSheet>);
    expect(screen.getByRole("button", { name: "Фильтры" })).toHaveClass("h-11", "md:h-8");
  });

  // Переключатель вида — ссылки: после перехода шторка не должна висеть
  // поверх перестроенной выдачи.
  it("держит переключатель вида и закрывается по его ссылке", async () => {
    render(
      <FiltersSheet count={0} view={<a href="#list">Списком</a>}>
        <div>form</div>
      </FiltersSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
    const sheet = screen.getByRole("dialog", { name: "Фильтры" });
    expect(within(sheet).getByText("Вид")).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("link", { name: "Списком" }));
    await waitFor(() => expect(sheet).toHaveAttribute("data-state", "closed"));
  });
});
