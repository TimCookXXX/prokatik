import type { NextAuthConfig } from "next-auth";
import Yandex from "next-auth/providers/yandex";
import { getEnv } from "@/lib/env";
import { SESSION_TTL_SECONDS } from "@/lib/auth/session-ttl";

export function buildEdgeConfig(): NextAuthConfig {
  const env = getEnv();
  const providers: NextAuthConfig["providers"] = [];

  if (env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET) {
    providers.push(Yandex({ clientId: env.YANDEX_CLIENT_ID, clientSecret: env.YANDEX_CLIENT_SECRET }));
  }

  return {
    providers,
    session: { strategy: "database", maxAge: SESSION_TTL_SECONDS },
    secret: env.NEXTAUTH_SECRET,
    pages: { signIn: "/login" },
    callbacks: {
      // Сессия собирается заново, а не правится на месте: Auth.js отдаёт сюда
      // строку сессии вместе с токеном и всю строку пользователя (хэш пароля,
      // телефон), и то, что вернёт callback, уходит и в auth(), и браузеру по
      // GET /api/auth/session — любому скрипту страницы. Новое поле сессии —
      // только сюда и только то, что можно показать.
      session({ session, user }) {
        return {
          expires: session.expires,
          user: {
            id: user.id,
            name: user.name ?? null,
            email: user.email,
            image: user.image ?? null,
            role: user.role ?? "user",
            bannedAt: user.bannedAt ?? null,
            banReason: user.banReason ?? null,
            // Свежесть аккаунта для цели «Зарегистрировался»
            // (lib/analytics/signup.ts): строки пользователя и сессии уже
            // прочитаны адаптером, запроса не добавляет. Строками: auth()
            // отдаёт сессию через JSON, и Date до страниц не доезжает.
            signup: {
              createdAt: isoOrNull(user.createdAt),
              emailVerified: isoOrNull(user.emailVerified),
              sessionIssuedAt: sessionIssuedAt(session.expires),
            },
          },
        };
      },
    },
  };
}

// Когда выдана сессия. Отдельной колонки нет, но срок у всех способов входа
// один: issueSession и Auth.js ставят expires = выдача + SESSION_TTL_SECONDS.
// Auth.js продлевает строку не чаще раза в сутки (updateAge) и в callback
// отдаёт срок до продления, так что первые сутки это ровно момент выдачи —
// окна цели signup с запасом хватает.
function sessionIssuedAt(expires: unknown): string | null {
  const at = expires instanceof Date ? expires.getTime() : Date.parse(typeof expires === "string" ? expires : "");
  return Number.isNaN(at) ? null : new Date(at - SESSION_TTL_SECONDS * 1000).toISOString();
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return typeof value === "string" ? value : null;
}
