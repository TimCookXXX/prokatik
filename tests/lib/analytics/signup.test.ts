import { describe, expect, it } from "vitest";
import {
  SIGNUP_GOAL_WINDOW_MS, isFreshSignup, signupMethod, signupMoment,
} from "@/lib/analytics/signup";

const now = Date.parse("2026-10-21T12:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("signupMoment", () => {
  // Строка пользователя почты создаётся ещё при отправке формы, а войти можно
  // только после ссылки из письма — регистрация случилась тогда.
  it("у почты — подтверждение, у OAuth — создание", () => {
    expect(signupMoment({ createdAt: ago(86_400_000), emailVerified: ago(1000) })).toBe(now - 1000);
    expect(signupMoment({ createdAt: ago(5000), emailVerified: null })).toBe(now - 5000);
  });

  it("без дат — null", () => {
    expect(signupMoment({ createdAt: null, emailVerified: null })).toBeNull();
    expect(signupMoment({ createdAt: "мусор", emailVerified: null })).toBeNull();
  });
});

describe("isFreshSignup", () => {
  it("свежий — в пределах окна", () => {
    expect(isFreshSignup({ createdAt: ago(60_000), emailVerified: null }, now)).toBe(true);
    expect(isFreshSignup({ createdAt: ago(SIGNUP_GOAL_WINDOW_MS - 1), emailVerified: null }, now)).toBe(true);
    expect(isFreshSignup({ createdAt: ago(SIGNUP_GOAL_WINDOW_MS), emailVerified: null }, now)).toBe(false);
  });

  it("почту, брошенную давно и подтверждённую сейчас, считает свежей", () => {
    expect(isFreshSignup({ createdAt: ago(7 * 86_400_000), emailVerified: ago(10_000) }, now)).toBe(true);
  });

  it("давний аккаунт — не регистрация", () => {
    expect(isFreshSignup({ createdAt: ago(86_400_000), emailVerified: ago(86_000_000) }, now)).toBe(false);
  });

  it("отметка чуть из будущего (часы разошлись) — свежая", () => {
    expect(isFreshSignup({ createdAt: ago(-2000), emailVerified: null }, now)).toBe(true);
  });

  it("без дат — не свежий", () => {
    expect(isFreshSignup({ createdAt: null, emailVerified: null }, now)).toBe(false);
  });
});

describe("signupMethod", () => {
  it("по провайдеру из accounts, без них — почта", () => {
    expect(signupMethod(null, ["yandex"])).toBe("yandex");
    expect(signupMethod(null, ["vk"])).toBe("vk");
    expect(signupMethod("2026-10-21T11:59:00.000Z", [])).toBe("email");
    // Dev-логин и сид: ни провайдера, ни подтверждения.
    expect(signupMethod(null, [])).toBe("other");
  });
});
