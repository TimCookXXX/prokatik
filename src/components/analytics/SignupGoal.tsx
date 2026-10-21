"use client";

import { useEffect, useRef } from "react";
import type { SignupMethod } from "@/lib/analytics/signup";
import { reachGoal } from "./goals";

/** Флаг «цель уже ушла» — на устройстве, по аккаунту; на сервер не уходит. */
export const SIGNUP_GOAL_KEY_PREFIX = "inrenta_signup_goal:";

// Цель `signup`: шапка рисует компонент, пока аккаунт новый (isFreshSignup),
// а один раз на аккаунт на этом устройстве её держит флаг в localStorage —
// иначе каждая перезагрузка в окне свежести засчитывалась бы новой
// регистрацией. Хранилище недоступно (заблокированы данные сайта) — цели нет:
// без флага не узнать, уходила ли она, а лишняя регистрация хуже пропущенной.
export function SignupGoal({ account, method }: { account: string; method: SignupMethod }) {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const key = `${SIGNUP_GOAL_KEY_PREFIX}${account}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      return;
    }
    reachGoal("signup", { method });
  }, [account, method]);

  return null;
}
