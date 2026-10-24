// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/* Сводка кабинета одной панелью. Проверяем то, что легко потерять молча:
 * строка ждущей ответа заявки несёт всё для решения — включая ТЕЛЕФОН, потому
 * что по правилам сервиса решение принимается созвоном; идущая аренда решать
 * не предлагает; своя отправленная заявка вообще показывается (без неё сводка
 * говорила бы «ничего не ждёт ответа» человеку, который только что кого-то
 * забронировал). */

vi.mock("@/server/actions/owner", () => ({
  cancelConfirmedByOwner: vi.fn(), completeRequest: vi.fn(),
  confirmRequest: vi.fn(), declineRequest: vi.fn(),
}));
vi.mock("@/server/actions/booking", () => ({ cancelBookingRequest: vi.fn() }));

const { SummaryPanel } = await import("@/components/cabinet/SummaryPanel");
type Row = Parameters<typeof SummaryPanel>[0]["rows"][number];

const flat = (s: string) => s.replace(/[\s\u00A0\u202F]+/g, " ");
const text = () => flat(document.body.textContent ?? "");

const row = (over: Partial<Row> = {}): Row => ({
  id: "01REQ",
  side: "owner",
  status: "new",
  dateFrom: "2026-09-14",
  dateTo: "2026-09-17",
  qty: 1,
  createdAt: "2026-09-11T08:00:00.000Z",
  expiresAt: "2026-09-12T08:00:00.000Z",
  customerComment: null,
  priceDay: 700,
  priceWeek: null,
  priceMonth: null,
  depositType: "money",
  depositAmount: 4000,
  listing: {
    id: "01L", title: "Гирлянда уличная 20 м", slug: "girlyanda",
    citySlug: "krasnodar", categorySlug: "prochee",
    status: "active", ownerBannedAt: null, image: null,
  },
  threadId: "01T",
  peer: { id: "01P", name: "Мадина" },
  peerPhone: "+79180000001",
  hot: true,
  estimate: 700 * 4,
  estimateBasis: { unit: "day", rate: 700, capped: false },
  unread: 0,
  ...over,
});

describe("строка, ждущая ответа", () => {
  it("несёт всё для решения: сумму, залог, слова клиента и кнопки", () => {
    render(<SummaryPanel rows={[row({ customerComment: "Заберу вечером" })]} rest={0} />);
    const t = text();
    expect(t).toContain("≈ 2 800 ₽");
    // Сутки считает сам компонент, и границы диапазона включительные:
    // 14–17 сентября — четверо суток, а не трое.
    expect(t).toContain("за 4 дня");
    expect(t).toContain("залог 4 000 ₽");
    expect(t).toContain("Заберу вечером");
    expect(screen.getByRole("button", { name: "Подтвердить" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Отклонить" })).toBeTruthy();
  });

  /* Телефон обязателен именно здесь. Правило сервиса: решение по заявке
   * принимается созвоном, значит номер — вход в решение, а не соседний экран. */
  it("показывает телефон клиента ссылкой для звонка", () => {
    render(<SummaryPanel rows={[row()]} rest={0} />);
    const tel = screen.getByRole("link", { name: /\+7918/ });
    expect(tel.getAttribute("href")).toBe("tel:+79180000001");
  });

  it("роль названа словом, а не разделом", () => {
    render(<SummaryPanel rows={[row()]} rest={0} />);
    expect(text()).toContain("вы сдаёте");
  });
});

describe("идущая аренда", () => {
  const going = row({
    status: "confirmed", hot: false,
    dateFrom: "2026-09-09", dateTo: "2026-09-11",
  });

  it("решать не предлагает", () => {
    render(<SummaryPanel rows={[going]} rest={0} />);
    expect(screen.queryByRole("button", { name: "Подтвердить" })).toBeNull();
  });

  // Непрочитанное — числом в самой кнопке переписки, а не рядом с ней.
  it("непрочитанное видно на кнопке переписки", () => {
    render(<SummaryPanel rows={[{ ...going, unread: 3 }]} rest={0} />);
    expect(screen.getByRole("link", { name: /Переписка, 3/ })).toBeTruthy();
  });

  it("без треда кнопки переписки нет", () => {
    render(<SummaryPanel rows={[{ ...going, threadId: null }]} rest={0} />);
    expect(screen.queryByRole("link", { name: /Переписка/ })).toBeNull();
  });
});

/* Своя отправленная заявка. Её отсутствие и было дырой прежней сводки: человек,
 * только что забронировавший чужую вещь, видел «Всё разобрано». */
describe("моя заявка на чужую вещь", () => {
  const mine = row({ side: "customer", hot: false, peerPhone: null });

  /* Телефон владельца до подтверждения не раскрыт — это решает правило в
   * lib/booking/request-access, и панель обязана печатать только то, что оно
   * отдало. Номер в фикстуре стоит НЕПУСТОЙ намеренно: с null проверку прошла
   * бы любая панель, в том числе печатающая всё подряд. */
  it("не печатает телефон, если правило его не отдало", () => {
    render(<SummaryPanel rows={[{ ...mine, peerPhone: null }]} rest={0} />);
    expect(text()).not.toContain("+7");
    expect(screen.queryByRole("link", { name: /\+7/ })).toBeNull();
  });

  // А когда отдало — печатает: обратная половина того же правила.
  it("печатает телефон, когда правило его отдало", () => {
    render(<SummaryPanel
      rows={[{ ...mine, status: "confirmed", peerPhone: "+79180000009" }]}
      rest={0}
    />);
    expect(screen.getByRole("link", { name: /\+79180000009/ })).toBeTruthy();
  });

  it("показывается и говорит, что ответа ещё нет", () => {
    render(<SummaryPanel rows={[mine]} rest={0} />);
    expect(text()).toContain("вы арендуете");
    expect(text()).toContain("Ждёт подтверждения");
  });

  it("чужих кнопок решения не даёт", () => {
    render(<SummaryPanel rows={[mine]} rest={0} />);
    expect(screen.queryByRole("button", { name: "Подтвердить" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Отклонить" })).toBeNull();
  });
});

describe("хвост и пустота", () => {
  it("непоместившееся названо числом и ведёт в ленту", () => {
    render(<SummaryPanel rows={[row()]} rest={6} />);
    const more = screen.getByRole("link", { name: /Ещё 6 заявок/ });
    expect(more.getAttribute("href")).toBe("/cabinet/requests");
  });

  it("одна лишняя заявка склоняется правильно", () => {
    render(<SummaryPanel rows={[row()]} rest={1} />);
    expect(screen.getByRole("link", { name: /Ещё 1 заявка/ })).toBeTruthy();
  });

  it("хвоста нет, когда всё поместилось", () => {
    render(<SummaryPanel rows={[row()]} rest={0} />);
    expect(screen.queryByRole("link", { name: /Ещё/ })).toBeNull();
  });

  // Пустая сводка даёт по двери на каждую роль: человек мог прийти и сдавать,
  // и брать.
  it("пустая панель зовёт в обе стороны", () => {
    render(<SummaryPanel rows={[]} rest={0} />);
    expect(screen.getByRole("link", { name: "Разместить вещь" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Что сдают рядом" })).toBeTruthy();
  });
});
