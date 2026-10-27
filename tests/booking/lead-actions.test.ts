// @vitest-environment node
// submitLeadForm — запасная форма «Имя + телефон». Проверка выбора у неё та же,
// что у заявки из кабинета, и коды ошибок обязаны совпадать: их разбирает один
// humanError. Тест гоняет оба экшена по одним сценариям на одной базе-моке.
// Плюс honeypot, лимиты и суточный потолок, сверх которого заявка пишется, но
// в группу не идёт.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, listingLimit, availWhere, db, state } = vi.hoisted(() => {
  const listingLimit = vi.fn();
  const availWhere = vi.fn();
  return {
    authMock: vi.fn(),
    listingLimit,
    availWhere,
    state: { after: [] as (() => unknown)[], vid: undefined as string | undefined, ip: "1.2.3.4" },
    // Объявление с владельцем, потом занятость на диапазон — та же форма
    // запросов, что в tests/booking/create-request.test.ts.
    db: {
      select: vi.fn((fields?: unknown) =>
        fields
          ? { from: () => ({ innerJoin: () => ({ where: () => ({ limit: listingLimit }) }) }) }
          : { from: () => ({ where: availWhere }) },
      ),
      transaction: vi.fn(async () => undefined),
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/server/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/server/realtime", () => ({ publish: vi.fn() }));
vi.mock("@/server/deal-note", () => ({ writeDealNote: vi.fn() }));
vi.mock("@/server/booking-mail", () => ({ queueBookingMail: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    state.after.push(fn);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "vid" && state.vid ? { value: state.vid } : undefined) }),
  headers: async () => new Headers({ "x-forwarded-for": state.ip }),
}));
vi.mock("@/server/leads", async (importOriginal) => ({
  snapshotColumns: (await importOriginal<typeof import("@/server/leads")>()).snapshotColumns,
  insertFormLead: vi.fn(async () => ({ id: "LEAD1", code: "INR-4821" })),
  visitorContext: vi.fn(async () => ({ internal: false, ymClientId: null, utm: null })),
}));
vi.mock("@/server/lead-delivery", () => ({
  deliverLeadCard: vi.fn(async () => {}),
  retryUndeliveredCards: vi.fn(async () => {}),
}));

import { createBookingRequest } from "@/server/actions/booking";
import { submitLeadForm } from "@/server/actions/lead";
import { insertFormLead, visitorContext } from "@/server/leads";
import { deliverLeadCard } from "@/server/lead-delivery";
import { LEAD_FORM_DAILY_CAP, LEAD_FORM_DAILY_KEY, _resetForTests, checkLimit } from "@/lib/rate-limit";
import { addDaysStr, todayStr } from "@/lib/catalog/dates";
import { content } from "@theme/content";

const TODAY = todayStr();
const PRICE = 500;
const VID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const listing = (over: Record<string, unknown> = {}) => ({
  listing: {
    id: "l1", ownerUserId: "owner", status: "active", quantity: 1, title: "Велосипед", slug: "bike",
    priceDay: PRICE, priceWeek: null, priceMonth: null, minDays: 1, depositType: "money", depositAmount: 2000,
    ...over,
  },
  ownerBannedAt: null,
  ownerName: "ПикаВел",
  ownerPhone: null,
  citySlug: "krasnodar",
  categorySlug: "velo",
});

const selection = { listingId: "l1", from: TODAY, to: TODAY, qty: 1, priceDay: PRICE };
const phone = "+79000000000";

async function flushAfter() {
  for (const fn of state.after.splice(0)) await fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTests();
  state.after = [];
  state.vid = VID;
  state.ip = "1.2.3.4";
  authMock.mockResolvedValue(null);
  listingLimit.mockResolvedValue([listing()]);
  availWhere.mockResolvedValue([]);
  vi.mocked(insertFormLead).mockResolvedValue({ id: "LEAD1", code: "INR-4821" } as never);
  vi.mocked(visitorContext).mockResolvedValue({ internal: false, ymClientId: null, utm: null });
});

describe("submitLeadForm: коды ошибок совпадают с createBookingRequest", () => {
  const cases: Array<{ name: string; rows?: unknown[]; avail?: unknown[]; input?: Record<string, unknown>; error: string }> = [
    { name: "нет объявления", rows: [], error: "listing_not_found" },
    { name: "скрытое объявление", rows: [listing({ status: "hidden" })], error: "listing_not_found" },
    { name: "прошедшие даты", input: { from: "2020-01-01", to: "2020-01-03" }, error: "dates_stale" },
    { name: "за горизонтом", input: { from: "2099-01-01", to: "2099-01-02" }, error: "dates_stale" },
    { name: "количество урезано", input: { qty: 3 }, error: "qty_stale" },
    { name: "цена сдвинулась", input: { priceDay: PRICE - 100 }, error: "price_stale" },
    { name: "появилась недельная", input: { priceWeek: "2000" }, error: "price_stale" },
    {
      name: "короче минимума",
      rows: [listing({ priceDay: null, priceWeek: 2250, minDays: 7 })],
      input: { priceDay: "", priceWeek: "2250", to: addDaysStr(TODAY, 2) },
      error: "min_days:7",
    },
    {
      name: "даты заняты",
      avail: [{ listingId: "l1", date: TODAY, bookedQty: 1, blockedQty: 0 }],
      error: `dates_taken:${TODAY}`,
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      authMock.mockResolvedValue({ user: { id: "u1", bannedAt: null } });
      if (c.rows) listingLimit.mockResolvedValue(c.rows);
      if (c.avail) availWhere.mockResolvedValue(c.avail);
      const booking = await createBookingRequest({ ...selection, phone, ...c.input });
      _resetForTests();
      const lead = await submitLeadForm({ ...selection, name: "Иван", phone, ...c.input });
      expect(booking).toEqual({ ok: false, error: c.error });
      expect(lead).toEqual(booking);
      expect(insertFormLead).not.toHaveBeenCalled();
    });
  }

  it("своё объявление при сессии — own_listing", async () => {
    authMock.mockResolvedValue({ user: { id: "owner", bannedAt: null } });
    const booking = await createBookingRequest({ ...selection, phone });
    const lead = await submitLeadForm({ ...selection, name: "Иван", phone });
    expect(booking).toEqual({ ok: false, error: "own_listing" });
    expect(lead).toEqual(booking);
  });

  it("забаненный при сессии — banned", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", bannedAt: new Date() } });
    expect(await submitLeadForm({ ...selection, name: "Иван", phone })).toEqual({ ok: false, error: "banned" });
  });
});

describe("submitLeadForm: заявка", () => {
  it("гость: заявка сразу отправлена, с кодом, карточка уходит в группу", async () => {
    const r = await submitLeadForm({ ...selection, name: "  Иван ", phone: "8 (900) 000-00-00" });
    expect(r).toEqual({ ok: true, data: { code: "INR-4821" } });
    const [values, deliver] = vi.mocked(insertFormLead).mock.calls[0];
    expect(deliver).toBe(true);
    expect(values).toMatchObject({
      customerName: "Иван", customerPhone: "+79000000000", listingId: "l1", listingTitle: "Велосипед",
      listingPath: "/krasnodar/velo/bike-l1", dateFrom: TODAY, dateTo: TODAY, qty: 1, total: PRICE,
      visitorId: VID, internal: false,
    });
    await flushAfter();
    expect(deliverLeadCard).toHaveBeenCalledWith("LEAD1");
  });

  it("имя и телефон — тексты формы", async () => {
    expect(await submitLeadForm({ ...selection, name: " ", phone }))
      .toEqual({ ok: false, error: content.booking.leadForm.nameRequired });
    expect(await submitLeadForm({ ...selection, name: "Иван", phone: "12" }))
      .toEqual({ ok: false, error: content.booking.leadForm.phoneInvalid });
  });

  it("honeypot — правдоподобный успех без записи", async () => {
    const r = await submitLeadForm({ ...selection, name: "Иван", phone, website: "http://spam" });
    expect(r.ok && r.data.code).toMatch(/^INR-\d{4}$/);
    expect(insertFormLead).not.toHaveBeenCalled();
  });

  it("админ — тестовая заявка (internal)", async () => {
    authMock.mockResolvedValue({ user: { id: "a1", role: "admin", bannedAt: null } });
    await submitLeadForm({ ...selection, name: "Иван", phone });
    expect(vi.mocked(insertFormLead).mock.calls[0][0].internal).toBe(true);
  });

  it("повтор с того же браузера за 10 с — rate_limited", async () => {
    await submitLeadForm({ ...selection, name: "Иван", phone });
    const r = await submitLeadForm({ ...selection, name: "Иван", phone: "+79000000001" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^rate_limited:\d+$/);
  });

  it("один номер — не больше трёх заявок в сутки, с какого браузера ни шли бы", async () => {
    for (let i = 0; i < 3; i++) {
      state.vid = undefined;
      state.ip = `10.0.0.${i}`;
      expect((await submitLeadForm({ ...selection, name: "Иван", phone })).ok).toBe(true);
    }
    state.ip = "10.0.0.9";
    const r = await submitLeadForm({ ...selection, name: "Иван", phone });
    expect(!r.ok && r.error).toMatch(/^rate_limited:/);
  });

  it("отказ проверки выбора не тратит слоты номера", async () => {
    for (let i = 0; i < 3; i++) {
      state.vid = undefined;
      state.ip = `10.0.1.${i}`;
      const r = await submitLeadForm({ ...selection, name: "Иван", phone, priceDay: PRICE - 100 });
      expect(r).toEqual({ ok: false, error: "price_stale" });
    }
    state.ip = "10.0.1.9";
    expect((await submitLeadForm({ ...selection, name: "Иван", phone })).ok).toBe(true);
  });

  it("ошибка базы при записи — текст в форме, а не исключение", async () => {
    vi.mocked(insertFormLead).mockRejectedValueOnce(Object.assign(new Error("db"), { code: "57P01" }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await submitLeadForm({ ...selection, name: "Иван", phone });
    expect(r).toEqual({ ok: false, error: "generic" });
    expect(spy).toHaveBeenCalledWith("[leads] заявка формы не записана:", "57P01");
    expect(state.after).toHaveLength(0);
    spy.mockRestore();
  });

  it("сверх суточного потолка — заявка пишется, но в группу не идёт", async () => {
    for (let i = 0; i < LEAD_FORM_DAILY_CAP; i++) checkLimit(LEAD_FORM_DAILY_KEY, "lead_form_daily");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await submitLeadForm({ ...selection, name: "Иван", phone });
    expect(r.ok).toBe(true);
    expect(vi.mocked(insertFormLead).mock.calls[0][1]).toBe(false);
    await flushAfter();
    expect(deliverLeadCard).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
