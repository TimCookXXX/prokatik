// @vitest-environment node
// Счётчики в списках админки — подзапросы в полях select. В запросе без join
// drizzle пишет колонки без таблицы, и ${users.id} внутри подзапроса по
// listings становился "id" самих listings: счётчики молча показывали ноль.
// Здесь видно настоящий SQL: drizzle над фейковым клиентом pg.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: [] as string[], params: [] as unknown[][], rows: [] as unknown[][] }));

vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "a1", role: "admin", bannedAt: null } }) }));
vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const client = {
    query: async (cfg: { text: string; values?: unknown[] } | string, params: unknown[] = []) => {
      state.queries.push(typeof cfg === "string" ? cfg : cfg.text);
      state.params.push((typeof cfg === "string" ? undefined : cfg.values) ?? params);
      return { rows: state.rows, rowCount: state.rows.length };
    },
  };
  const instance = drizzle(client as never);
  return { getDb: () => instance };
});

import { adminCounts, adminListCategories, adminListCities, adminListUsers } from "@/server/admin";

beforeEach(() => {
  state.queries = [];
  state.params = [];
  state.rows = [];
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

// Заявки без аккаунта, которые ещё никто не передал прокату (ADR 0028): только
// «новые» и без тестовых.
describe("adminCounts", () => {
  it("ждущие передачи заявки без аккаунта — sent и не internal", async () => {
    state.rows = [[3]];
    const counts = await adminCounts();
    expect(counts.leadsPending).toBe(3);
    const i = state.queries.findIndex((q) => q.includes('from "booking_leads"'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(state.queries[i]).toMatch(/"booking_leads"\."status" = \$1 and "booking_leads"\."internal" = \$2/);
    expect(state.params[i]).toEqual(["sent", false]);
  });
});
