// @vitest-environment node
// Отказ от учёта на этом устройстве (/privacy): удаляет строку браузера —
// события уходят каскадом, — стирает id и ставит куку отказа. БД и куки —
// фейки, которые запоминают, что с ними сделали.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  set: [] as { name: string; value: string; options: Record<string, unknown> }[],
  deleted: [] as string[],
  dbDeletes: [] as { table: unknown; where: unknown }[],
  dbFails: false,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { value: state.cookies.get(name)! } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      state.set.push({ name, value, options });
    },
    delete: (name: string) => {
      state.deleted.push(name);
    },
  }),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    delete: (table: unknown) => ({
      where: async (where: unknown) => {
        if (state.dbFails) throw new Error("db down");
        state.dbDeletes.push({ table, where });
      },
    }),
  }),
}));

import { optInToAnalytics, optOutOfAnalytics } from "@/server/actions/analytics";
import { visitors } from "@db/schema";

const VID = "0f8fad5b-d9cb-469f-a165-70867728950e";

beforeEach(() => {
  state.cookies.clear();
  state.set = [];
  state.deleted = [];
  state.dbDeletes = [];
  state.dbFails = false;
});

describe("optOutOfAnalytics", () => {
  it("удаляет строку этого браузера, стирает vid и ставит отказ", async () => {
    state.cookies.set("vid", VID);
    expect(await optOutOfAnalytics()).toEqual({ ok: true, data: undefined });
    expect(state.dbDeletes).toEqual([{ table: visitors, where: { column: visitors.id, value: VID } }]);
    expect(state.deleted).toEqual(["vid"]);
    expect(state.set).toHaveLength(1);
    expect(state.set[0]).toMatchObject({ name: "noanalytics", value: "1", options: { httpOnly: false, path: "/" } });
  });

  it("без куки id в базу не ходит, но отказ ставит", async () => {
    expect((await optOutOfAnalytics()).ok).toBe(true);
    expect(state.dbDeletes).toEqual([]);
    expect(state.set.map((c) => c.name)).toEqual(["noanalytics"]);
  });

  // В запрос уходит только UUID: кука правится руками.
  it("мусор в куке id в запрос не попадает", async () => {
    state.cookies.set("vid", "1' or '1'='1");
    expect((await optOutOfAnalytics()).ok).toBe(true);
    expect(state.dbDeletes).toEqual([]);
    expect(state.deleted).toEqual(["vid"]);
  });

  // Иначе повторить было бы нечем: id уже стёрт, а строка осталась бы.
  it("не удалось удалить — куки не трогает", async () => {
    state.cookies.set("vid", VID);
    state.dbFails = true;
    expect(await optOutOfAnalytics()).toEqual({ ok: false, error: "delete_failed" });
    expect(state.deleted).toEqual([]);
    expect(state.set).toEqual([]);
  });
});

describe("optInToAnalytics", () => {
  it("снимает отказ и больше ничего не делает", async () => {
    state.cookies.set("noanalytics", "1");
    expect(await optInToAnalytics()).toEqual({ ok: true, data: undefined });
    expect(state.deleted).toEqual(["noanalytics"]);
    expect(state.set).toEqual([]);
    expect(state.dbDeletes).toEqual([]);
  });
});
