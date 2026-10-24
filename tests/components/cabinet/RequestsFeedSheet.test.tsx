// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/* Шторка заявки — единственное место, где владелец решает, и единственное, где
 * человек видит условия сделки целиком. Проверяем то, что легко потерять
 * молча: залог показывается ВСЕГДА (в том числе когда его нет — это ответ, а не
 * его отсутствие), количество только когда его больше одного, а сумма считается
 * по цене из самой заявки, а не по сегодняшней цене вещи. */

/* Адрес — единственный источник правды о том, какая заявка открыта. Мок
 * useSearchParams подставляет его же: это ровно тот контракт, который был
 * нарушен, когда компонент держал свою копию в useState и читал
 * window.location в момент рендера. */
const params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params }));

// Кнопки решения зовут server action — тот тянет next-auth, которого в jsdom нет.
vi.mock("@/server/actions/owner", () => ({
  cancelConfirmedByOwner: vi.fn(), completeRequest: vi.fn(),
  confirmRequest: vi.fn(), declineRequest: vi.fn(),
}));
vi.mock("@/server/actions/booking", () => ({ cancelBookingRequest: vi.fn() }));

const { RequestsFeed } = await import("@/components/cabinet/RequestsFeed");
type Row = Parameters<typeof RequestsFeed>[0]["rows"][number];

const flat = (s: string) => s.replace(/[\s\u00A0\u202F]+/g, " ");

const row = (over: Partial<Row> = {}): Row => ({
  id: "01REQ",
  side: "owner",
  status: "new",
  dateFrom: "2026-09-12",
  dateTo: "2026-09-14",
  qty: 2,
  createdAt: "2026-09-11T10:00:00.000Z",
  expiresAt: "2026-09-12T10:00:00.000Z",
  customerComment: null,
  priceDay: 500,
  priceWeek: null,
  priceMonth: null,
  depositType: "money",
  depositAmount: 2000,
  listing: {
    id: "01L", title: "Мангал", slug: "mangal", citySlug: "krasnodar",
    categorySlug: "grili", status: "active", ownerBannedAt: null, image: null,
  },
  threadId: null,
  peer: { id: "01P", name: "Мадина" },
  peerPhone: null,
  hot: true,
  estimate: 500 * 3 * 2,
  estimateBasis: { unit: "day", rate: 500, capped: false },
  ...over,
});

/* Шторка монтируется только по клику — на сервере она не рисуется вовсе. Текст
 * читаем из всего документа, а не из container: шторка уезжает в портал, и
 * поддерева, которое вернул render, в ней нет.
 *
 * Клик здесь не имитируется: pushState в jsdom роутер не обновит, а открытость
 * компонент берёт из адреса. Ставим адрес и монтируем — это и есть путь
 * «пришёл по ссылке из переписки». */
function openSheet(r: Row) {
  params.set("request", r.id);
  return render(<RequestsFeed rows={[r]} />);
}

const sheetText = () => flat(document.body.textContent ?? "");

describe("шторка заявки", () => {
  /* Не только подпись, но и ЗНАЧЕНИЕ: без него тест оставался зелёным, даже
   * если в депозит передать null, — владелец видел бы «Не указан» вместо
   * настоящей суммы, а подпись «Залог» стояла бы на месте. */
  it("залог показывается всегда, вместе с суммой", () => {
    openSheet(row());
    expect(screen.getByText("Залог")).toBeTruthy();
    expect(sheetText()).toContain("2 000 ₽");
  });

  // «Не нужен» — это ответ на вопрос о залоге, а не отсутствие ответа.
  it("залога нет — так и говорит, а строку не прячет", () => {
    openSheet(row({ depositType: "none", depositAmount: null }));
    expect(screen.getByText("Залог")).toBeTruthy();
    expect(screen.getByText("Не нужен")).toBeTruthy();
  });

  it("количество показывается только когда его больше одного", () => {
    const { unmount } = openSheet(row({ qty: 2 }));
    expect(screen.getByText("Сколько")).toBeTruthy();
    unmount();

    openSheet(row({ qty: 1, estimate: 500 * 3 }));
    expect(screen.queryByText("Сколько")).toBeNull();
  });

  // Границы диапазона включительные: 12–14 сентября — трое суток.
  it("период называет число суток", () => {
    openSheet(row());
    expect(sheetText()).toContain("3 дня");
  });

  /* Раскладка обязательна: «≈ 3 000 ₽» человек сверяет в уме, а сутки у нас
   * включают обе границы — счёт в уме расходится на день. */
  it("показывает, из чего сложилась сумма", () => {
    openSheet(row());
    const text = sheetText();
    expect(text).toContain("≈ 3 000 ₽");
    expect(text).toContain("500 ₽");
    expect(text).toContain("× 3 дня");
    expect(text).toContain("× 2 шт.");
  });

  // Сервис денег не проводит — рядом с суммами это обязано быть сказано.
  it("предупреждает, что оплата и залог мимо сервиса", () => {
    openSheet(row());
    expect(sheetText()).toContain("сервис их не проводит");
  });
});

/* Гонка, которая стоила заказчику сломанной шторки: компонент держал свою
 * копию открытой заявки в useState и читал window.location в момент рендера, а
 * Next коммитит адрес ПОСЛЕ него. Переход по ссылке из переписки открывал
 * шторку один раз из десяти. Тест держит контракт: открытость берётся из
 * адреса, а не из собственного состояния. */
describe("какая заявка открыта — решает адрес", () => {
  it("заявка из адреса открывается без единого клика", () => {
    params.set("request", "01REQ");
    render(<RequestsFeed rows={[row()]} />);
    expect(screen.getByText("Залог")).toBeTruthy();
  });

  it("адрес без заявки шторку не открывает", () => {
    params.delete("request");
    render(<RequestsFeed rows={[row()]} />);
    expect(screen.queryByText("Залог")).toBeNull();
  });

  // Ссылка на заявку, которой в ленте нет (удалена, отфильтрована), не должна
  // ни открывать пустую шторку, ни ронять страницу.
  it("ссылка на чужую или исчезнувшую заявку страницу не роняет", () => {
    params.set("request", "01НЕТ-ТАКОЙ");
    expect(() => render(<RequestsFeed rows={[row()]} />)).not.toThrow();
    expect(screen.queryByText("Залог")).toBeNull();
  });
});
