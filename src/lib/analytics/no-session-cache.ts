// Отрицательный кеш сессий для роута сбора. Маяк уходит с каждой страницы, и
// с протухшей или мусорной кукой сессии каждый ходил бы в базу за auth() —
// впустую. Токен, по которому сессии не нашлось, живой уже не станет: при
// входе Auth.js выдаёт новый. Поэтому «нет сессии» помнится 10 минут.
//
// Ключ — хэш токена, а не сам токен: секрет в памяти процесса не лежит.
// Положительный ответ не кешируется — выход и бан должны действовать сразу.

import { createHash } from "node:crypto";

export const NO_SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5_000;

export interface NoSessionCache {
  has(token: string, now?: number): boolean;
  remember(token: string, now?: number): void;
}

const keyOf = (token: string) => createHash("sha256").update(token).digest("base64url");

export function createNoSessionCache(ttlMs = NO_SESSION_TTL_MS, max = MAX_ENTRIES): NoSessionCache {
  // Порядок вставки — порядок срока: вытесняется самый давний.
  const until = new Map<string, number>();
  return {
    has(token, now = Date.now()) {
      const key = keyOf(token);
      const exp = until.get(key);
      if (exp === undefined) return false;
      if (exp > now) return true;
      until.delete(key);
      return false;
    },
    remember(token, now = Date.now()) {
      const key = keyOf(token);
      until.delete(key);
      if (until.size >= max) {
        const oldest = until.keys().next().value;
        if (oldest !== undefined) until.delete(oldest);
      }
      until.set(key, now + ttlMs);
    },
  };
}
