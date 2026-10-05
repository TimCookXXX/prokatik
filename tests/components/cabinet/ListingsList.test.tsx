import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Меню строки клиентское и зовёт server action — тот тянет next-auth и
// next/server, которых в jsdom нет.
vi.mock("@/server/actions/owner", () => ({
  setListingStatus: vi.fn(async () => ({ ok: true as const, data: undefined })),
}));

const { ListingsList } = await import("@/components/cabinet/ListingsList");
type Row = Parameters<typeof ListingsList>[0]["rows"][number];

const row = (over: Partial<Row> = {}): Row => ({
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  title: "Перфоратор Bosch GBH 2-26",
  photoUrl: null,
  categoryName: "Электроинструмент",
  priceDay: 1500,
  depositType: "money",
  depositAmount: 3000,
  status: "active",
  freeToday: 1,
  quantity: 1,
  pendingRequests: 0,
  publicHref: "/kazan/elektroinstrumenty/perforator-01ARZ3NDEKTSV4RRFFQ69G5FAW",
  needsAddress: false,
  ...over,
});

// Разметки две — таблица от lg и строки ниже, — поэтому каждое значение
// присутствует дважды. Тесты это учитывают и берут все совпадения.
const texts = (re: RegExp) => screen.getAllByText(re);

describe("ListingsList", () => {
  it("название ведёт на страницу вещи, а не на витрину", () => {
    render(<ListingsList rows={[row()]} />);
    for (const link of screen.getAllByRole("link", { name: /Перфоратор/ })) {
      expect(link).toHaveAttribute("href", "/cabinet/listings/01ARZ3NDEKTSV4RRFFQ69G5FAW");
    }
  });

  // Залог всегда читается в паре с ценой — отдельной колонки у него нет.
  it("показывает цену и залог", () => {
    render(<ListingsList rows={[row()]} />);
    expect(texts(/1\s*500/).length).toBeGreaterThan(0);
    expect(texts(/залог 3\s*000/).length).toBeGreaterThan(0);
  });

  it("залог документом и его отсутствие названы словами", () => {
    const { unmount } = render(<ListingsList rows={[row({ depositType: "document" })]} />);
    expect(texts(/залог: документ/).length).toBeGreaterThan(0);
    unmount();

    render(<ListingsList rows={[row({ depositType: "none", depositAmount: null })]} />);
    expect(texts(/без залога/).length).toBeGreaterThan(0);
  });

  it("занятость на сегодня — словом, а не одним цветом", () => {
    const { unmount } = render(<ListingsList rows={[row({ freeToday: 0 })]} />);
    expect(texts(/^занято$/).length).toBeGreaterThan(0);
    unmount();

    const partial = render(<ListingsList rows={[row({ quantity: 3, freeToday: 2 })]} />);
    expect(texts(/свободно 2 из 3/).length).toBeGreaterThan(0);
    partial.unmount();

    render(<ListingsList rows={[row()]} />);
    expect(texts(/^свободно$/).length).toBeGreaterThan(0);
  });

  // Занятости у неактивных нет: freeQty без строк вернул бы всё количество и
  // нарисовал бы «свободно» объявлению, которого никто не видит.
  it("скрытому занятость не показывается", () => {
    render(<ListingsList rows={[row({ status: "hidden", freeToday: null })]} />);
    expect(screen.queryByText(/свободно/)).toBeNull();
    expect(texts(/Скрыто/).length).toBeGreaterThan(0);
  });

  // Ноль читается как значение и спорит с охряным чипом соседней строки.
  it("ждущие ответа заявки показаны числом, их отсутствие — прочерком", () => {
    const { unmount } = render(<ListingsList rows={[row({ pendingRequests: 2 })]} />);
    expect(texts(/^2$/).length).toBeGreaterThan(0);
    unmount();

    render(<ListingsList rows={[row({ pendingRequests: 0 })]} />);
    expect(texts(/—/).length).toBeGreaterThan(0);
  });

  // В строках ниже lg заголовков колонок нет: без подписи «2 из 3» и число
  // заявок стоят рядом двумя голыми числами, и что из них что — неизвестно.
  it("в мобильной строке у чисел есть подписи для скринридера", () => {
    const { container } = render(
      <ListingsList rows={[row({ quantity: 3, freeToday: 2, pendingRequests: 3 })]} />,
    );
    const list = container.querySelector("ul")!;
    expect(within(list).getByText(/сегодня:/)).toBeInTheDocument();
    expect(within(list).getByText(/заявок ждёт ответа: 3/)).toBeInTheDocument();
  });

  // Частичная занятость должна называться словом, а не «2 из 3» без него —
  // удалённая карточка кабинета писала «Свободно 2 из 3», и это не регресс.
  it("частичная занятость названа словом", () => {
    render(<ListingsList rows={[row({ quantity: 3, freeToday: 2 })]} />);
    expect(screen.getAllByText(/свободно 2 из 3/).length).toBeGreaterThan(0);
  });

  it("действия собраны в одно меню с названием вещи", () => {
    render(<ListingsList rows={[row()]} />);
    const triggers = screen.getAllByRole("button", { name: /Действия: Перфоратор/ });
    expect(triggers.length).toBeGreaterThan(0);
  });

  // Меню — единственное место, где живут смена статуса и архивация, поэтому
  // его состав проверяем: пропавший пункт иначе заметить нечем.
  it("в меню строки есть переходы и смена статуса", async () => {
    const { container } = render(<ListingsList rows={[row()]} />);
    const trigger = within(container.querySelector("table")!)
      .getByRole("button", { name: /Действия: Перфоратор/ });
    // Radix раскрывает меню по pointerdown, а не по click.
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    expect(await screen.findByRole("menuitem", { name: /Править/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Смотреть объявление/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Скрыть/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /В архив/ })).toBeInTheDocument();
  });

  // Строка без точки в городе с геоданными: покупатели не видят расстояния, а
  // форма правки не сохранится без выбора адреса. Метка ведёт сразу в правку.
  it("просит уточнить адрес у строки без точки и ведёт в правку", () => {
    render(<ListingsList rows={[row({ needsAddress: true })]} />);
    const links = screen.getAllByRole("link", { name: /Уточните адрес/ });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/cabinet/listings/01ARZ3NDEKTSV4RRFFQ69G5FAW?tab=edit");
    }
  });

  it("не просит уточнять адрес, когда точка есть", () => {
    render(<ListingsList rows={[row()]} />);
    expect(screen.queryByText(/Уточните адрес/)).toBeNull();
  });

  it("обе раскладки показывают один и тот же список", () => {
    const { container } = render(<ListingsList rows={[row(), row({ id: "l2", title: "Проектор" })]} />);
    const table = container.querySelector("table")!;
    const list = container.querySelector("ul")!;
    expect(within(table).getAllByRole("link", { name: /Перфоратор|Проектор/ })).toHaveLength(2);
    expect(within(list).getAllByRole("link", { name: /Перфоратор|Проектор/ })).toHaveLength(2);
  });
});
