// @vitest-environment node
// POST /api/leads/draft: маяк черновика для бота. Ответ всегда 204; строка —
// только у прошедшего схему и лимиты. Провал проверки выбора — тоже строка, с
// invalid_reason; повтор токена — тихий успех; internal — у своего браузера и
// у админа. База — моки server/leads и проверки выбора.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ after: [] as (() => unknown)[] }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    state.after.push(fn);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/server/booking-check", () => ({ checkBookingSelection: vi.fn() }));
vi.mock("@/server/lead-delivery", () => ({ retryUndeliveredCards: vi.fn(async () => {}) }));
vi.mock("@/server/leads", async (importOriginal) => ({
  // snapshotColumns — чистая функция, остальное ходит в базу.
  snapshotColumns: (await importOriginal<typeof import("@/server/leads")>()).snapshotColumns,
  insertLeadDraft: vi.fn(async () => "created"),
  pruneLeadDrafts: vi.fn(async () => {}),
  visitorContext: vi.fn(async () => ({ internal: false, ymClientId: null, utm: null })),
}));

import { POST } from "@/app/api/leads/draft/route";
import { auth } from "@/lib/auth";
import { checkBookingSelection, type ListingSnapshot } from "@/server/booking-check";
import { insertLeadDraft, pruneLeadDrafts, visitorContext } from "@/server/leads";
import { retryUndeliveredCards } from "@/server/lead-delivery";
import { _resetForTests } from "@/lib/rate-limit";
import { addDaysStr, todayStr } from "@/lib/catalog/dates";
import { enableTelegramEnv } from "../fixtures/leads";

const VID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const FROM = addDaysStr(todayStr(), 1);
const TO = addDaysStr(todayStr(), 3);
const BODY = { token: TOKEN, listingId: "L1", from: FROM, to: TO, qty: 1, priceDay: 500 };

const SNAPSHOT: ListingSnapshot = {
  listingId: "L1", ownerUserId: "owner", title: "Велосипед", path: "/krasnodar/velo/bike-L1",
  ownerName: "ПикаВел", ownerPhone: "+79282218754",
  priceDay: 500, priceWeek: null, priceMonth: null, depositType: "money", depositAmount: 3000,
};

let disableEnv: () => void;
beforeAll(() => {
  disableEnv = enableTelegramEnv();
});
afterAll(() => disableEnv());

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTests();
  state.after = [];
  vi.mocked(auth).mockResolvedValue(null as never);
  vi.mocked(visitorContext).mockResolvedValue({ internal: false, ymClientId: null, utm: null });
  vi.mocked(insertLeadDraft).mockResolvedValue("created");
  vi.mocked(checkBookingSelection).mockResolvedValue({
    ok: true, listing: {} as never, snapshot: SNAPSHOT, sel: { from: FROM, to: TO, qty: 1 }, total: 1500,
  });
});

function request(body: unknown, { vid = VID, cookie = "", ip = "1.2.3.4", raw }: {
  vid?: string | null; cookie?: string; ip?: string; raw?: string;
} = {}) {
  const cookies = [vid ? `vid=${vid}` : "", cookie].filter(Boolean).join("; ");
  return new NextRequest("http://localhost:3000/api/leads/draft", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "x-forwarded-for": ip,
      ...(cookies ? { cookie: cookies } : {}),
    },
  });
}

async function send(body: unknown = BODY, opts?: Parameters<typeof request>[1]) {
  const res = await POST(request(body, opts));
  for (const fn of state.after.splice(0)) await fn();
  return res;
}

const inserted = () => vi.mocked(insertLeadDraft).mock.calls.map((c) => c[0]);

describe("/api/leads/draft", () => {
  it("валидный выбор — черновик со снимком, суммой и токеном; ответ 204", async () => {
    const res = await send();
    expect(res.status).toBe(204);
    expect(inserted()).toHaveLength(1);
    expect(inserted()[0]).toMatchObject({
      startToken: TOKEN, invalidReason: null, listingId: "L1", listingTitle: "Велосипед",
      listingPath: "/krasnodar/velo/bike-L1", ownerName: "ПикаВел", ownerPhone: "+79282218754",
      dateFrom: FROM, dateTo: TO, qty: 1, priceDay: 500, depositType: "money", total: 1500,
      visitorId: VID, internal: false,
    });
    // Ленивые чистка и повтор карточек — после ответа.
    expect(pruneLeadDrafts).toHaveBeenCalled();
    expect(retryUndeliveredCards).toHaveBeenCalled();
  });

  it("zod: чужой токен, мусор и не JSON — 204 без строки", async () => {
    for (const body of [
      { ...BODY, token: "short" },
      { ...BODY, token: "x".repeat(22) + "!" },
      { ...BODY, from: "завтра" },
      { ...BODY, qty: 0 },
    ]) {
      expect((await send(body)).status).toBe(204);
    }
    expect((await send(null, { raw: "{" })).status).toBe(204);
    expect(insertLeadDraft).not.toHaveBeenCalled();
    expect(checkBookingSelection).not.toHaveBeenCalled();
  });

  it("слишком большое тело — 204 без строки", async () => {
    await send(null, { raw: JSON.stringify({ ...BODY, pad: "x".repeat(5000) }) });
    expect(insertLeadDraft).not.toHaveBeenCalled();
  });

  it("лимит по vid: 31-й черновик в час не пишется", async () => {
    for (let i = 0; i < 30; i++) await send();
    expect(inserted()).toHaveLength(30);
    await send();
    expect(inserted()).toHaveLength(30);
  });

  it("лимит по IP держит и без vid (отказ от учёта)", async () => {
    for (let i = 0; i < 200; i++) await send(BODY, { vid: null, ip: "5.5.5.5" });
    expect(inserted()).toHaveLength(200);
    expect(inserted()[0].visitorId).toBeNull();
    await send(BODY, { vid: null, ip: "5.5.5.5" });
    expect(inserted()).toHaveLength(200);
  });

  it("провал проверки — строка с invalid_reason и снимком", async () => {
    vi.mocked(checkBookingSelection).mockResolvedValue({ ok: false, error: "min_days:3", snapshot: SNAPSHOT });
    await send();
    expect(inserted()[0]).toMatchObject({ invalidReason: "min_days:3", listingTitle: "Велосипед", total: null });
  });

  it("объявления нет — строка без снимка, даты по порядку даже у мусорного выбора", async () => {
    vi.mocked(checkBookingSelection).mockResolvedValue({ ok: false, error: "listing_not_found", snapshot: null });
    await send({ ...BODY, from: TO, to: FROM });
    const row = inserted()[0];
    expect(row.invalidReason).toBe("listing_not_found");
    expect(row).not.toHaveProperty("listingId");
    expect(row).not.toHaveProperty("priceDay");
    expect(row.dateFrom <= row.dateTo).toBe(true);
  });

  it("прошедшие даты — dates_stale, а в строку идут настоящие даты", async () => {
    vi.mocked(checkBookingSelection).mockResolvedValue({ ok: false, error: "dates_stale", snapshot: SNAPSHOT });
    await send({ ...BODY, from: "2020-01-01", to: "2020-01-03" });
    const row = inserted()[0];
    expect(row.invalidReason).toBe("dates_stale");
    expect(row.dateFrom >= todayStr()).toBe(true);
  });

  it("повтор токена — тихий успех", async () => {
    vi.mocked(insertLeadDraft).mockResolvedValue("duplicate");
    expect((await send()).status).toBe(204);
  });

  it("ошибка базы — всё равно 204, в лог только код", async () => {
    vi.mocked(insertLeadDraft).mockRejectedValue(Object.assign(new Error("insert … +79000000000"), { code: "23514" }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await send()).status).toBe(204);
    expect(spy).toHaveBeenCalledWith("[leads] черновик не записан:", "23514");
    spy.mockRestore();
  });

  it("internal: браузер помечен «свои»", async () => {
    vi.mocked(visitorContext).mockResolvedValue({ internal: true, ymClientId: null, utm: null });
    await send();
    expect(inserted()[0].internal).toBe(true);
  });

  it("internal: сессия админа; viewer уходит в проверку (own_listing)", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin1", role: "admin" } } as never);
    await send(BODY, { cookie: "authjs.session-token=t" });
    expect(inserted()[0].internal).toBe(true);
    expect(checkBookingSelection).toHaveBeenCalledWith(expect.anything(), { userId: "admin1" });
  });

  it("без куки сессии auth() не зовётся", async () => {
    await send();
    expect(auth).not.toHaveBeenCalled();
    expect(checkBookingSelection).toHaveBeenCalledWith(expect.anything(), null);
  });

  it("забаненный аккаунт — invalid_reason banned", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "user", bannedAt: new Date() } } as never);
    await send(BODY, { cookie: "authjs.session-token=t" });
    expect(inserted()[0].invalidReason).toBe("banned");
  });

  it("метки и ClientID из тела чистятся; без них — из статистики браузера", async () => {
    await send({
      ...BODY,
      utm: { utm_source: "yandex", utm_term: "позвоните +7 900 000-00-00", gclid: "x" },
      ymClientId: "1700000000123456789",
    });
    expect(inserted()[0].utm).toEqual({ utm_source: "yandex", utm_term: expect.not.stringContaining("900") });
    expect(inserted()[0].ymClientId).toBe("1700000000123456789");

    vi.mocked(visitorContext).mockResolvedValue({ internal: false, ymClientId: "42", utm: { utm_source: "yandex" } });
    await send({ ...BODY, ymClientId: "not-digits" });
    expect(inserted()[1]).toMatchObject({ utm: { utm_source: "yandex" }, ymClientId: "42" });
  });

  it("без бота — 204 без строки", async () => {
    disableEnv();
    try {
      await send();
      expect(insertLeadDraft).not.toHaveBeenCalled();
    } finally {
      disableEnv = enableTelegramEnv();
    }
  });
});
