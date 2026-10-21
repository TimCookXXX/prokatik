// Память о недавних сменах id браузера для роута сбора. Новый vid уходит
// браузеру в Set-Cookie ответа на пачку. Пока браузер его не принял — ответ
// ещё в пути, следующая пачка ушла раньше, браузер не взял куку из ответа на
// fetch keepalive, — пачки идут со старым id, и каждая заводила бы ещё один
// новый: лишние строки, повторные «вошёл» и расход лимита track_new. Поэтому
// роут помнит, какой id он уже выдал за пару «старый id · аккаунт», и выдаёт
// тот же снова.
//
// Ключ — хэш пары, а не сами id. Связь живёт только в памяти процесса и
// минуты: дольше пачке со старым id идти неоткуда, а в базу она не попадает.

import { createHash } from "node:crypto";

export const SWITCH_GUARD_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5_000;

export interface SwitchGuard {
  /** Забыть всё — только для тестов. */
  clear(): void;
  /** id, уже выданный браузеру со старым `fromId` под этот аккаунт (null — гость). */
  get(fromId: string, userId: string | null, now?: number): string | null;
  remember(fromId: string, userId: string | null, toId: string, now?: number): void;
}

const keyOf = (fromId: string, userId: string | null) =>
  createHash("sha256").update(`${fromId}\n${userId ?? ""}`).digest("base64url");

export function createSwitchGuard(ttlMs = SWITCH_GUARD_TTL_MS, max = MAX_ENTRIES): SwitchGuard {
  // Порядок вставки — порядок срока: вытесняется самая давняя смена.
  const issued = new Map<string, { toId: string; until: number }>();
  return {
    clear() {
      issued.clear();
    },
    get(fromId, userId, now = Date.now()) {
      const key = keyOf(fromId, userId);
      const entry = issued.get(key);
      if (!entry) return null;
      if (entry.until > now) return entry.toId;
      issued.delete(key);
      return null;
    },
    remember(fromId, userId, toId, now = Date.now()) {
      const key = keyOf(fromId, userId);
      issued.delete(key);
      if (issued.size >= max) {
        const oldest = issued.keys().next().value;
        if (oldest !== undefined) issued.delete(oldest);
      }
      issued.set(key, { toId, until: now + ttlMs });
    },
  };
}

/** Память роута сбора — одна на процесс app (её читает только роут). */
export const visitorSwitchGuard = createSwitchGuard();
