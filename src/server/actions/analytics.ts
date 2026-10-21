"use server";

// Отказ от учёта на этом устройстве и возврат к нему — кнопка на /privacy.
//
// Прав не спрашиваем: это настройка браузера, а не аккаунта, и отказаться
// вправе и аноним. Трогается только то, что принадлежит этому браузеру: строка
// его id из куки и строки прежних id (vid_prev — их браузер получает при
// входе, выходе и смене аккаунта), события уходят следом каскадом. Чужую
// строку так удалить можно, лишь зная её случайный UUID. Входных данных у
// actions нет — всё берётся из кук и проверяется здесь.
//
// Две формы вызова: из кнопки с JS (результат — объектом, страница сама
// перезагружается) и отправкой формы без JS (ответ — редирект обратно к
// кнопке: следующая загрузка уже без счётчика Метрики).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { visitors } from "@db/schema";
import {
  OPT_OUT_COOKIE, OPT_OUT_VALUE, PREVIOUS_VISITORS_COOKIE, VISITOR_COOKIE, isVisitorId, optOutCookieOptions,
  parsePreviousVisitors,
} from "@/lib/analytics/visitor-cookie";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Куда вернуть после отправки формы без JS: к кнопке на /privacy. */
const BACK_TO_BUTTON = "/privacy#opt-out";

function secure(): boolean {
  return getEnv().NEXTAUTH_URL.startsWith("https://");
}

// Сначала удаление, потом куки: не удалось стереть собранное — отказ не
// ставится, и человек повторит. В обратном порядке повторять было бы нечем —
// кука id уже стёрта, и строка дожила бы до срока хранения.
export async function optOutOfAnalytics(): Promise<ActionResult> {
  const jar = await cookies();
  const vid = jar.get(VISITOR_COOKIE)?.value;
  const ids = [
    ...(isVisitorId(vid) ? [vid.toLowerCase()] : []),
    ...parsePreviousVisitors(jar.get(PREVIOUS_VISITORS_COOKIE)?.value),
  ];
  if (ids.length > 0) {
    try {
      await getDb().delete(visitors).where(inArray(visitors.id, [...new Set(ids)]));
    } catch {
      return { ok: false, error: "delete_failed" };
    }
  }
  jar.delete(VISITOR_COOKIE);
  jar.delete(PREVIOUS_VISITORS_COOKIE);
  jar.set(OPT_OUT_COOKIE, OPT_OUT_VALUE, optOutCookieOptions(secure()));
  return { ok: true, data: undefined };
}

// Новый id браузеру выдаст middleware на следующей загрузке: прежние удалены
// вместе с историей, и продолжать их нечего.
export async function optInToAnalytics(): Promise<ActionResult> {
  (await cookies()).delete(OPT_OUT_COOKIE);
  return { ok: true, data: undefined };
}

/** Отказ отправкой формы без JS. Не вышло — та же кнопка, человек повторит. */
export async function optOutOfAnalyticsForm(): Promise<void> {
  await optOutOfAnalytics();
  redirect(BACK_TO_BUTTON);
}

/** Возврат к учёту отправкой формы без JS. */
export async function optInToAnalyticsForm(): Promise<void> {
  await optInToAnalytics();
  redirect(BACK_TO_BUTTON);
}
