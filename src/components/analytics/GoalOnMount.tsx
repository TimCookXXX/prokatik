"use client";

import { useEffect, useRef } from "react";
import { reachGoal, type Goal, type GoalArgs } from "./goals";

type Props = {
  [G in Goal]: {
    goal: G;
    /**
     * Что считается новым показом: объявление, набор условий выдачи. Цель
     * уходит при монтировании и при смене ключа — перерисовка страницы после
     * Server Action или router.refresh тот же показ и цели не даёт.
     */
    showKey: string;
  } & (GoalArgs<G> extends [] ? { params?: undefined } : { params: GoalArgs<G>[0] });
}[Goal];

// Цель на показ серверной страницы: сервер решает, показать ли её (пустая
// выдача, чужое объявление), а отправка — после гидрации. Двойной эффект
// StrictMode гасит ref: он переживает повторный запуск эффекта.
export function GoalOnMount({ goal, showKey, params }: Props) {
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (sent.current === showKey) return;
    sent.current = showKey;
    (reachGoal as (name: Goal, params?: object) => void)(goal, params);
  }, [goal, showKey, params]);

  return null;
}
