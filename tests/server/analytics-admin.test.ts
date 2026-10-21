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
  /** Ответ запроса активности сводки (db.execute — строки объектами). */
  activityRows: [] as Record<string, unknown>[],
  /** Строка карточки и её события — массивами, в порядке полей select. */
  cardRows: [] as unknown[][],
  eventRows: [] as unknown[][],
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
      if (text.includes("with ev as")) return { rows: state.activityRows, rowCount: state.activityRows.length };
      if (/from "visitors" left join "users".* where "visitors"."id" = /s.test(text)) return { rows: state.cardRows, rowCount: state.cardRows.length };
      if (/^select .* from "visitor_events" where "visitor_events"."visitor_id" = /s.test(text)) return { rows: state.eventRows, rowCount: state.eventRows.length };
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
  state.activityRows = [];
  state.cardRows = [];
  state.eventRows = [];
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
    // Итог периода — отдельной строкой с day = null, люди без повторов.
    expect(activity.text).toMatch(/union all\s+select null as day/);
    expect(activity.text).toContain("not v.is_bot and not v.is_internal");
  });

  // «10 человек · 8 новых · 5 вернулись» читалось как ошибка: новые и
  // вернувшиеся делят людей без остатка — и за день, и за период.
  it("новые и приходившие раньше дают людей: итог — по первому дню в периоде, день — по первому дню", async () => {
    state.activityRows = [
      { day: "2026-10-21", people: 4, new: 1, searched: 2, zero: 1, viewed: 3, clicked: 1 },
      { day: null, people: 10, new: 6, searched: 5, zero: 2, viewed: 7, clicked: 3 },
    ];
    const summary = await reads.adminVisitorSummary({ period: 7, all: false }, NOW);
    expect(summary.totals).toMatchObject({ people: 10, new: 6, returned: 4 });
    expect(summary.days[0]).toMatchObject({ day: "2026-10-21", people: 4, new: 1, returned: 3 });
    const activity = state.queries.find((q) => q.text.includes("visitor_events e"))!;
    expect(activity.text).toContain("filter (where f.first_day = ev.day and not f.continued)");
    expect(activity.text).toMatch(/filter \(where f.first_day >= \$\d+::date and not f.continued\)/);
  });

  // Строка, начатая входом или выходом, — продолжение того, кто уже был.
  it("запись, начатая сменой аккаунта, новой не считается; аккаунт — по регистрации и ранней строке", async () => {
    await reads.adminVisitorSummary({ period: 7, all: false }, NOW);
    const activity = state.queries.find((q) => q.text.includes("visitor_events e"))!.text;
    expect(activity).toContain("v.first_source->>'kind' = 'account'");
    expect(activity).toContain("least(u.created_at, a.first_seen_at)");
    // Первый заход — по индексам: гость по PK, аккаунт по user_id, без join по выражению.
    expect(activity).toContain("join visitors v on v.id = p.guest_id");
    expect(activity).toContain("from visitors v where v.user_id = p.user_id");
    expect(activity).not.toMatch(/coalesce\(v.user_id, v.id::text\) = /);
  });

  // ClientID и отметка «вошёл» у прежнего гостя — не заход.
  it("служебные события в сводке не считаются заходом", async () => {
    await reads.adminVisitorSummary({ period: 7, all: false }, NOW);
    const activity = state.queries.find((q) => q.text.includes("visitor_events e"))!.text;
    expect(activity).toContain("e.type not in ('ym_client', 'login')");
  });

  // /search без запроса — «весь каталог» с главной, а не поиск.
  it("«искали» и «ничего не нашли» — только поиски с запросом", async () => {
    await reads.adminVisitorSummary({ period: 7, all: false }, NOW);
    const activity = state.queries.find((q) => q.text.includes("visitor_events e"))!.text;
    expect(activity).toContain("filter (where ev.type = 'search' and ev.q is not null)::int as searched");
    expect(activity).toMatch(/ev.type = 'search' and ev.q is not null and ev.props->>'reason' is not null/);
  });

  // Смена сортировки и листание — тот же поиск, перезагрузка — тот же просмотр.
  it("список гостей: поиски и просмотры — разные за день, дни — без служебных событий", async () => {
    await reads.adminListVisitors(parseVisitorListFilters({}));
    const list = state.queries.find((q) => q.text.includes('from "visitors"'))!.text;
    expect(list).toMatch(/count\(distinct \(lower\(e.q\), .*\)\)::int\s+from visitor_events e where e.visitor_id = visitors.id and e.type = 'search' and e.q is not null/s);
    expect(list).toMatch(/count\(distinct \(e.listing_id, .*\)\)::int\s+from visitor_events e where e.visitor_id = visitors.id and e.type = 'view_listing'/s);
    expect(list).toContain("e.type not in ('ym_client', 'login')");
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

  // Лента обрезана до последних CARD_EVENTS_MAX: шаги сделки раньше первого
  // показанного события ни в какой визит на экране не встанут и читались бы
  // как «на других устройствах».
  it("карточка: лента обрезана — шаги сделки с первого показанного события; дни — запросом без служебных", async () => {
    state.cardRows = [[
      VID, "2026-01-01 10:00:00", "2026-10-21 08:00:00", null, "phone", null, false, false,
      "2026-01-01 10:00:00", false, 42, "u1", "Марина", "m@example.ru", "2025-12-01 10:00:00", false,
    ]];
    // Новые первыми, на одно больше потолка.
    state.eventRows = Array.from({ length: reads.CARD_EVENTS_MAX + 1 }, (_, i) => {
      const at = new Date(Date.UTC(2026, 9, 21, 8, 0, 0) - i * 60_000).toISOString().replace("T", " ").replace("Z", "");
      return [`E${String(10_000 - i).padStart(5, "0")}`, "pageview", at, "/", null, null, null, {}, "u1"];
    });
    const card = await reads.adminVisitorCard(VID);
    expect(card?.truncated).toBe(true);
    expect(card?.visitor.days).toBe(42);
    const firstShown = card!.events[0].at.toISOString();
    const requests = state.queries.find((q) => q.text.includes('from "booking_requests"'))!;
    expect(requests.params).toContain(firstShown);
    expect(requests.params).not.toContain("2026-01-01T10:00:00.000Z");
    const cardQuery = state.queries.find((q) => /from "visitors" left join "users".* where "visitors"."id" = /s.test(q.text))!;
    expect(cardQuery.text).toContain("e.type not in ('ym_client', 'login')");
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
