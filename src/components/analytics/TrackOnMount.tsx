"use client";

import { useEffect, useRef } from "react";
import type { ZeroReason } from "@/lib/search/zero-reason";
import { track } from "./track";

type Props =
  | {
    event: "search";
    /** Подписанные данные выдачи (lib/analytics/token.ts). */
    token: string;
    /** Что считается новым показом выдачи: запрос, город, фильтры, сортировка, страница. */
    showKey: string;
    /**
     * Что считается новым показом для цели «ничего не нашёл»: те же условия
     * без сортировки и вида — их смена пустую выдачу непустой не делает.
     */
    goalKey: string;
    /** Причина пустой первой страницы; нет — цели нет. */
    zero?: ZeroReason;
  }
  | {
    event: "view_listing";
    token: string;
    /** Объявление: перерисовка после заявки — тот же показ. */
    showKey: string;
  };

// Событие показа серверной страницы: сервер решает, что показано (выдача,
// чужое объявление), и подписывает посчитанное, а отправка — после гидрации.
// Уходит при монтировании и при смене ключа — перерисовка после Server Action
// или router.refresh тот же показ и события не даёт. Двойной эффект StrictMode
// гасит ref: он переживает повторный запуск эффекта. Цель Метрики шлёт сам
// track() — у выдачи по своему ключу.
export function TrackOnMount(props: Props) {
  const shown = useRef<string | null>(null);
  const goalShown = useRef<string | null>(null);
  const { event, token, showKey } = props;
  const goalKey = props.event === "search" ? props.goalKey : showKey;
  const zero = props.event === "search" ? props.zero : undefined;

  useEffect(() => {
    if (shown.current === showKey) return;
    shown.current = showKey;
    const goal = goalShown.current !== goalKey;
    goalShown.current = goalKey;
    if (event === "search") track("search", { token, zero }, { goal });
    else track("view_listing", { token }, { goal });
  }, [event, token, showKey, goalKey, zero]);

  return null;
}
