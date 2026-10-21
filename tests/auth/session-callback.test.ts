// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import { buildEdgeConfig } from "@/lib/auth/config.edge";

// auth() отдаёт сессию через JSON: даты в ней — строки ISO. Свежесть аккаунта
// для цели `signup` едет так же, а не объектом Date, которого на странице нет.
describe("session callback", () => {
  const run = (user: Record<string, unknown>) => {
    const session = { user: {}, expires: "" } as unknown as Session;
    const cb = buildEdgeConfig().callbacks!.session! as unknown as (a: unknown) => Session;
    return cb({ session, user: { id: "u1", role: "user", bannedAt: null, banReason: null, ...user } });
  };

  it("кладёт создание и подтверждение почты строками ISO", () => {
    const s = run({
      createdAt: new Date("2026-10-21T10:00:00.000Z"),
      emailVerified: new Date("2026-10-21T11:00:00.000Z"),
    });
    expect(s.user.signup).toEqual({
      createdAt: "2026-10-21T10:00:00.000Z",
      emailVerified: "2026-10-21T11:00:00.000Z",
    });
  });

  it("у OAuth подтверждения нет — null", () => {
    const s = run({ createdAt: new Date("2026-10-21T10:00:00.000Z"), emailVerified: null });
    expect(s.user.signup).toEqual({ createdAt: "2026-10-21T10:00:00.000Z", emailVerified: null });
  });

  it("сохраняет роль и бан, как раньше", () => {
    const s = run({ role: "admin", createdAt: new Date(), emailVerified: null });
    expect(s.user).toMatchObject({ id: "u1", role: "admin", bannedAt: null, banReason: null });
  });
});
