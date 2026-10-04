"use client";

// Последнее выбранное «Где» — на этом устройстве (перенос из sravniprokat).
// Применённым значением поля оно не становится: поле «Где» показывает только
// то, что в адресе страницы, иначе шапка писала бы «Где: улица …» над
// карточками без расстояний. Оно — первая строка списка «Где» («Недавнее: …»),
// `near` подсказок адресов, пока место не выбрано, и место полосы «Рядом с
// вами» на главной (только показ: выдача без `loc` в адресе по нему не
// фильтрует и не сортирует).
//
// Запись помнит регион геоданных: в городе другого региона точка ни при чём.
// Только удобство — нет хранилища (приватный режим) — просто не помним.
//
// Маленький внешний стор: читатели (поле «Где», «Рядом с вами») подписаны на
// него через useSyncExternalStore и видят запись и очистку сразу — в этой
// вкладке через notify, в соседних через событие `storage`.

import { useMemo, useSyncExternalStore } from "react";
import { locationQuery, parseLocation, type UserPoint } from "@/lib/geo/location";

const LOC_KEY = "inrenta_loc";

const listeners = new Set<() => void>();
const notify = () => { for (const cb of listeners) cb(); };

function onStorage(e: StorageEvent) {
  // key null — соседняя вкладка очистила всё хранилище.
  if (e.key === LOC_KEY || e.key === null) notify();
}

/** Подписка на запись и очистку места — своей вкладкой и соседними. */
export function subscribeStoredLocation(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Сырая запись: строка сравнивается по значению — годится снапшотом стора. */
function readRaw(): string | null {
  try {
    return localStorage.getItem(LOC_KEY);
  } catch {
    return null;
  }
}

function parseRaw(raw: string | null, region: string): UserPoint | null {
  if (!raw) return null;
  try {
    const { region: stored, ...q } = JSON.parse(raw) as Record<string, string>;
    return stored === region ? parseLocation(q) : null;
  } catch {
    return null;
  }
}

/** Последнее место с этого устройства в регионе `region`; нет или чужой регион — null. */
export function readStoredLocation(region: string): UserPoint | null {
  return parseRaw(readRaw(), region);
}

/** Запомнить выбранное место региона; null («весь город», «×») — забыть. */
export function storeLocation(region: string, p: UserPoint | null) {
  try {
    if (p) localStorage.setItem(LOC_KEY, JSON.stringify({ region, ...locationQuery(p) }));
    else localStorage.removeItem(LOC_KEY);
  } catch { /* нет хранилища — не помним */ }
  notify();
}

/**
 * Последнее место региона для рендера. Сервер и гидрация видят null — разметка
 * сервера и первого кадра обязана совпасть; настоящее значение приходит сразу
 * после гидрации.
 */
export function useStoredLocation(region: string | null): UserPoint | null {
  const raw = useSyncExternalStore(subscribeStoredLocation, readRaw, () => null);
  return useMemo(() => (region ? parseRaw(raw, region) : null), [raw, region]);
}
