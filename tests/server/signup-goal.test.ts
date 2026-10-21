// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Способ регистрации для цели `signup`: свежесть — по сессии, без базы; в
// accounts идём только за аккаунтом, созданным только что.
const db = vi.hoisted(() => ({ providers: [] as string[], fail: false, selects: 0 }));
vi.mock("@/lib/db", () => {
  const chain: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (rows: unknown[]) => void, reject: (e: unknown) => void) => {
          db.selects++;
          if (db.fail) return reject(new Error("db down"));
          resolve(db.providers.map((provider) => ({ provider })));
        };
      }
      return () => chain;
    },
  });
  return { getDb: () => ({ select: () => chain }) };
});

import { freshSignupMethod } from "@/server/signup-goal";
import { SIGNUP_GOAL_WINDOW_MS } from "@/lib/analytics/signup";

const now = Date.parse("2026-10-21T12:00:00.000Z");
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

beforeEach(() => {
  db.providers = [];
  db.fail = false;
  db.selects = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("freshSignupMethod", () => {
  it("давний аккаунт — null, в базу не ходит", async () => {
    const user = { id: "u1", createdAt: iso(SIGNUP_GOAL_WINDOW_MS + 1), emailVerified: null };
    expect(await freshSignupMethod(user, now)).toBeNull();
    expect(db.selects).toBe(0);
  });

  it("свежий OAuth — провайдер из accounts", async () => {
    db.providers = ["yandex"];
    expect(await freshSignupMethod({ id: "u1", createdAt: iso(5000), emailVerified: null }, now)).toBe("yandex");
    db.providers = ["vk"];
    expect(await freshSignupMethod({ id: "u1", createdAt: iso(5000), emailVerified: null }, now)).toBe("vk");
  });

  it("почта, подтверждённая только что, — email", async () => {
    const user = { id: "u1", createdAt: iso(3 * 86_400_000), emailVerified: iso(2000) };
    expect(await freshSignupMethod(user, now)).toBe("email");
  });

  it("сбой базы — null, шапка не падает", async () => {
    db.fail = true;
    expect(await freshSignupMethod({ id: "u1", createdAt: iso(1000), emailVerified: null }, now)).toBeNull();
  });
});
