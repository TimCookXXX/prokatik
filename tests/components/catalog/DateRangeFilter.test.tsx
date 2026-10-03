import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DateRangeFilter } from "@/components/catalog/DateRangeFilter";
import { addDaysStr } from "@/lib/catalog/dates";

const open = () => fireEvent.click(screen.getByRole("button", { name: /даты|–/ }));
const day = (d: string) => document.querySelector<HTMLButtonElement>(`[data-day="${d}"] button`);

describe("DateRangeFilter", () => {
  it("без дат показывает «Любые даты»", () => {
    render(<DateRangeFilter resetHref="/kazan" today="2026-08-29" />);
    expect(screen.getByText("Любые даты")).toBeInTheDocument();
  });

  it("с диапазоном показывает его на кнопке", () => {
    render(<DateRangeFilter from="2026-08-28" to="2026-09-03" resetHref="/kazan" today="2026-08-29" />);
    expect(screen.getByText("28 авг – 3 сен")).toBeInTheDocument();
  });

  it("по клику рисует сетку календаря", () => {
    render(<DateRangeFilter resetHref="/kazan" today="2026-08-29" />);
    open();
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getAllByRole("gridcell").length).toBeGreaterThan(27);
  });

  // Календарь открывался пустой растянутой панелью: .rdp-theme тянет месяц и
  // сетку на 100% контейнера, а у поповера своей ширины нет. jsdom раскладку
  // не считает, поэтому проверяем не ширину, а само наличие ограничения.
  it("контейнер календаря имеет заданную ширину", () => {
    render(<DateRangeFilter resetHref="/kazan" today="2026-08-29" />);
    open();
    expect(document.querySelector(".rdp-theme")).toHaveClass("w-[19rem]");
  });

  it("«Показать» заблокирована, пока диапазон не выбран целиком", () => {
    render(<DateRangeFilter resetHref="/kazan" today="2026-08-29" />);
    open();
    expect(screen.getByRole("button", { name: "Показать" })).toBeDisabled();
  });

  // Поповер приклеен к кнопке и при прокрутке уезжает вверх, наползая на липкий
  // хедер (он ниже по z-index и накрыть его не может). Поэтому закрываем.
  it("закрывается при прокрутке страницы", () => {
    render(<DateRangeFilter resetHref="/kazan" today="2026-08-29" />);
    open();
    expect(screen.getByRole("grid")).toBeInTheDocument();

    fireEvent.scroll(window);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  // Календарь вынесен в DateRangeCalendar, поток фильтра прежний: два клика в
  // любом порядке дают период, «Показать» уводит на него без номера страницы.
  it("«Показать» уводит на период, выбранный кликами в любом порядке", () => {
    push.mockClear();
    window.history.replaceState(null, "", "/kazan?page=3&sort=price_asc");
    render(<DateRangeFilter resetHref="/kazan" today="2026-09-01" />);
    open();

    fireEvent.click(day("2026-09-10")!);
    expect(screen.getByRole("button", { name: "Показать" })).toBeDisabled();
    expect(screen.getByText("С 10 сен — выберите последний день")).toHaveAttribute("aria-live", "polite");
    fireEvent.click(day("2026-09-05")!);
    expect(screen.getByText("сб 5 — чт 10 сен · 6 дней")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Показать" }));
    expect(push).toHaveBeenCalledWith("/kazan?sort=price_asc&from=2026-09-05&to=2026-09-10");
    window.history.replaceState(null, "", "/");
  });

  // Превью до курсора или стрелки только рисуется: «выбранными» для
  // скринридера остаются дни, которые человек действительно выбрал.
  it("превью периода не помечает дни как выбранные", () => {
    render(<DateRangeFilter resetHref="/kazan" today="2026-09-01" />);
    open();
    const cell = (d: string) => document.querySelector(`[data-day="${d}"]`)!;

    fireEvent.click(day("2026-09-10")!);
    fireEvent.focus(day("2026-09-13")!);
    expect(cell("2026-09-12")).toHaveClass("rdp-range_middle");
    expect(cell("2026-09-12")).not.toHaveAttribute("aria-selected");
    expect(cell("2026-09-13")).toHaveClass("rdp-range_end");
    expect(cell("2026-09-13")).not.toHaveAttribute("aria-selected");
    expect(cell("2026-09-10")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(day("2026-09-13")!);
    expect(cell("2026-09-12")).toHaveAttribute("aria-selected", "true");
  });

  // Дальше горизонта брони забронировать нельзя — и выбрать такие дни тоже.
  it("закрывает дни раньше сегодня и дальше горизонта брони", () => {
    const today = "2026-08-29";
    const last = addDaysStr(today, 180);
    render(<DateRangeFilter from={addDaysStr(last, -2)} to={addDaysStr(last, -1)} resetHref="/kazan" today={today} />);
    open();

    expect(day(last)).not.toBeDisabled();
    expect(day(addDaysStr(last, 1))).toBeDisabled();
  });

  it("закрывает прошедшие дни", () => {
    render(<DateRangeFilter resetHref="/kazan" today="2026-08-29" />);
    open();
    expect(day("2026-08-28")).toBeDisabled();
    expect(day("2026-08-29")).not.toBeDisabled();
  });
});
