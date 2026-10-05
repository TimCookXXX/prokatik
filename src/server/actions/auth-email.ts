"use server";

// Вход и регистрация по почте. Здесь только сборка зависимостей, лимиты и
// перевод кодов ошибок в тексты — сама логика в src/lib/auth/flows.ts, чтобы
// её можно было тестировать без Postgres и SMTP.

import { cookies, headers } from "next/headers";
import { emailDomain, isBlockedDomain, normalizeEmail } from "@/lib/auth/email";
import {
  changePassword, loginWithPassword, registerWithPassword, requestPasswordReset,
  resendVerification, resetPassword,
  type FlowDeps,
} from "@/lib/auth/flows";
import { safeCallback, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { drizzleAuthStore } from "@/lib/auth/store";
import { clientIp } from "@/lib/http/client-ip";
import { mailTransportAvailable, sendMail } from "@/lib/mail/mailer";
import { checkLimit } from "@/lib/rate-limit";
import { getEnv } from "@/lib/env";
import { siteUrl } from "@/lib/site-config";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  // code — машинный повод отказа: UI решает по нему, показывать ли кнопку
  // «отправить письмо ещё раз». Сверять текст сообщения нельзя — правка
  // формулировки молча сломала бы поведение.
  | { ok: false; error: string; code?: string };

function flowDeps(callbackUrl?: string): FlowDeps {
  const env = getEnv();
  return {
    store: drizzleAuthStore(),
    sendMail,
    baseUrl: siteUrl(),
    transportAvailable: mailTransportAvailable(),
    blockedExtra: env.BLOCKED_EMAIL_DOMAINS,
    callbackUrl,
  };
}

async function ip(): Promise<string> {
  return clientIp(await headers());
}

const MESSAGES: Record<string, string> = {
  mail_unavailable: "Регистрация по почте сейчас недоступна — войдите через Яндекс или VK",
  mail_failed: "Не удалось отправить письмо, попробуйте позже",
  invalid_email: "Проверьте адрес почты",
  invalid_name: "Укажите имя — его увидят те, с кем вы договариваетесь",
  oauth_account_exists: "Эта почта уже привязана ко входу через Яндекс или VK — войдите этим способом",
  already_registered: "Эта почта уже зарегистрирована — войдите или восстановите пароль",
  rate_limited: "Слишком много попыток, попробуйте позже",
  invalid_credentials: "Неверная почта или пароль",
  use_oauth: "У этой почты вход через Яндекс или VK",
  email_not_verified: "Почта не подтверждена — отправьте письмо ещё раз",
  invalid_token: "Ссылка недействительна или устарела — запросите новую",
  invalid_current: "Неверный текущий пароль",
  no_password: "У аккаунта нет пароля — вы входите через Яндекс или VK",
};

export async function register(
  input: { email: string; password: string; name: string; callbackUrl?: string },
): Promise<ActionResult<{ sentTo: string }>> {
  const limit = checkLimit(await ip(), "register");
  if (!limit.ok) return { ok: false, error: MESSAGES.rate_limited };

  const res = await registerWithPassword(flowDeps(input.callbackUrl), input);
  if (res.ok) return { ok: true, data: { sentTo: res.sentTo } };

  if (res.error === "blocked_domain") {
    return { ok: false, error: blockedMessage(res.domain) };
  }
  if (res.error === "weak_password") return { ok: false, error: res.message };
  return { ok: false, error: MESSAGES[res.error] ?? "Не удалось зарегистрироваться" };
}

export async function login(
  input: { email: string; password: string; callbackUrl?: string },
): Promise<ActionResult<{ redirectTo: string }>> {
  const email = normalizeEmail(input.email);
  const limit = checkLimit(`${email}|${await ip()}`, "login");
  if (!limit.ok) return { ok: false, error: MESSAGES.rate_limited };

  const res = await loginWithPassword(drizzleAuthStore(), { email, password: input.password });
  if (!res.ok) return { ok: false, error: MESSAGES[res.error] ?? MESSAGES.invalid_credentials, code: res.error };

  const jar = await cookies();
  jar.set(sessionCookieName(), res.sessionToken, sessionCookieOptions(res.expires));
  return { ok: true, data: { redirectTo: safeCallback(input.callbackUrl) } };
}

export async function resendVerificationEmail(rawEmail: string, callbackUrl?: string): Promise<ActionResult> {
  const email = normalizeEmail(rawEmail);
  const byEmail = checkLimit(email, "resend");
  const byIp = checkLimit(await ip(), "mail_ip");
  // Ответ одинаковый даже при отказе лимитера: иначе форма выдаёт, есть ли аккаунт.
  if (!byEmail.ok || !byIp.ok) return { ok: true, data: undefined };

  await resendVerification(flowDeps(callbackUrl), email);
  return { ok: true, data: undefined };
}

export async function requestReset(rawEmail: string): Promise<ActionResult> {
  const email = normalizeEmail(rawEmail);
  const byEmail = checkLimit(email, "reset");
  const byIp = checkLimit(await ip(), "mail_ip");
  // Даже при отказе лимитера ответ тот же: форма не должна выдавать, есть ли аккаунт.
  if (!byEmail.ok || !byIp.ok) return { ok: true, data: undefined };

  await requestPasswordReset(flowDeps(), email);
  return { ok: true, data: undefined };
}

export async function submitNewPassword(
  input: { token: string; password: string },
): Promise<ActionResult<{ redirectTo: string }>> {
  const res = await resetPassword(drizzleAuthStore(), input.token, input.password);
  if (!res.ok) {
    if (res.error === "weak_password") return { ok: false, error: res.message };
    return { ok: false, error: MESSAGES.invalid_token };
  }

  const jar = await cookies();
  jar.set(sessionCookieName(), res.sessionToken, sessionCookieOptions(res.expires));
  return { ok: true, data: { redirectTo: "/" } };
}

export async function changeAccountPassword(
  input: { currentPassword: string; newPassword: string },
): Promise<ActionResult> {
  // Импорт внутри экшена: гард тянет next-auth → next/server, а этот модуль
  // импортируют клиентские формы, которые гоняются в jsdom-тестах.
  const { requireAuthState } = await import("@/lib/auth/guard");
  const session = await requireAuthState();
  if (!session) return { ok: false, error: "Войдите, чтобы сменить пароль" };

  // Ключ — userId: лимит должен пережить смену IP, иначе поле «текущий пароль»
  // работает оракулом для перебора.
  const limit = checkLimit(session.user.id, "password_change");
  if (!limit.ok) return { ok: false, error: MESSAGES.rate_limited };

  // Токен текущей сессии — чтобы флоу оставил её жить и закрыл только остальные.
  const jar = await cookies();
  const keepSessionToken = jar.get(sessionCookieName())?.value;

  const res = await changePassword(flowDeps(), { userId: session.user.id, keepSessionToken, ...input });
  if (!res.ok) {
    if (res.error === "weak_password") return { ok: false, error: res.message };
    return { ok: false, error: MESSAGES[res.error] ?? MESSAGES.invalid_current };
  }
  return { ok: true, data: undefined };
}

// Дёргается формой на blur: список доменов остаётся на сервере и в браузерный
// бандл не уезжает, но красная строка под полем появляется до отправки.
export async function checkEmailDomain(rawEmail: string): Promise<{ blocked: boolean; message: string | null }> {
  const email = normalizeEmail(rawEmail);
  if (!email.includes("@")) return { blocked: false, message: null };
  if (!isBlockedDomain(email, getEnv().BLOCKED_EMAIL_DOMAINS)) return { blocked: false, message: null };
  return { blocked: true, message: blockedMessage(emailDomain(email)) };
}

function blockedMessage(domain: string | null): string {
  const where = domain ? `с почт ${domain}` : "с этой почты";
  return `Регистрация ${where} не поддерживается — войдите через Яндекс или VK`;
}
