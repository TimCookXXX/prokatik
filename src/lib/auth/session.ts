import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions } from "@db/schema";
import { getEnv } from "@/lib/env";
import { sessionCookieNameFor } from "@/lib/auth/cookie-name";
import { SESSION_TTL_SECONDS } from "@/lib/auth/session-ttl";

// Общий механизм выдачи сессии для всех способов входа: VK, почта с паролем,
// dev-логин. Сессия — строка в БД, cookie хранит только её токен, поэтому
// удаление строки отзывает доступ мгновенно (на этом держится бан).

export const sessionTtlSeconds = SESSION_TTL_SECONDS;

export function sessionCookieName(): string {
  return sessionCookieNameFor(getEnv().NEXTAUTH_URL);
}

// Правило — в leaf-модуле: его берёт и очистка адресов своей статистики.
export { safeCallback } from "@/lib/auth/safe-callback";

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().NEXTAUTH_URL.startsWith("https://"),
    path: "/",
    expires,
  };
}

export async function issueSession(userId: string): Promise<{ sessionToken: string; expires: Date }> {
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await getDb().insert(sessions).values({ sessionToken, userId, expires });
  return { sessionToken, expires };
}

// Сброс пароля обязан выкидывать все живые сессии: он же реакция на угон.
export async function dropAllSessions(userId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}

// Смена пароля из кабинета: чужие руки с кукой теряют доступ, а сессия, из
// которой меняли, живёт — иначе перерисовка страницы после экшена (она идёт
// ещё со старой кукой) выглядит как разлогин на месте.
export async function dropOtherSessions(userId: string, keepToken: string): Promise<void> {
  await getDb().delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.sessionToken, keepToken)));
}
