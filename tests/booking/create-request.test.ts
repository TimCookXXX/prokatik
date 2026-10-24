// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Моки через vi.hoisted: экшен импортируется статически, фабрики vi.mock
// исполняются раньше тела модуля.
const { authMock, listingLimit, availWhere, transaction, db, dealNoteMock } = vi.hoisted(() => {
  const dealNoteMock = vi.fn();
  const listingLimit = vi.fn();
  const availWhere = vi.fn();
  const transaction = vi.fn();
  return {
    dealNoteMock,
    authMock: vi.fn(),
    listingLimit,
    availWhere,
    transaction,
    // Экшен читает объявление с владельцем, потом занятость на диапазон,
    // и только потом заходит в транзакцию.
    db: {
      select: vi.fn((fields?: unknown) =>
        fields
          ? { from: () => ({ innerJoin: () => ({ where: () => ({ limit: listingLimit }) }) }) }
          : { from: () => ({ where: availWhere }) },
      ),
      transaction,
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkLimit: () => ({ ok: true }) }));
vi.mock("@/server/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/server/realtime", () => ({ publish: vi.fn() }));
vi.mock("@/server/deal-note", () => ({ writeDealNote: dealNoteMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// after() живёт только внутри запроса — в тесте его нет, письмо мокается.
vi.mock("@/server/booking-mail", () => ({ queueBookingMail: vi.fn() }));

import { createBookingRequest } from "@/server/actions/booking";
import { todayStr } from "@/lib/catalog/dates";

const TODAY = todayStr();

const PRICE = 500;

const form = (from: string, to: string) => ({
  listingId: "l1", from, to, qty: 1, phone: "+79000000000", priceDay: PRICE,
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1", bannedAt: null } });
  listingLimit.mockResolvedValue([
    {
      listing: {
        id: "l1", ownerUserId: "u2", status: "active", quantity: 1,
        priceDay: PRICE, priceWeek: null, priceMonth: null, minDays: 1, depositType: "money", depositAmount: 2000,
      },
      ownerBannedAt: null,
    },
  ]);
});

describe("createBookingRequest: устаревший выбор дат", () => {
  it("прошедшая дата не подтягивается к сегодня, а отклоняется", async () => {
    // Кламп молча сдвинул бы from на сегодня, и владелец получил бы заявку на
    // даты, которых человек не выбирал. Диалог показывает только «готово».
    const res = await createBookingRequest(form("2020-01-01", "2020-01-03"));
    expect(res).toEqual({ ok: false, error: "dates_stale" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("за горизонтом брони — тоже отказ, а не кламп", async () => {
    const res = await createBookingRequest(form("2099-01-01", "2099-01-02"));
    expect(res).toEqual({ ok: false, error: "dates_stale" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("сегодняшний день проходит проверку и доходит до занятости", async () => {
    // Занятость отдаём полной: доказывает, что охранник дат пропустил дальше,
    // не заводя транзакцию ради этого.
    availWhere.mockResolvedValue([
      { listingId: "l1", date: TODAY, bookedQty: 1, blockedQty: 0 },
    ]);
    const res = await createBookingRequest(form(TODAY, TODAY));
    expect(res).toEqual({ ok: false, error: `dates_taken:${TODAY}` });
    expect(transaction).not.toHaveBeenCalled();
  });
});

/* Цена — такой же устаревающий параметр формы, как даты и количество. Заявка
 * навсегда запоминает условия, на которых её подали, поэтому подать её на
 * условиях, которых человек не видел, нельзя: поднятая за секунду до отправки
 * цена замёрзла бы в заявке как «то, на что вы согласились». */
describe("createBookingRequest: устаревшая цена", () => {
  it("сдвиг цены — отказ, а не молчаливое согласие на новую", async () => {
    const r = await createBookingRequest({ ...form(TODAY, TODAY), priceDay: PRICE - 100 });
    expect(r).toEqual({ ok: false, error: "price_stale" });
    expect(transaction).not.toHaveBeenCalled();
  });

  // Подделать цену снизу тоже нельзя: экшен доступен по сети мимо интерфейса,
  // и без сверки с объявлением заявка ушла бы по цене, назначенной клиентом.
  // Недельная цена меняет сумму так же, как суточная: появилась или сдвинулась,
  // пока форма открыта, — тот же отказ. Пустая строка значит «её нет».
  it("сверяет и недельную с месячной", async () => {
    const r = await createBookingRequest({ ...form(TODAY, TODAY), priceWeek: "2000" });
    expect(r).toEqual({ ok: false, error: "price_stale" });
    const same = await createBookingRequest({ ...form(TODAY, TODAY), priceWeek: "", priceMonth: "" });
    expect(same).not.toEqual({ ok: false, error: "price_stale" });
  });

  it("цену из запроса не берёт на веру", async () => {
    const r = await createBookingRequest({ ...form(TODAY, TODAY), priceDay: 1 });
    expect(r).toEqual({ ok: false, error: "price_stale" });
  });

  /* Форма без цены проходит: так шлёт страница, открытая до выкладки поля.
   * Снимок всё равно берётся из объявления — клиент на него не влияет, —
   * теряется только предупреждение о сдвиге. */
  it("без цены заявка проходит, а снимок всё равно берётся у вещи", async () => {
    availWhere.mockResolvedValue([]);
    const inserted: Record<string, unknown>[] = [];
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        insert: () => ({ values: async (v: Record<string, unknown>) => { inserted.push(v); } }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      });
    });
    const { priceDay: _drop, ...without } = form(TODAY, TODAY);
    const r = await createBookingRequest(without);
    expect(r.ok).toBe(true);
    expect(inserted.find((v) => "customerPhone" in v)).toMatchObject({ priceDay: PRICE });
  });
});

describe("createBookingRequest: своё объявление", () => {
  // Подтвердив такую заявку, владелец занял бы собственные даты в обход
  // календаря занятости, а уведомлений за весь её цикл не пришло бы никому.
  it("владельцу отказ, а не заявка самому себе", async () => {
    listingLimit.mockResolvedValue([
      { listing: {
        id: "l1", ownerUserId: "u1", status: "active", quantity: 1,
        priceDay: PRICE, priceWeek: null, priceMonth: null, minDays: 1, depositType: "money", depositAmount: 2000,
      }, ownerBannedAt: null },
    ]);
    const res = await createBookingRequest(form(TODAY, TODAY));
    expect(res).toEqual({ ok: false, error: "own_listing" });
    expect(transaction).not.toHaveBeenCalled();
  });

  // Порядок отказов тот же, что в canStartThread: своё объявление называется
  // своим, даже когда оно снято с публикации.
  it("скрытое своё объявление тоже own_listing, а не listing_not_found", async () => {
    listingLimit.mockResolvedValue([
      { listing: {
        id: "l1", ownerUserId: "u1", status: "hidden", quantity: 1,
        priceDay: PRICE, priceWeek: null, priceMonth: null, minDays: 1, depositType: "money", depositAmount: 2000,
      }, ownerBannedAt: null },
    ]);
    const res = await createBookingRequest(form(TODAY, TODAY));
    expect(res).toEqual({ ok: false, error: "own_listing" });
  });
});

/* Количество клампилось молча: владелец мог уменьшить quantity, пока форма
 * открыта, и заявка уходила на меньшее число единиц, чем человек видел. Тот же
 * класс, что и сдвиг дат, — и отказ такой же явный. */
describe("createBookingRequest: количество", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "u1", bannedAt: null } });
    availWhere.mockResolvedValue([]);
  });

  it("отказывает, если количество урезалось клампом", async () => {
    listingLimit.mockResolvedValue([{
      listing: {
        id: "l1", ownerUserId: "owner", status: "active", quantity: 1,
        priceDay: PRICE, priceWeek: null, priceMonth: null, minDays: 1, depositType: "money", depositAmount: 2000,
      },
      ownerBannedAt: null,
    }]);
    const r = await createBookingRequest({
      ...form(TODAY, TODAY), qty: 3,
    });
    expect(r).toEqual({ ok: false, error: "qty_stale" });
  });

  it("количество в пределах остатка пропускает", async () => {
    listingLimit.mockResolvedValue([{
      listing: {
        id: "l1", ownerUserId: "owner", status: "active", quantity: 5,
        priceDay: PRICE, priceWeek: null, priceMonth: null, minDays: 1, depositType: "money", depositAmount: 2000,
      },
      ownerBannedAt: null,
    }]);
    transaction.mockResolvedValue(undefined);
    const r = await createBookingRequest({ ...form(TODAY, TODAY), qty: 3 });
    expect(r.ok).toBe(true);
  });
});

/* Журнал сделки — главный инвариант этапа: пропуск одной записи оставляет в
 * треде дыру, которую ничем потом не восполнить. Без этой проверки удаление
 * вызова из мутации прошло бы все тесты. */
describe("createBookingRequest: журнал сделки", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "u1", bannedAt: null } });
    availWhere.mockResolvedValue([]);
    listingLimit.mockResolvedValue([{
      listing: {
        id: "l1", ownerUserId: "owner", status: "active", quantity: 1,
        priceDay: PRICE, priceWeek: null, priceMonth: null, minDays: 1, depositType: "money", depositAmount: 2000,
      },
      ownerBannedAt: null,
    }]);
    dealNoteMock.mockClear();
    // Транзакция настоящая по форме: колбэк исполняется, писатель зовётся.
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        insert: () => ({ values: async () => undefined }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      };
      await fn(tx);
    });
  });

  it("открывает журнал записью о заявке", async () => {
    const r = await createBookingRequest(form(TODAY, TODAY));
    expect(r.ok).toBe(true);
    expect(dealNoteMock).toHaveBeenCalledTimes(1);
    const note = dealNoteMock.mock.calls[0][1];
    expect(note).toMatchObject({
      listingId: "l1", ownerUserId: "owner", customerUserId: "u1",
      kind: "request_created",
    });
    expect(note.meta).toMatchObject({ from: TODAY, to: TODAY, qty: 1 });
  });

  /* Условия сделки уезжают в журнал копией с тех же значений, что легли
   * колонками в саму заявку. Копия, а не ссылка на вещь: владелец поменяет
   * цену завтра, и журнал переписался бы задним числом — а он на то и журнал,
   * чтобы этого не делать. */
  it("кладёт в запись условия на момент заявки", async () => {
    await createBookingRequest(form(TODAY, TODAY));
    const meta = dealNoteMock.mock.calls[0][1].meta;
    expect(meta).toMatchObject({ priceDay: PRICE, depositType: "money", depositAmount: 2000 });
    // Пустые тарифы в meta не кладутся вовсе: jsonb не тащит null-ключи.
    expect(meta).not.toHaveProperty("priceWeek", null);
  });

  /* И теми же значениями — в саму заявку. Расхождение этих двух записей
   * означало бы, что шторка и переписка называют разные суммы за одну сделку;
   * обе делаются одной транзакцией, поэтому разъехаться им негде. */
  it("кладёт те же условия колонками в заявку", async () => {
    const inserted: Record<string, unknown>[] = [];
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        insert: () => ({ values: async (v: Record<string, unknown>) => { inserted.push(v); } }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      };
      await fn(tx);
    });
    await createBookingRequest(form(TODAY, TODAY));
    const request = inserted.find((v) => "customerPhone" in v);
    expect(request).toMatchObject({ priceDay: 500, depositType: "money", depositAmount: 2000 });
  });
});

/* Дубль ловится индексом, а не проверкой перед вставкой, и наружу выходит
 * человеческим отказом. Контракт с драйвером хрупкий — code и constraint лежат
 * на самой ошибке pg, и обёртка drizzle новых версий могла бы его сломать
 * молча. Тест фиксирует ровно ту форму, которую разбирает catch. */
describe("createBookingRequest: дубль", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "u1", bannedAt: null } });
    availWhere.mockResolvedValue([]);
    listingLimit.mockResolvedValue([{
      listing: {
        id: "l1", ownerUserId: "owner", status: "active", quantity: 1,
        priceDay: PRICE, priceWeek: null, priceMonth: null, minDays: 1, depositType: "money", depositAmount: 2000,
      },
      ownerBannedAt: null,
    }]);
  });

  it("нарушение своего индекса становится duplicate_request", async () => {
    transaction.mockRejectedValue(Object.assign(new Error("duplicate key"), {
      code: "23505", constraint: "booking_requests_live_dup_uq",
    }));
    const r = await createBookingRequest(form(TODAY, TODAY));
    expect(r).toEqual({ ok: false, error: "duplicate_request" });
  });

  it("чужое нарушение уникальности пробрасывается", async () => {
    transaction.mockRejectedValue(Object.assign(new Error("duplicate key"), {
      code: "23505", constraint: "some_other_uq",
    }));
    await expect(createBookingRequest(form(TODAY, TODAY))).rejects.toThrow("duplicate key");
  });
});
