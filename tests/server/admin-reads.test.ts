// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Чтения админки проверяют роль сами: layout Next не перерисовывает при
// переходах внутри сегмента, и проверка в нём одна не гарантия. Без роли admin
// чтение уходит в redirect, не дойдя до базы.
const { authMock, getDbMock } = vi.hoisted(() => ({ authMock: vi.fn(), getDbMock: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => {
  // Любая цепочка построителя отвечает пустым списком.
  const chain: unknown = new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (rows: unknown[]) => void) => resolve([{ c: 0 }]);
      return () => chain;
    },
  });
  getDbMock.mockImplementation(() => chain);
  return { getDb: getDbMock };
});

import * as admin from "@/server/admin";

const reads = Object.entries(admin).filter(([, v]) => typeof v === "function") as [
  string,
  () => Promise<unknown>,
][];

const sessions = {
  "аноним": null,
  "пользователь": { user: { id: "u1", role: "user", bannedAt: null } },
  "модератор": { user: { id: "u2", role: "moderator", bannedAt: null } },
};

beforeEach(() => {
  authMock.mockReset();
  getDbMock.mockClear();
});

describe("чтения src/server/admin.ts", () => {
  it("модуль отдаёт чтения", () => {
    expect(reads.map(([name]) => name)).toEqual(expect.arrayContaining([
      "adminListListings", "adminListCities", "adminListGeoRegions",
      "adminListCategories", "adminListRequests", "adminListUsers", "adminCounts",
    ]));
  });

  for (const [who, session] of Object.entries(sessions)) {
    it.each(reads)(`%s: ${who} уходит в redirect, база не читается`, async (_name, read) => {
      authMock.mockResolvedValue(session);
      await expect(read()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
      expect(getDbMock).not.toHaveBeenCalled();
    });
  }

  it.each(reads)("%s: админу отвечает", async (_name, read) => {
    authMock.mockResolvedValue({ user: { id: "a1", role: "admin", bannedAt: null } });
    await expect(read()).resolves.toBeDefined();
    expect(getDbMock).toHaveBeenCalled();
  });
});
