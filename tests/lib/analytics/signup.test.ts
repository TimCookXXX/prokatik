import { describe, expect, it } from "vitest";
import {
  SIGNUP_GOAL_WINDOW_MS, SIGNUP_SESSION_SKEW_MS, isFreshSignup, signupMethod, signupMoment,
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
  // Сессия выдана в момент регистрации: ссылка из письма, возврат с OAuth.
  const fresh = (createdAt: string | null, emailVerified: string | null = null) => ({
    createdAt, emailVerified, sessionIssuedAt: emailVerified ?? createdAt,
  });

  it("свежий — в пределах окна", () => {
    expect(isFreshSignup(fresh(ago(60_000)), now)).toBe(true);
    expect(isFreshSignup(fresh(ago(SIGNUP_GOAL_WINDOW_MS - 1)), now)).toBe(true);
    expect(isFreshSignup(fresh(ago(SIGNUP_GOAL_WINDOW_MS)), now)).toBe(false);
  });

  it("почту, брошенную давно и подтверждённую сейчас, считает свежей", () => {
    expect(isFreshSignup(fresh(ago(7 * 86_400_000), ago(10_000)), now)).toBe(true);
  });

  it("давний аккаунт — не регистрация", () => {
    expect(isFreshSignup(fresh(ago(86_400_000), ago(86_000_000)), now)).toBe(false);
  });

  it("отметка чуть из будущего (часы разошлись) — свежая", () => {
    expect(isFreshSignup(fresh(ago(-2000)), now)).toBe(true);
  });

  it("без дат — не свежий", () => {
    expect(isFreshSignup(fresh(null), now)).toBe(false);
  });

  // Ссылку из письма открыли во встроенном браузере почты — там регистрация.
  // Потом вошли паролем в Safari: аккаунт ещё свежий, флага в localStorage
  // Safari нет, но сессия выдана позже — это вход, а не регистрация.
  it("сессия выдана позже регистрации (вход с другого устройства) — не регистрация", () => {
    const verified = ago(10 * 60_000);
    expect(isFreshSignup({ createdAt: ago(86_400_000), emailVerified: verified, sessionIssuedAt: ago(60_000) }, now))
      .toBe(false);
    expect(isFreshSignup({ createdAt: ago(10 * 60_000), emailVerified: null, sessionIssuedAt: ago(5 * 60_000) }, now))
      .toBe(false);
  });

  it("сессия выдана вслед за созданием, с разбросом часов, — регистрация", () => {
    const created = ago(5 * 60_000);
    const issued = new Date(Date.parse(created) + SIGNUP_SESSION_SKEW_MS - 1000).toISOString();
    expect(isFreshSignup({ createdAt: created, emailVerified: null, sessionIssuedAt: issued }, now)).toBe(true);
  });

  it("срок сессии неизвестен — не регистрация", () => {
    expect(isFreshSignup({ createdAt: ago(60_000), emailVerified: null, sessionIssuedAt: null }, now)).toBe(false);
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
