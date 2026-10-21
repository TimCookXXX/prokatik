import type { NextAuthConfig } from "next-auth";
import Yandex from "next-auth/providers/yandex";
import { getEnv } from "@/lib/env";

export function buildEdgeConfig(): NextAuthConfig {
  const env = getEnv();
  const providers: NextAuthConfig["providers"] = [];

  if (env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET) {
    providers.push(Yandex({ clientId: env.YANDEX_CLIENT_ID, clientSecret: env.YANDEX_CLIENT_SECRET }));
  }

  return {
    providers,
    session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
    secret: env.NEXTAUTH_SECRET,
    pages: { signIn: "/login" },
    callbacks: {
      session({ session, user }) {
        session.user.id = user.id;
        session.user.role = user.role ?? "user";
        session.user.bannedAt = user.bannedAt ?? null;
        session.user.banReason = user.banReason ?? null;
        // Свежесть аккаунта для цели «Зарегистрировался» (lib/analytics/signup.ts):
        // строка пользователя уже прочитана адаптером, запроса не добавляет.
        // Строками: auth() отдаёт сессию через JSON, и Date до страниц не доезжает.
        session.user.signup = {
          createdAt: isoOrNull(user.createdAt),
          emailVerified: isoOrNull(user.emailVerified),
        };
        return session;
      },
    },
  };
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return typeof value === "string" ? value : null;
}
