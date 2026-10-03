"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { DateRange } from "@/lib/catalog/filters";

// Даты «Когда», выбранные в панели, но ещё не отправленные. Общие для всех
// панелей страницы: на телефоне человек выбирает даты в hero, а подсказку
// «Что» берёт в панели шапки (поле hero отдаёт ей фокус), и шапка обязана
// отправить те же даты.
//
// Черновик привязан к адресу, на котором выбран. Сменился адрес — переход
// случился, черновик выбрасывается, и поле снова показывает даты из адреса:
// шапка живёт в корневом layout'е и иначе пронесла бы неотправленный выбор на
// чужую страницу — или вернула бы брошенный, когда человек придёт назад.

interface Draft {
  at: string;
  /** null — «Любые даты»: даты из адреса сняты. */
  range: DateRange | null;
}

let draft: Draft | null = null;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

const snapshot = () => draft;

function notify() {
  for (const cb of listeners) cb();
}

/**
 * Даты панели на адресе `at`: черновик, если он выбран здесь, иначе — даты из
 * адреса (уже нормализованные). Второй элемент — записать черновик.
 */
export function usePanelDates(
  at: string,
  fromUrl: DateRange | null,
): [DateRange | null, (range: DateRange | null) => void] {
  const current = useSyncExternalStore(subscribe, snapshot, () => null);
  const set = useCallback((range: DateRange | null) => {
    draft = { at, range };
    notify();
  }, [at]);
  useEffect(() => {
    if (draft && draft.at !== at) {
      draft = null;
      notify();
    }
  }, [at]);
  return [current && current.at === at ? current.range : fromUrl, set];
}

/** Для тестов: черновик общий на модуль и иначе протекал бы между кейсами. */
export function _resetPanelDates() {
  draft = null;
}
