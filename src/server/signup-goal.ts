// Способ регистрации для цели Метрики `signup` (src/lib/analytics/signup.ts).
// Свежесть аккаунта решается по сессии без базы; в `accounts` шапка идёт, только
// когда аккаунт стал живым только что, — то есть раз-другой на человека.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts } from "@db/schema";
import { isFreshSignup, signupMethod, type SignupFacts, type SignupMethod } from "@/lib/analytics/signup";

/**
 * Способ регистрации, если аккаунт сессии новый; иначе null. Сбой базы — тоже
 * null: аналитика шапку не роняет.
 */
export async function freshSignupMethod(
  user: SignupFacts & { id: string },
  now = Date.now(),
): Promise<SignupMethod | null> {
  if (!isFreshSignup(user, now)) return null;
  try {
    const rows = await getDb()
      .select({ provider: accounts.provider })
      .from(accounts)
      .where(eq(accounts.userId, user.id));
    return signupMethod(user.emailVerified, rows.map((r) => r.provider));
  } catch (e) {
    console.error("[signup-goal] accounts read failed:", e);
    return null;
  }
}
