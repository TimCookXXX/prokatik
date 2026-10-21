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

  // Результат callback'а уходит браузеру по GET /api/auth/session — любому
  // скрипту страницы, включая чужой tag.js. Auth.js кладёт в аргументы токен
  // сессии и всю строку пользователя; наружу — только перечисленное.
  it("отдаёт только нужные поля: без токена сессии, хэша пароля и телефона", () => {
    const expires = new Date("2026-11-20T10:00:00.000Z");
    const row = {
      id: "u1", email: "a@ya.ru", name: "Аня", image: null, role: "user",
      bannedAt: null, banReason: null, phone: "+79990000000", passwordHash: "$argon2id$secret",
      cityId: "c1", bio: "о себе", createdAt: new Date("2026-10-21T10:00:00.000Z"), emailVerified: null,
    };
    const cb = buildEdgeConfig().callbacks!.session! as unknown as (a: unknown) => Record<string, unknown>;
    const out = cb({
      session: { sessionToken: "tok", userId: "u1", expires, user: row },
      user: row,
    });
    expect(Object.keys(out).sort()).toEqual(["expires", "user"]);
    expect(out.expires).toBe(expires);
    expect(Object.keys(out.user as object).sort()).toEqual(
      ["banReason", "bannedAt", "email", "id", "image", "name", "role", "signup"],
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain("tok");
    expect(json).not.toContain("argon2id");
    expect(json).not.toContain("+7999");
  });

  it("сохраняет роль и бан, как раньше", () => {
    const s = run({ role: "admin", createdAt: new Date(), emailVerified: null });
    expect(s.user).toMatchObject({ id: "u1", role: "admin", bannedAt: null, banReason: null });
  });
});
