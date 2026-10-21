"use server";

// Отказ от учёта на этом устройстве и возврат к нему — кнопка на /privacy.
//
// Прав не спрашиваем: это настройка браузера, а не аккаунта, и отказаться
// вправе и аноним. Трогается только то, что принадлежит этому браузеру: строка
// его id из куки, события уходят следом каскадом. Чужую строку так удалить
// можно, лишь зная её случайный UUID. Входных данных у actions нет — всё
// берётся из кук и проверяется здесь.

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { visitors } from "@db/schema";
import {
  OPT_OUT_COOKIE, OPT_OUT_VALUE, VISITOR_COOKIE, isVisitorId, optOutCookieOptions,
} from "@/lib/analytics/visitor-cookie";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function secure(): boolean {
  return getEnv().NEXTAUTH_URL.startsWith("https://");
}

// Сначала удаление, потом куки: не удалось стереть собранное — отказ не
// ставится, и человек повторит. В обратном порядке повторять было бы нечем —
// кука id уже стёрта, и строка дожила бы до срока хранения.
export async function optOutOfAnalytics(): Promise<ActionResult> {
  const jar = await cookies();
  const vid = jar.get(VISITOR_COOKIE)?.value;
  if (isVisitorId(vid)) {
    try {
      await getDb().delete(visitors).where(eq(visitors.id, vid));
    } catch {
      return { ok: false, error: "delete_failed" };
    }
  }
  jar.delete(VISITOR_COOKIE);
  jar.set(OPT_OUT_COOKIE, OPT_OUT_VALUE, optOutCookieOptions(secure()));
  return { ok: true, data: undefined };
}

// Новый id браузеру выдаст middleware на следующей загрузке: прежний удалён
// вместе с историей, и продолжать его нечего.
export async function optInToAnalytics(): Promise<ActionResult> {
  (await cookies()).delete(OPT_OUT_COOKIE);
  return { ok: true, data: undefined };
}
