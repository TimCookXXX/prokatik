// Суточный потолок событий своей статистики — по образцу MAIL_DAILY_CAP, но
// счётчиком на московские сутки, а не скользящим окном rate-limit.ts: окно
// держало бы массив отметок на каждое из тысяч событий, а админке нужен ответ
// «сегодня потолок достигнут» — про календарный день.
//
// Счётчик в памяти процесса app, как и лимитер: рестарт его обнуляет.

import { todayStr } from "@/lib/catalog/dates";
import { DAILY_EVENT_CAP } from "./limits";

const WARN_EVERY_MS = 60 * 60 * 1000;

export interface DailyCap {
  /** Списать n событий. false — сверх потолка: событий не писать. */
  take(n: number, now?: Date): boolean;
  /** Отказывал ли потолок сегодня — плашка в админке. */
  reachedToday(now?: Date): boolean;
}

/** `onReached` зовётся не чаще раза в час, пока потолок отказывает. */
export function createDailyCap(cap: number, onReached: () => void): DailyCap {
  let day = "";
  let used = 0;
  let reached = false;
  let warnedAt = -Infinity;

  const roll = (now: Date) => {
    const today = todayStr(now);
    if (today === day) return;
    day = today;
    used = 0;
    reached = false;
  };

  return {
    take(n, now = new Date()) {
      roll(now);
      if (used + n > cap) {
        reached = true;
        if (now.getTime() - warnedAt >= WARN_EVERY_MS) {
          warnedAt = now.getTime();
          onReached();
        }
        return false;
      }
      used += n;
      return true;
    },
    reachedToday(now = new Date()) {
      roll(now);
      return reached;
    },
  };
}

// В лог — ни id браузера, ни текста запроса, ни IP: только факт и потолок.
export const visitorEventsCap = createDailyCap(DAILY_EVENT_CAP, () => {
  console.warn(`[analytics] суточный потолок событий (${DAILY_EVENT_CAP}) достигнут, новые отбрасываются до полуночи по Москве`);
});
