// @vitest-environment node
// Запись статистики посещений: настоящий drizzle над фейковым клиентом pg,
// который запоминает SQL и параметры. Так видно, что уходит в базу: одна
// транзакция, upsert строки браузера, события с аккаунтом состояния, вход
// прежнего гостя — и суточный замок чистки по сроку.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  queries: [] as { text: string; params: unknown[] }[],
  updatedRows: [["prev"]] as unknown[][],
  fail: false,
}));

vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const client = {
    query: async (cfg: { text: string } | string, params: unknown[] = []) => {
      const text = typeof cfg === "string" ? cfg : cfg.text;
      db.queries.push({ text, params });
      if (db.fail && /^delete/.test(text)) throw Object.assign(new Error("boom"), { code: "57014" });
      if (/^update/.test(text) && /returning/.test(text)) return { rows: db.updatedRows, rowCount: db.updatedRows.length };
      return { rows: [], rowCount: 0 };
    },
  };
  const instance = drizzle(client as never);
  return { getDb: () => instance };
});

import {
  _resetPruneForTests, dbErrorCode, pruneVisitorData, writeVisitorBatch, type VisitorWrite,
} from "@/server/visitor-analytics";
import { EVENT_RETENTION_DAYS, VISITOR_RETENTION_DAYS } from "@/lib/analytics/limits";

const AT = new Date("2026-10-21T09:00:00.000Z");
const ev = (id: string, type = "pageview") => ({ id, type, createdAt: AT, path: "/", props: {} });

const base: VisitorWrite = {
  id: "11111111-2222-4333-8444-555555555555",
  userId: null,
  at: AT,
  device: "phone",
  isBot: false,
  isInternal: false,
  firstSource: { kind: "direct", label: "" },
  ymClientId: "123",
  events: [ev("01A"), ev("01B")],
};

const texts = () => db.queries.map((q) => q.text);

beforeEach(() => {
  db.queries = [];
  db.updatedRows = [["prev"]];
  db.fail = false;
  _resetPruneForTests();
});

describe("writeVisitorBatch", () => {
  it("одна транзакция: upsert строки браузера, затем события", async () => {
    await writeVisitorBatch(base);
    const t = texts();
    expect(t[0]).toBe("begin");
    expect(t[1]).toMatch(/^insert into "visitors"/);
    expect(t[1]).toMatch(/on conflict \("id"\) do update set/);
    expect(t[2]).toMatch(/^insert into "visitor_events"/);
    expect(t.at(-1)).toBe("commit");
  });

  it("время — UTC-строкой, не Date в зоне процесса", async () => {
    await writeVisitorBatch(base);
    const params = db.queries[1].params;
    expect(params).toContain("2026-10-21T09:00:00.000Z");
    expect(params.some((p) => p instanceof Date)).toBe(false);
  });

  it("upsert не перезаписывает аккаунт, первый источник и флаги", async () => {
    await writeVisitorBatch(base);
    const upsert = db.queries[1].text;
    expect(upsert).toContain('"user_id" = coalesce("visitors"."user_id", excluded.user_id)');
    expect(upsert).toContain('"first_source" = coalesce("visitors"."first_source", excluded.first_source)');
    expect(upsert).toContain('"is_bot" = "visitors"."is_bot" or excluded.is_bot');
    expect(upsert).toContain('"is_internal" = "visitors"."is_internal" or excluded.is_internal');
    expect(upsert).toContain('"last_seen_at" = greatest("visitors"."last_seen_at", excluded.last_seen_at)');
  });

  it("ClientID — только у гостя", async () => {
    await writeVisitorBatch({ ...base, userId: "u1" });
    expect(db.queries[1].params).not.toContain("123");
    db.queries = [];
    await writeVisitorBatch(base);
    expect(db.queries[1].params).toContain("123");
  });

  it("события — с аккаунтом состояния", async () => {
    await writeVisitorBatch({ ...base, userId: "u1", ymClientId: null });
    const insert = db.queries.find((q) => /^insert into "visitor_events"/.test(q.text))!;
    expect(insert.params.filter((p) => p === "u1")).toHaveLength(2);
    expect(insert.params.filter((p) => p === base.id)).toHaveLength(2);
  });

  it("вход гостя с историей: прежняя строка обновляется, её «вошёл» — без аккаунта", async () => {
    await writeVisitorBatch({
      ...base, id: "22222222-2222-4333-8444-555555555555", userId: "u1", ymClientId: null,
      events: [ev("01C", "login")],
      previous: { id: base.id, markInternal: true, events: [ev("01B", "login")] },
    });
    const t = texts();
    expect(t[1]).toMatch(/^update "visitors" set/);
    expect(db.queries[1].params).toContain("2026-10-21T09:00:00.000Z");
    expect(t[2]).toMatch(/^insert into "visitor_events"/);
    expect(db.queries[2].params).toEqual(expect.arrayContaining(["01B", base.id, null, "login"]));
    expect(db.queries[2].params).not.toContain("u1");
    expect(t[3]).toMatch(/^insert into "visitors"/);
  });

  // Прежний id мог удалить отказ от учёта: заводить его заново нельзя.
  it("прежней строки нет — её событие не пишется", async () => {
    db.updatedRows = [];
    await writeVisitorBatch({
      ...base, previous: { id: "gone", markInternal: false, events: [ev("01B", "login")] },
    });
    const t = texts();
    expect(t[1]).toMatch(/^update "visitors"/);
    expect(t[2]).toMatch(/^insert into "visitors"/);
    expect(t.filter((x) => /^insert into "visitor_events"/.test(x))).toHaveLength(1);
  });
});

describe("pruneVisitorData", () => {
  it("удаляет события старше срока и браузеры без активности", async () => {
    await pruneVisitorData(AT);
    expect(texts()).toEqual([
      expect.stringMatching(/^delete from "visitor_events" where "visitor_events"."created_at" < \$1/),
      expect.stringMatching(/^delete from "visitors" where "visitors"."last_seen_at" < \$1/),
    ]);
    const day = 24 * 60 * 60 * 1000;
    expect(db.queries[0].params).toEqual([new Date(AT.getTime() - EVENT_RETENTION_DAYS * day).toISOString()]);
    expect(db.queries[1].params).toEqual([new Date(AT.getTime() - VISITOR_RETENTION_DAYS * day).toISOString()]);
  });

  it("раз в сутки на процесс", async () => {
    await pruneVisitorData(AT);
    await pruneVisitorData(new Date(AT.getTime() + 23 * 60 * 60 * 1000));
    expect(texts()).toHaveLength(2);
    await pruneVisitorData(new Date(AT.getTime() + 24 * 60 * 60 * 1000));
    expect(texts()).toHaveLength(4);
  });

  it("одновременный вызов ждёт идущую чистку, а не запускает вторую", async () => {
    await Promise.all([pruneVisitorData(AT), pruneVisitorData(AT)]);
    expect(texts()).toHaveLength(2);
  });

  it("сбой — повтор через час, а не через сутки; в лог только код", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.fail = true;
    await pruneVisitorData(AT);
    expect(log).toHaveBeenCalledWith(expect.any(String), "57014");
    db.fail = false;
    db.queries = [];
    await pruneVisitorData(new Date(AT.getTime() + 30 * 60 * 1000));
    expect(texts()).toHaveLength(0);
    await pruneVisitorData(new Date(AT.getTime() + 60 * 60 * 1000));
    expect(texts()).toHaveLength(2);
    log.mockRestore();
  });
});

describe("dbErrorCode", () => {
  it("код из cause или самой ошибки, иначе unknown", () => {
    expect(dbErrorCode({ cause: { code: "23503" } })).toBe("23503");
    expect(dbErrorCode({ code: "40001" })).toBe("40001");
    expect(dbErrorCode(new Error("Failed query: ... params: secret"))).toBe("unknown");
  });
});
