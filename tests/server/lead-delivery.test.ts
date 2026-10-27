// @vitest-environment node
// Доставка карточки в группу: захват строки до sendMessage, расписание
// повторов и retry_after из 429. База — мок построителя drizzle, который
// запоминает set/where каждого UPDATE; условие захвата сверяется настоящим
// SQL (renderSql), а не обходом объекта.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { db, updates, state } = vi.hoisted(() => {
  const state = {
    claimRows: [] as unknown[],
    due: [] as { id: string }[],
  };
  const updates: { set: Record<string, unknown>; where: unknown }[] = [];
  const db = {
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: unknown) => {
          updates.push({ set, where });
          const rows = "cardClaimedAt" in set && set.cardClaimedAt instanceof Date ? state.claimRows : [];
          return Object.assign(Promise.resolve(undefined), { returning: async () => rows });
        },
      }),
    })),
    select: vi.fn(() => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => state.due }) }) }),
    })),
  };
  return { db, updates, state };
});
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/telegram/api", () => ({ callBot: vi.fn() }));

import {
  CARD_BACKOFF_MIN, _resetCardRetryForTests, nextCardAttemptAt, retryUndeliveredCards, sendLeadCard,
} from "@/server/lead-delivery";
import { callBot } from "@/lib/telegram/api";
import { ADMIN_CHAT, LEAD_ID, enableTelegramEnv, leadRow } from "../fixtures/leads";
import { renderSql } from "../fixtures/render-sql";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const MIN = 60_000;
const sent = (over = {}) => leadRow({ status: "sent", code: "INR-4821", sentAt: NOW, cardAttempts: 1, ...over });

let disableEnv: () => void;
beforeAll(() => {
  disableEnv = enableTelegramEnv();
});
afterAll(() => disableEnv());

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  state.claimRows = [];
  state.due = [];
  _resetCardRetryForTests();
});

describe("sendLeadCard: захват строки", () => {
  it("захват — условный UPDATE: не черновик, карточки нет, захвата нет или он старше 2 минут", async () => {
    await sendLeadCard(LEAD_ID, NOW);
    const claim = updates[0];
    expect(claim.set).toMatchObject({ cardClaimedAt: NOW });
    const where = renderSql(claim.where);
    expect(where).toContain(`"booking_leads"."id" = '${LEAD_ID}'`);
    expect(where).toContain(`"booking_leads"."status" <> 'draft'`);
    expect(where).toContain(`"booking_leads"."group_message_id" is null`);
    expect(where).toContain(`"booking_leads"."card_claimed_at" is null`);
    expect(where).toContain(`"booking_leads"."card_claimed_at" < '${new Date(NOW.getTime() - 2 * MIN).toISOString()}'`);
  });

  it("строку захватил другой путь — sendMessage не зовётся", async () => {
    const r = await sendLeadCard(LEAD_ID, NOW);
    expect(r).toEqual({ kind: "skipped" });
    expect(callBot).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
  });

  it("захватил — карточка уходит в админский чат, message_id пишется в строку", async () => {
    state.claimRows = [sent()];
    vi.mocked(callBot).mockResolvedValue({ ok: true, result: { message_id: 555 } });
    const r = await sendLeadCard(LEAD_ID, NOW);
    expect(r).toEqual({ kind: "sent", messageId: 555 });
    const [method, params] = vi.mocked(callBot).mock.calls[0];
    expect(method).toBe("sendMessage");
    expect(params).toMatchObject({ chat_id: ADMIN_CHAT, parse_mode: "HTML" });
    expect(String(params!.text)).toContain("<b>INR-4821</b>");
    expect(params!.reply_markup).toEqual({
      inline_keyboard: [[
        expect.objectContaining({ callback_data: `st:${LEAD_ID}:handed` }),
        expect.objectContaining({ callback_data: `st:${LEAD_ID}:declined` }),
      ]],
    });
    expect(updates[1].set).toEqual({ groupMessageId: 555, cardNextAt: null, cardClaimedAt: null });
  });

  it("без бота — ни захвата, ни вызова", async () => {
    disableEnv();
    try {
      expect(await sendLeadCard(LEAD_ID, NOW)).toEqual({ kind: "off" });
      expect(updates).toHaveLength(0);
    } finally {
      disableEnv = enableTelegramEnv();
    }
  });
});

describe("sendLeadCard: повторы", () => {
  it("отказ — следующая попытка по расписанию, захват снимается", async () => {
    state.claimRows = [sent({ cardAttempts: 3 })];
    vi.mocked(callBot).mockResolvedValue({ ok: false, description: "Bad Gateway", errorCode: 502, retryAfter: null });
    const r = await sendLeadCard(LEAD_ID, NOW);
    expect(r).toEqual({ kind: "failed", retryAfter: null });
    expect(updates[1].set).toEqual({ cardNextAt: new Date(NOW.getTime() + 5 * MIN), cardClaimedAt: null });
  });

  it("429 — пауза не короче retry_after", async () => {
    state.claimRows = [sent({ cardAttempts: 1 })];
    vi.mocked(callBot).mockResolvedValue({ ok: false, description: "Too Many Requests", errorCode: 429, retryAfter: 300 });
    await sendLeadCard(LEAD_ID, NOW);
    expect(updates[1].set.cardNextAt).toEqual(new Date(NOW.getTime() + 300_000));
  });

  it("расписание: 1, 2, 5, 15, 60 минут, дальше раз в час", () => {
    const at = (n: number) => (nextCardAttemptAt(n, NOW, NOW)!.getTime() - NOW.getTime()) / MIN;
    expect([1, 2, 3, 4, 5, 6, 12].map(at)).toEqual([1, 2, 5, 15, 60, 60, 60]);
    expect(CARD_BACKOFF_MIN).toEqual([1, 2, 5, 15, 60]);
    // retry_after меньше паузы ничего не меняет.
    expect(nextCardAttemptAt(4, NOW, NOW, 30)).toEqual(new Date(NOW.getTime() + 15 * MIN));
  });

  it("дольше суток с отправки — повторов больше нет", async () => {
    const sentAt = new Date(NOW.getTime() - 24 * 60 * MIN + 30 * MIN);
    expect(nextCardAttemptAt(5, sentAt, NOW)).toBeNull();
    state.claimRows = [sent({ cardAttempts: 9, sentAt })];
    vi.mocked(callBot).mockResolvedValue({ ok: false, description: "x", errorCode: null, retryAfter: null });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendLeadCard(LEAD_ID, NOW);
    expect(updates[1].set).toEqual({ cardNextAt: null, cardClaimedAt: null });
    spy.mockRestore();
  });
});

describe("retryUndeliveredCards", () => {
  it("досылает подошедшие по очереди и останавливается на первом отказе", async () => {
    state.due = [{ id: "A" }, { id: "B" }, { id: "C" }];
    state.claimRows = [sent()];
    vi.mocked(callBot)
      .mockResolvedValueOnce({ ok: true, result: { message_id: 1 } })
      .mockResolvedValueOnce({ ok: false, description: "Too Many Requests", errorCode: 429, retryAfter: 10 });
    await retryUndeliveredCards(NOW);
    expect(callBot).toHaveBeenCalledTimes(2);
  });

  it("не чаще раза в минуту на процесс", async () => {
    await retryUndeliveredCards(NOW);
    await retryUndeliveredCards(new Date(NOW.getTime() + 30_000));
    expect(db.select).toHaveBeenCalledTimes(1);
    await retryUndeliveredCards(new Date(NOW.getTime() + MIN));
    expect(db.select).toHaveBeenCalledTimes(2);
  });
});
