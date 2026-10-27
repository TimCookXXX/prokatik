// @vitest-environment node
// Запросы server/leads.ts, от которых зависит бот: какой черновик активный,
// какие переходы условные и что делает повтор кода и токена. Построитель
// drizzle — мок, условия сверяются настоящим SQL (renderSql).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, captured, state } = vi.hoisted(() => {
  const captured = { where: [] as unknown[], orderBy: [] as unknown[], set: [] as Record<string, unknown>[], values: [] as Record<string, unknown>[] };
  const state = { rows: [] as unknown[], failures: [] as unknown[] };
  const result = async () => {
    const f = state.failures.shift();
    if (f) throw f;
    return state.rows;
  };
  const db = {
    select: vi.fn(() => ({
      from: () => ({
        where: (w: unknown) => {
          captured.where.push(w);
          return {
            orderBy: (o: unknown) => {
              captured.orderBy.push(o);
              return { limit: result };
            },
            limit: result,
          };
        },
      }),
    })),
    update: vi.fn(() => ({
      set: (s: Record<string, unknown>) => {
        captured.set.push(s);
        return { where: (w: unknown) => { captured.where.push(w); return { returning: result }; } };
      },
    })),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        captured.values.push(v);
        // Ленивый thenable: запрос «уходит» либо через await, либо через returning().
        return {
          then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => result().then(() => undefined).then(ok, fail),
          returning: result,
        };
      },
    })),
  };
  return { db, captured, state };
});
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/server/lead-delivery", () => ({ retryUndeliveredCards: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/assert-admin", () => ({ assertAdmin: vi.fn(async () => ({ userId: "a1" })) }));

import {
  activeDraftOf, bindDraft, insertFormLead, insertLeadDraft, markLeadSent, releaseDraftsOf, setLeadStatus,
} from "@/server/leads";
import { renderSql } from "../fixtures/render-sql";
import { LEAD_ID, leadRow } from "../fixtures/leads";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const unique = (constraint: string) => Object.assign(new Error("duplicate key"), { code: "23505", constraint });

beforeEach(() => {
  vi.clearAllMocks();
  captured.where.length = 0;
  captured.orderBy.length = 0;
  captured.set.length = 0;
  captured.values.length = 0;
  state.rows = [];
  state.failures = [];
});

describe("activeDraftOf", () => {
  it("черновик этого аккаунта, привязанный, моложе суток — последний по bound_at", async () => {
    await activeDraftOf(42, NOW);
    const where = renderSql(captured.where[0]);
    expect(where).toContain(`"booking_leads"."tg_user_id" = 42`);
    expect(where).toContain(`"booking_leads"."status" = 'draft'`);
    expect(where).toContain(`"booking_leads"."bound_at" is not null`);
    expect(where).toContain(`"booking_leads"."created_at" >= '2026-10-26T12:00:00.000Z'`);
    expect(renderSql(captured.orderBy[0])).toBe(`"booking_leads"."bound_at" desc`);
  });
});

describe("переходы", () => {
  it("привязка — только черновика, свободного или своего", async () => {
    await bindDraft(LEAD_ID, { userId: 42, username: "ivan", name: "Иван" }, NOW);
    expect(captured.set[0]).toEqual({ tgUserId: 42, tgUsername: "ivan", tgName: "Иван", boundAt: NOW });
    const where = renderSql(captured.where[0]);
    expect(where).toContain(`"booking_leads"."status" = 'draft'`);
    expect(where).toContain(`("booking_leads"."tg_user_id" is null or "booking_leads"."tg_user_id" = 42)`);
  });

  it("гашение: bound_at черновиков аккаунта, tg_user_id остаётся", async () => {
    await releaseDraftsOf(42);
    expect(captured.set[0]).toEqual({ boundAt: null });
    const where = renderSql(captured.where[0]);
    expect(where).toContain(`"booking_leads"."tg_user_id" = 42`);
    expect(where).toContain(`"booking_leads"."status" = 'draft'`);
    expect(where).toContain(`"booking_leads"."bound_at" is not null`);
  });

  it("статус — из допустимых источников и только на своей карточке", async () => {
    await setLeadStatus(LEAD_ID, "taken", 777, "Тимур", NOW);
    expect(captured.set[0]).toEqual({ status: "taken", statusChangedAt: NOW, statusChangedBy: "Тимур" });
    const where = renderSql(captured.where[0]);
    expect(where).toContain(`"booking_leads"."status" in ('handed')`);
    expect(where).toContain(`"booking_leads"."group_message_id" = 777`);
  });

  it("пустой RETURNING — null", async () => {
    expect(await setLeadStatus(LEAD_ID, "handed", 777, "Тимур", NOW)).toBeNull();
  });

  it("отправка: условие на draft, коллизия кода — повтор с новым кодом", async () => {
    state.failures = [unique("booking_leads_code_unique")];
    state.rows = [leadRow({ status: "sent", code: "INR-0001" })];
    const snapshot = {
      listingId: "L", ownerUserId: "o", title: "t", path: "/p", ownerName: null, ownerPhone: null,
      priceDay: 1, priceWeek: null, priceMonth: null, depositType: "none" as const, depositAmount: null,
    };
    const row = await markLeadSent(LEAD_ID, { customerPhone: null, snapshot, total: 1 }, NOW);
    expect(row?.code).toBe("INR-0001");
    expect(captured.set).toHaveLength(2);
    expect(captured.set[1].code).toMatch(/^INR-\d{4}$/);
    expect(captured.set[1]).toMatchObject({ status: "sent", sentAt: NOW, cardNextAt: NOW });
    expect(renderSql(captured.where[1])).toContain(`"booking_leads"."status" = 'draft'`);
  });

  it("чужое нарушение уникальности не глотается", async () => {
    state.failures = [unique("some_other_uq")];
    await expect(insertFormLead({ dateFrom: "2026-10-28", dateTo: "2026-10-28" }, true, NOW)).rejects.toThrow("duplicate key");
  });
});

describe("вставки", () => {
  it("повтор токена черновика — duplicate, без ошибки", async () => {
    state.failures = [unique("booking_leads_start_token_unique")];
    expect(await insertLeadDraft({ startToken: "t", dateFrom: "2026-10-28", dateTo: "2026-10-28" }, NOW)).toBe("duplicate");
  });

  it("форма: сразу sent, с кодом; без доставки card_next_at пуст", async () => {
    state.rows = [leadRow({ status: "sent", channel: "form", code: "INR-1234" })];
    await insertFormLead({ dateFrom: "2026-10-28", dateTo: "2026-10-28" }, false, NOW);
    expect(captured.values[0]).toMatchObject({
      channel: "form", status: "sent", sentAt: NOW, createdAt: NOW, cardNextAt: null,
      code: expect.stringMatching(/^INR-\d{4}$/),
    });
  });
});
