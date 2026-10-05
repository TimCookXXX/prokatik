"use client";

import { useEffect, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import type { WhatValue } from "@/lib/search/submit-href";

// Текст «Что», выбранная подсказка и открытость экрана поиска на телефоне —
// один внешний стор на вкладку (по образцу panel-dates.ts). Hero и шапка
// показывают один и тот же текст и открывают один и тот же экран
// (MobileSearchScreen); набранное переживает закрытие экрана.
//
// Текст выводится из адреса: на /search — его q, на других страницах — пусто.
// Шапка живёт в корневом layout'е и не перемонтируется, поэтому сменившийся
// адрес переписывает текст — но не под руками: пока поле в фокусе или экран
// открыт, набранное остаётся.
//
// Экран открывается записью в истории без смены адреса: «назад» (жест, кнопка
// Android, «←», Esc) закрывает его, а не уводит со страницы. Закрывать
// history.back() можно только запись, положенную нами (флаг pushed, как в
// RequestsFeed): иначе «назад» увёл бы со страницы.

interface State {
  text: string;
  /** q адреса, с которым текст сверён; null — ещё не сверялся (сервер, гидрация). */
  syncedQ: string | null;
  /** Подсказка «Что» держится, пока текст не тронули. */
  picked: WhatValue | null;
  open: boolean;
  /** Фокус в поле «Что» формы (с lg): адрес текст не перетирает. */
  focused: boolean;
}

const INITIAL: State = { text: "", syncedQ: null, picked: null, open: false, focused: false };

let state = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

const get = () => state;
const getServer = () => INITIAL;

/** Метка нашей записи в истории: по ней видно, что запись положил экран поиска. */
export const SCREEN_HISTORY_MARKER = "inrentaSearchScreen";

/** Поле экрана поиска: его фокусируют в том же обработчике тапа, что и открытие. */
export const screenInput: { current: HTMLInputElement | null } = { current: null };

let returnTo: HTMLElement | null = null;
let pushed = false;

function onPopState() {
  // «Назад» унёс нашу запись — закрывать ею больше нечего.
  pushed = false;
  window.removeEventListener("popstate", onPopState);
  if (state.open) set({ open: false });
}

function shut(patch: Partial<State> = {}) {
  window.removeEventListener("popstate", onPopState);
  set({ ...patch, open: false });
}

/** Сверить текст с q адреса; поле под руками не перетирается. */
function syncWithUrl(urlQ: string) {
  if (state.syncedQ === urlQ) return;
  set(state.open || state.focused ? { syncedQ: urlQ } : { syncedQ: urlQ, text: urlQ, picked: null });
}

/** q адреса, из которого выводится текст «Что»: только выдача его показывает. */
export function useUrlQuery(): string {
  const pathname = usePathname();
  const q = useSearchParams().get("q");
  return pathname === "/search" ? q ?? "" : "";
}

/** Текст «Что», выбранная подсказка и открытость экрана. */
export function useSearchQuery(): { text: string; picked: WhatValue | null; open: boolean } {
  const urlQ = useUrlQuery();
  const s = useSyncExternalStore(subscribe, get, getServer);
  useEffect(() => { syncWithUrl(urlQ); }, [urlQ]);
  // До сверки (сервер, первый кадр, сменившийся адрес) — текст адреса.
  const follow = s.syncedQ !== urlQ && !(s.open || s.focused);
  return { text: follow ? urlQ : s.text, picked: follow ? null : s.picked, open: s.open };
}

/** Текст правят руками — подсказка больше не выбрана. */
export function setQueryText(text: string) {
  set({ text, picked: null });
}

export function pickWhat(picked: WhatValue) {
  set({ picked });
}

export function setQueryFocused(focused: boolean) {
  if (state.focused !== focused) set({ focused });
}

/**
 * Открыть экран поиска из обработчика тапа. iOS поднимает клавиатуру, только
 * если focus() вызван синхронно в обработчике жеста: flushSync монтирует экран
 * сразу, и поле получает фокус тут же.
 */
export function openSearchScreen(trigger: HTMLElement | null) {
  if (state.open) return;
  returnTo = trigger;
  if (!pushed) {
    // Без смены адреса: новый адрес сбросил бы черновики дат и «Где».
    window.history.pushState({ [SCREEN_HISTORY_MARKER]: true }, "");
    pushed = true;
  }
  window.addEventListener("popstate", onPopState);
  flushSync(() => set({ open: true }));
  screenInput.current?.focus();
}

export function isSearchScreenOpen(): boolean {
  return state.open;
}

/** «←» и Esc: снять свою запись истории, если она наша, и закрыть экран. */
export function closeSearchScreen() {
  if (!state.open) return;
  const back = pushed;
  pushed = false;
  shut();
  if (back) window.history.back();
}

/**
 * Уход с экрана переходом: router.replace займёт нашу запись истории, и
 * «назад» из выдачи вернёт на страницу, а не на экран. Текст — тот, что будет
 * в адресе перехода.
 */
export function leaveSearchScreen(text: string) {
  pushed = false;
  shut({ text, picked: null });
}

/** Отправка формы (с lg): поле показывает то, что будет в адресе перехода. */
export function settleQuery(text: string) {
  set({ text, picked: null });
}

/** Куда вернуть фокус, когда экран закрылся: на открывший его триггер. */
export function screenReturnTarget(): HTMLElement | null {
  return returnTo?.isConnected ? returnTo : null;
}

/** Для тестов: стор общий на модуль и иначе протекал бы между кейсами. */
export function _resetSearchQuery() {
  if (typeof window !== "undefined") window.removeEventListener("popstate", onPopState);
  state = INITIAL;
  pushed = false;
  returnTo = null;
  for (const cb of listeners) cb();
}
