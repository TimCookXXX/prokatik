// @vitest-environment node
// Раздел «Аналитика» в админке. Чтения проверяют роль сами и до базы без неё
// не доходят; каждое сначала зовёт чистку по сроку хранения. Поиск гостя
// уходит в базу параметром и равенством. Action «Это я» без роли отказывает,
// мусор отклоняет zod.
//
// База — настоящий drizzle над фейковым клиентом pg, который запоминает SQL и
// параметры и отвечает пустым результатом.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: [] as { text: string; params: unknown[] }[],
  updatedRows: [] as unknown[][],
}));

const { authMock, pruneMock, revalidateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  pruneMock: vi.fn(async () => {}),
  revalidateMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/server/visitor-analytics", () => ({ pruneVisitorData: pruneMock }));
vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const client = {
    query: async (cfg: { text: string } | string, params: unknown[] = []) => {
      const text = typeof cfg === "string" ? cfg : cfg.text;
      state.queries.push({ text, params: (typeof cfg === "string" ? params : (cfg as { values?: unknown[] }).values) ?? params });
      if (/^update/.test(text)) return { rows: state.updatedRows, rowCount: state.updatedRows.length };
      return { rows: [], rowCount: 0 };
    },
  };
  const instance = drizzle(client as never);
  return { getDb: () => instance };
});

import * as reads from "@/server/analytics-admin";
import { adminSetVisitorInternal } from "@/server/actions/analytics-admin";
import { parseVisitorListFilters } from "@/lib/analytics/admin-filters";

const VID = "d7540424-a1c8-4e80-bb7f-38368f5406b2";
const NOW = new Date("2026-10-21T09:00:00Z");
const ADMIN = { user: { id: "a1", role: "admin", bannedAt: null } };

const calls: [string, () => Promise<unknown>][] = [
  ["adminVisitorSummary", () => reads.adminVisitorSummary({ period: 7, all: false }, NOW)],
  ["adminListVisitors", () => reads.adminListVisitors(parseVisitorListFilters({}))],
  ["adminVisitorCard", () => reads.adminVisitorCard(VID)],
  ["adminSearchStats", () => reads.adminSearchStats({ period: 30, all: true }, NOW)],
];

const sessions = {
  "аноним": null,
  "пользователь": { user: { id: "u1", role: "user", bannedAt: null } },
  "модератор": { user: { id: "u2", role: "moderator", bannedAt: null } },
};

beforeEach(() => {
  state.queries = [];
  state.updatedRows = [];
  authMock.mockReset();
  pruneMock.mockClear();
  revalidateMock.mockClear();
});

describe("чтения src/server/analytics-admin.ts", () => {
  it("модуль отдаёт все чтения, и каждое — в списке проверки", () => {
    const exported = Object.entries(reads).filter(([, v]) => typeof v === "function").map(([k]) => k)
      .filter((k) => k.startsWith("admin"));
    expect(exported.sort()).toEqual(calls.map(([name]) => name).sort());
  });

  for (const [who, session] of Object.entries(sessions)) {
    it.each(calls)(`%s: ${who} уходит в redirect, база не читается и не чистится`, async (_name, read) => {
      authMock.mockResolvedValue(session);
      await expect(read()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
      expect(state.queries).toEqual([]);
      expect(pruneMock).not.toHaveBeenCalled();
    });
  }

  it.each(calls)("%s: админу отвечает, сначала чистка по сроку", async (_name, read) => {
    authMock.mockResolvedValue(ADMIN);
    await expect(read()).resolves.toBeDefined();
    expect(pruneMock).toHaveBeenCalledTimes(1);
  });
});

describe("запросы", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN));

  it("сводка: период от московской полуночи, дни по Москве, итог без повторов", async () => {
    const summary = await reads.adminVisitorSummary({ period: 7, all: false }, NOW);
    expect(summary.since).toBe("2026-10-15");
    expect(summary.days.map((d) => d.day)).toEqual([
      "2026-10-21", "2026-10-20", "2026-10-19", "2026-10-18", "2026-10-17", "2026-10-16", "2026-10-15",
    ]);
    const activity = state.queries.find((q) => q.text.includes("visitor_events e"))!;
    expect(activity.params).toContain("2026-10-15");
    expect(activity.params).toContain("Europe/Moscow");
    expect(activity.text).toContain("grouping sets");
    expect(activity.text).toContain("not v.is_bot and not v.is_internal");
  });

  it("«с ботами и своими» снимает фильтр и у событий, и у заявок с регистрациями", async () => {
    await reads.adminVisitorSummary({ period: 30, all: true }, NOW);
    expect(state.queries.some((q) => /is_bot|is_internal|role <> 'admin'/.test(q.text))).toBe(false);
  });

  it("поиск по ClientID — параметром и равенством, по нынешнему значению и истории", async () => {
    const cid = "1697712345123456789";
    await reads.adminListVisitors(parseVisitorListFilters({ find: cid }));
    const list = state.queries.find((q) => q.text.includes('from "visitors"'))!;
    expect(list.text).not.toContain(cid);
    expect(list.text).not.toMatch(/like/i);
    expect(list.text).toMatch(/"ym_client_id" = \$\d+/);
    expect(list.text).toMatch(/->>'cid' = \$\d+/);
    expect(list.params.filter((p) => p === cid)).toHaveLength(2);
  });

  it("курсор — парой (last_seen_at, id) параметрами", async () => {
    await reads.adminListVisitors(parseVisitorListFilters({ after: `2026-10-21T10:00:00.000004_${VID}` }));
    const list = state.queries.find((q) => q.text.includes('from "visitors"'))!;
    expect(list.text).toMatch(/\(visitors\.last_seen_at, visitors\.id\) <\s+\(\$\d+::timestamp, \$\d+::uuid\)/);
    expect(list.params).toEqual(expect.arrayContaining(["2026-10-21T10:00:00.000004", VID]));
  });

  it("карточка: id не UUID — нет такой, в базу не ходит", async () => {
    expect(await reads.adminVisitorCard("'; drop table visitors; --")).toBeNull();
    expect(state.queries).toEqual([]);
  });
});

describe("adminSetVisitorInternal", () => {
  it.each(Object.entries(sessions))("%s — forbidden, база не трогается", async (_who, session) => {
    authMock.mockResolvedValue(session);
    expect(await adminSetVisitorInternal(VID, true)).toEqual({ ok: false, error: "forbidden" });
    expect(state.queries).toEqual([]);
  });

  it.each([
    ["не UUID", "abc", true],
    ["не boolean", VID, "yes"],
  ])("%s — invalid_input", async (_name, id, internal) => {
    authMock.mockResolvedValue(ADMIN);
    expect(await adminSetVisitorInternal(id, internal)).toEqual({ ok: false, error: "invalid_input" });
    expect(state.queries).toEqual([]);
  });

  it("админ помечает браузер своим и обновляет страницы аналитики", async () => {
    authMock.mockResolvedValue(ADMIN);
    state.updatedRows = [[VID]];
    expect(await adminSetVisitorInternal(VID.toUpperCase(), true)).toEqual({ ok: true });
    const update = state.queries.find((q) => /^update "visitors"/.test(q.text))!;
    expect(update.text).toContain('"is_internal" = $1');
    expect(update.params).toEqual([true, VID]);
    expect(revalidateMock).toHaveBeenCalledWith("/admin/visitors", "layout");
  });

  it("нет такого браузера — not_found", async () => {
    authMock.mockResolvedValue(ADMIN);
    expect(await adminSetVisitorInternal(VID, false)).toEqual({ ok: false, error: "not_found" });
  });
});
