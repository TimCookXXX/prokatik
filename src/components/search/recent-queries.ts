"use client";

import { useMemo, useSyncExternalStore } from "react";
import { normalize } from "@/lib/search/text";

// Недавние запросы «Что» — на этом устройстве, для пустого экрана поиска на
// телефоне. Только удобство: нет хранилища (приватный режим, запрет cookies) —
// просто не помним, и экран показывает одни «Часто ищут».
//
// Свежий — первым, не больше RECENT_MAX, повтор поднимается наверх, а не
// дублируется (сравнение без регистра и «ё»). Внешний стор, как
// stored-location.ts: экран видит запись и удаление сразу — в этой вкладке
// через notify, в соседних через событие `storage`.

export const RECENT_QUERIES_KEY = "inrenta_recent_queries";
export const RECENT_MAX = 8;

/** Список после нового запроса: свежий первым, без повтора, не длиннее RECENT_MAX. */
export function withRecent(list: readonly string[], query: string): string[] {
  const q = query.trim();
  const key = normalize(q);
  if (!key) return [...list];
  return [q, ...list.filter((x) => normalize(x) !== key)].slice(0, RECENT_MAX);
}

/** Список без запроса. */
export function withoutRecent(list: readonly string[], query: string): string[] {
  const key = normalize(query);
  return list.filter((x) => normalize(x) !== key);
}

/** Разбор записи хранилища; мусор — пустой список. */
export function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
const notify = () => { for (const cb of listeners) cb(); };

function onStorage(e: StorageEvent) {
  if (e.key === RECENT_QUERIES_KEY || e.key === null) notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Сырая запись — строка сравнивается по значению и годится снапшотом стора. */
function readRaw(): string | null {
  try {
    return localStorage.getItem(RECENT_QUERIES_KEY);
  } catch {
    return null;
  }
}

function write(list: string[]) {
  try {
    if (list.length) localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(list));
    else localStorage.removeItem(RECENT_QUERIES_KEY);
  } catch { /* нет хранилища — не помним */ }
  notify();
}

export function readRecentQueries(): string[] {
  return parseRecent(readRaw());
}

/** Запомнить отправленный запрос. */
export function rememberQuery(query: string) {
  if (!normalize(query)) return;
  write(withRecent(readRecentQueries(), query));
}

/** Удалить один запрос из недавних. */
export function forgetQuery(query: string) {
  write(withoutRecent(readRecentQueries(), query));
}

/**
 * Недавние запросы для рендера. Сервер и гидрация видят пусто: экран
 * открывается только жестом на клиенте, но разметка первого кадра обязана
 * совпасть с серверной.
 */
export function useRecentQueries(): string[] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => parseRecent(raw), [raw]);
}
