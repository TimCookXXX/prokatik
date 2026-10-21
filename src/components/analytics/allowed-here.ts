// Переключатель учёта (lib/analytics/allowed.ts) в браузере: по document.cookie.
// Кука отказа не httpOnly ровно ради этого.

import { parseCookie } from "cookie";
import { analyticsAllowed } from "@/lib/analytics/allowed";

/** Можно ли учитывать этот браузер. Вне браузера — нет: слать оттуда нечего. */
export function analyticsAllowedHere(): boolean {
  if (typeof document === "undefined") return false;
  const jar = parseCookie(document.cookie);
  return analyticsAllowed((name) => jar[name]);
}
