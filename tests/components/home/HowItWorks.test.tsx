import { render, screen } from "@testing-library/react";
import { describe, it, expect, onTestFinished } from "vitest";
import { HowItWorks } from "@/components/home/HowItWorks";
import { content } from "@theme/content";

describe("HowItWorks", () => {
  it("renders the heading and every step caption", () => {
    render(<HowItWorks />);
    expect(screen.getByRole("heading", { name: content.home.howHeading })).toBeInTheDocument();
    for (const step of content.home.howSteps) {
      expect(screen.getByText(step.step)).toBeInTheDocument();
      expect(screen.getByText(step.text)).toBeInTheDocument();
    }
  });

  it("draws the screens without real controls", () => {
    // Макеты — картинки интерфейса, а не рабочие экраны. Настоящее поле здесь
    // потребовало бы контракта ui/field.ts (см. tests/theme/fields.test.ts),
    // а настоящая кнопка обещала бы человеку действие, которого нет.
    render(<HowItWorks />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  // На телефоне шаги — лента с прокруткой: её можно листать и с клавиатуры.
  it("names the step row and makes it focusable for keyboard scrolling", () => {
    // Лента переполнена — как на телефоне (jsdom ширин не считает).
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => 900 });
    onTestFinished(() => { delete (HTMLElement.prototype as { scrollWidth?: unknown }).scrollWidth; });
    render(<HowItWorks />);
    const row = screen.getByRole("list", { name: content.home.howStepsLabel });
    expect(row).toHaveAttribute("tabindex", "0");
    expect(row.querySelectorAll(":scope > li")).toHaveLength(content.home.howSteps.length);
  });
});
