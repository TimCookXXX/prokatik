"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { DateRange } from "@/lib/catalog/filters";
import type { UserPoint } from "@/lib/geo/location";

// Даты «Когда» и точка «Где», выбранные в панели, но ещё не отправленные.
// Общие для всех панелей страницы: на телефоне человек выбирает даты в hero, а
// подсказку «Что» берёт в панели шапки (поле hero отдаёт ей фокус), и шапка
// обязана отправить те же даты и то же место.
//
// Черновик привязан к адресу, на котором выбран. Сменился адрес — переход
// случился, черновик выбрасывается, и поле снова показывает значение из адреса:
// шапка живёт в корневом layout'е и иначе пронесла бы неотправленный выбор на
// чужую страницу — или вернула бы брошенный, когда человек придёт назад.

interface Draft<T> {
  at: string;
  /** null — значение из адреса снято: «Любые даты», «×» у «Где». */
  value: T | null;
}

function draftStore<T>() {
  let draft: Draft<T> | null = null;
  const listeners = new Set<() => void>();
  const notify = () => { for (const cb of listeners) cb(); };
  return {
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    get: () => draft,
    set(next: Draft<T> | null) {
      draft = next;
      notify();
    },
    reset() { draft = null; },
  };
}

type Store<T> = ReturnType<typeof draftStore<T>>;

const dates = draftStore<DateRange>();
const where = draftStore<UserPoint>();

/**
 * Значение панели на адресе `at`: черновик, если он выбран здесь, иначе —
 * значение из адреса. Второй элемент — записать черновик.
 */
function usePanelDraft<T>(
  store: Store<T>, at: string, fromUrl: T | null,
): [T | null, (value: T | null) => void] {
  const current = useSyncExternalStore(store.subscribe, store.get, () => null);
  const set = useCallback((value: T | null) => store.set({ at, value }), [store, at]);
  useEffect(() => {
    const d = store.get();
    if (d && d.at !== at) store.set(null);
  }, [store, at]);
  return [current && current.at === at ? current.value : fromUrl, set];
}

/** Даты панели: черновик или даты из адреса (уже нормализованные). */
export function usePanelDates(at: string, fromUrl: DateRange | null) {
  return usePanelDraft(dates, at, fromUrl);
}

/** Точка «Где» панели: черновик или точка из адреса (кодек lib/geo/location). */
export function usePanelWhere(at: string, fromUrl: UserPoint | null) {
  return usePanelDraft(where, at, fromUrl);
}

/** Для тестов: черновики общие на модуль и иначе протекали бы между кейсами. */
export function _resetPanelDates() {
  dates.reset();
  where.reset();
}
