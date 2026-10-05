import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Через ListingsList сюда приезжает меню строки, а оно зовёт server action —
// тот тянет next-auth и next/server, которых в jsdom нет.
vi.mock("@/server/actions/owner", () => ({
  setListingStatus: vi.fn(async () => ({ ok: true as const, data: undefined })),
}));

// В браузере useSearchParams читает состояние роутера, которое history.replaceState
// обновляет вместе с адресом. В jsdom роутера нет, поэтому читаем сам адрес —
// связь «переписали адрес → компонент увидел новый вид» остаётся настоящей.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const { ListingsFilter } = await import("@/components/cabinet/ListingsFilter");
const { isListingsView } = await import("@/lib/owner/listings-view");
type Row = Parameters<typeof ListingsFilter>[0]["rows"][number];

const row = (over: Partial<Row> = {}): Row => ({
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  title: "Перфоратор",
  photoUrl: null,
  categoryName: "Электроинструмент",
  priceDay: 1500,
  depositType: "money",
  depositAmount: 3000,
  status: "active",
  freeToday: 1,
  quantity: 1,
  pendingRequests: 0,
  publicHref: null,
  needsAddress: false,
  ...over,
});

// Разметки в списке две — таблица и строки, — поэтому каждое название
// встречается дважды. Считаем по названиям, деля пополам.
const titles = (re: RegExp) => screen.queryAllByRole("link", { name: re }).length / 2;
const chip = (name: RegExp) => screen.getByRole("button", { name });

const MIXED = [
  row({ id: "a1", title: "Перфоратор", status: "active" }),
  row({ id: "a2", title: "Проектор", status: "active" }),
  row({ id: "h1", title: "Самокат", status: "hidden", freeToday: null }),
  row({ id: "x1", title: "Каркассон", status: "archived", freeToday: null }),
];

describe("ListingsFilter", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/cabinet/listings");
  });

  it("«Все» показывает активные и скрытые, но не архив", () => {
    render(<ListingsFilter rows={MIXED} initialView="all" />);
    expect(titles(/Перфоратор|Проектор|Самокат/)).toBe(3);
    expect(screen.queryByRole("link", { name: /Каркассон/ })).toBeNull();
  });

  it("счётчик чипа считает свой вид", () => {
    render(<ListingsFilter rows={MIXED} initialView="all" />);
    expect(chip(/^Все, 3$/)).toBeInTheDocument();
    expect(chip(/^Активные, 2$/)).toBeInTheDocument();
    expect(chip(/^Скрытые, 1$/)).toBeInTheDocument();
    expect(chip(/^Архив, 1$/)).toBeInTheDocument();
  });

  it("выбор вида сужает список и пишется в адрес", () => {
    render(<ListingsFilter rows={MIXED} initialView="all" />);
    fireEvent.click(chip(/^Архив, 1$/));

    expect(titles(/Каркассон/)).toBe(1);
    expect(screen.queryByRole("link", { name: /Перфоратор/ })).toBeNull();
    expect(window.location.search).toBe("?view=archived");

    // Возврат к «Все» стирает параметр, а не пишет view=all.
    fireEvent.click(chip(/^Все, 3$/));
    expect(window.location.search).toBe("");
  });

  it("вид из адреса применяется сразу", () => {
    window.history.replaceState(null, "", "/cabinet/listings?view=hidden");
    render(<ListingsFilter rows={MIXED} initialView="hidden" />);
    expect(titles(/Самокат/)).toBe(1);
    expect(screen.queryByRole("link", { name: /Перфоратор/ })).toBeNull();
    expect(chip(/^Скрытые, 1$/)).toHaveAttribute("aria-pressed", "true");
  });

  // Стояли в «Скрытые», убрали единственную скрытую вещь в архив: чип с нулём
  // не рисуется, и без отката человек остался бы в пустом списке.
  it("опустевший вид откатывается на «Все»", () => {
    window.history.replaceState(null, "", "/cabinet/listings?view=hidden");
    const noHidden = MIXED.filter((r) => r.status !== "hidden");
    render(<ListingsFilter rows={noHidden} initialView="hidden" />);

    expect(screen.queryByRole("button", { name: /^Скрытые/ })).toBeNull();
    expect(chip(/^Все, 2$/)).toHaveAttribute("aria-pressed", "true");
    expect(titles(/Перфоратор|Проектор/)).toBe(2);
    // Адрес не должен остаться на виде, из которого только что вышли: иначе
    // обновление страницы вернуло бы в ту же пустоту.
    expect(window.location.search).toBe("");
  });

  /* Возврат «назад» на мобиле: страница приходит из кеша роутера со старым
   * initialView, а вид в адресе уже другой. Правду знает адрес. */
  it("вид из адреса перебивает устаревший проп", () => {
    window.history.replaceState(null, "", "/cabinet/listings?view=archived");
    render(<ListingsFilter rows={MIXED} initialView="all" />);

    expect(chip(/^Архив, 1$/)).toHaveAttribute("aria-pressed", "true");
    expect(titles(/Каркассон/)).toBe(1);
    expect(screen.queryByRole("link", { name: /Перфоратор/ })).toBeNull();
  });

  it("вида с нулём в ряду нет", () => {
    render(
      <ListingsFilter rows={MIXED.filter((r) => r.status !== "archived")} initialView="all" />,
    );
    expect(screen.queryByRole("button", { name: /^Архив/ })).toBeNull();
  });

  // Фильтровать нечего — контрол не показываем вовсе.
  it("при одних активных вещах ряда нет", () => {
    render(
      <ListingsFilter
        rows={[row({ id: "a1" }), row({ id: "a2", title: "Проектор" })]}
        initialView="all"
      />,
    );
    expect(screen.queryByRole("group", { name: /Фильтр объявлений/ })).toBeNull();
    expect(titles(/Перфоратор|Проектор/)).toBe(2);
  });

  /* «Активные 5» рядом со «Все 5» — второе имя того же списка. Остаётся пара
   * «Все» + «Архив», а не тройка с дублем. */
  it("вид, совпавший со «Все», из ряда выпадает", () => {
    render(
      <ListingsFilter rows={MIXED.filter((r) => r.status !== "hidden")} initialView="all" />,
    );
    expect(chip(/^Все, 2$/)).toBeInTheDocument();
    expect(chip(/^Архив, 1$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Активные/ })).toBeNull();
  });

  // Всё в архиве: ряда нет, но и пустой список показывать нечестно —
  // показываем то единственное, что есть.
  it("когда всё в архиве, показывает архив", () => {
    render(<ListingsFilter rows={[row({ status: "archived", freeToday: null })]} initialView="all" />);
    expect(screen.queryByRole("group", { name: /Фильтр объявлений/ })).toBeNull();
    expect(titles(/Перфоратор/)).toBe(1);
    expect(screen.getByText(/появится в списке скрытым/)).toBeInTheDocument();
  });

  // Подсказка про возврат жила на удалённой странице архива и осталась
  // единственным местом, где сказано, что вещь возвращается скрытой.
  it("в виде «Архив» объясняет, куда вернётся вещь", () => {
    window.history.replaceState(null, "", "/cabinet/listings?view=archived");
    render(<ListingsFilter rows={MIXED} initialView="archived" />);
    expect(screen.getByText(/появится в списке скрытым/)).toBeInTheDocument();

    fireEvent.click(chip(/^Все, 3$/));
    expect(screen.queryByText(/появится в списке скрытым/)).toBeNull();
  });

  // Значение приезжает из адреса: строкой, массивом при повторе ключа или
  // мусором. Всё, что не вид, страница обязана считать «Все», а не падать.
  it("видом считается только известное значение", () => {
    expect(isListingsView("archived")).toBe(true);
    expect(isListingsView("all")).toBe(true);
    expect(isListingsView("banana")).toBe(false);
    expect(isListingsView(undefined)).toBe(false);
    expect(isListingsView(["hidden"])).toBe(false);
  });
});
