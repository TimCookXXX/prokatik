// @vitest-environment node
// Счётчики в списках админки — подзапросы в полях select. В запросе без join
// drizzle пишет колонки без таблицы, и ${users.id} внутри подзапроса по
// listings становился "id" самих listings: счётчики молча показывали ноль.
// Здесь видно настоящий SQL: drizzle над фейковым клиентом pg.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: [] as string[] }));

vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "a1", role: "admin", bannedAt: null } }) }));
vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const client = {
    query: async (cfg: { text: string } | string) => {
      state.queries.push(typeof cfg === "string" ? cfg : cfg.text);
      return { rows: [], rowCount: 0 };
    },
  };
  const instance = drizzle(client as never);
  return { getDb: () => instance };
});

import { adminListCategories, adminListCities, adminListUsers } from "@/server/admin";

beforeEach(() => {
  state.queries = [];
});

/** Подзапросы в скобках из текста запроса. */
const subqueries = (text: string) => [...text.matchAll(/\(SELECT count\(\*\)::int FROM [^)]*\)/gi)].map((m) => m[0]);

describe("счётчики в списках админки", () => {
  it.each([
    ["пользователи", adminListUsers, "users.id", 3],
    ["города", adminListCities, "cities.id", 1],
    ["категории", adminListCategories, "categories.id", 2],
  ] as const)("%s: подзапрос ссылается на внешнюю строку по имени таблицы", async (_name, read, outer, n) => {
    await read();
    const subs = subqueries(state.queries[0]);
    expect(subs).toHaveLength(n);
    for (const sub of subs) {
      expect(sub).toContain(`= ${outer}`);
      expect(sub).not.toMatch(/= "id"/);
    }
  });
});
