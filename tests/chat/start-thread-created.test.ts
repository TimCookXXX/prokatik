// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// startThread сообщает, завёл ли переписку именно этот вызов (`created`): от
// этого зависит цель Метрики «Начал переписку». Тред, заведённый раньше —
// заметкой о заявке из другой вкладки или соседней вкладкой в гонке, — не
// начало: сообщение просто дописывается в него.

const state = vi.hoisted(() => ({
  existing: null as string | null,
  // Что вернёт INSERT … ON CONFLICT DO NOTHING RETURNING: пусто — конфликт.
  insertedThread: [] as Array<{ id: string }>,
  threadInserts: 0,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "01CUSTOMER", bannedAt: null } })),
}));
vi.mock("@/lib/rate-limit", () => ({ checkLimit: () => ({ ok: true }) }));
vi.mock("@/server/chat", () => ({
  findThreadByListing: vi.fn(async () => state.existing),
  getMessages: vi.fn(),
}));
vi.mock("@/server/notifications", () => ({ notify: vi.fn(async () => ({ inserted: true })) }));
vi.mock("@/server/realtime", () => ({ publish: vi.fn(async () => undefined) }));
vi.mock("@/lib/db", async () => {
  const { chatThreads } = await import("@db/schema");
  const tx = {
    insert: (table: unknown) => ({
      values: () => {
        if (table === chatThreads) {
          state.threadInserts++;
          return { onConflictDoNothing: () => ({ returning: async () => state.insertedThread }) };
        }
        return { returning: async () => [{ id: "01MSG", createdAt: new Date("2026-10-21T10:00:00Z") }] };
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "01THREAD" }] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [{ ownerUserId: "01OWNER", status: "active", ownerBannedAt: null }],
          }),
        }),
      }),
    }),
    transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  return { getDb: () => db };
});

const { startThread } = await import("@/server/actions/chat");

beforeEach(() => {
  state.existing = null;
  state.insertedThread = [];
  state.threadInserts = 0;
});

describe("startThread: created", () => {
  it("тред заведён этим вызовом — created", async () => {
    state.insertedThread = [{ id: "01THREAD" }];
    const res = await startThread({ listingId: "01LISTING", body: "Здравствуйте" });
    expect(res).toMatchObject({ ok: true, data: { threadId: "01THREAD", created: true } });
  });

  it("тред уже был (заметка о заявке) — дописано, не created", async () => {
    state.existing = "01THREAD";
    const res = await startThread({ listingId: "01LISTING", body: "Здравствуйте" });
    expect(res).toMatchObject({ ok: true, data: { threadId: "01THREAD", created: false } });
    expect(state.threadInserts).toBe(0);
  });

  it("гонка вкладок: вставку выиграл сосед — не created", async () => {
    state.insertedThread = [];
    const res = await startThread({ listingId: "01LISTING", body: "Здравствуйте" });
    expect(res).toMatchObject({ ok: true, data: { threadId: "01THREAD", created: false } });
    expect(state.threadInserts).toBe(1);
  });
});
