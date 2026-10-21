// Суточные потолки событий своей статистики — по образцу MAIL_DAILY_CAP, но
// счётчиком на московские сутки, а не скользящим окном rate-limit.ts: окно
// держало бы массив отметок на каждое из тысяч событий, а админке нужен ответ
// «сегодня потолок достигнут» — про календарный день.
//
// Потолков три, и все считают события, а не запросы: пачка несёт до
// TRACK_BATCH_MAX событий, и лимиты запросов (track, track_vid) пропускали бы
// вдесятеро больше. Общий на сайт держит рост таблицы и дампов, а доли одного
// IP и одного браузера — чтобы один клиент не выбрал общий за минуты и не
// ослепил статистику до полуночи.
//
// Счётчики в памяти процесса app, как и лимитер: рестарт их обнуляет. Состояние
// — на globalThis, а не в переменной модуля: роут сбора и страницы админки
// собираются в разные бандлы со своей копией модуля, и плашка «потолок
// достигнут» иначе читала бы счётчик, который никто не списывает (как кэши в
// src/server/search-index.ts).

import { todayStr } from "@/lib/catalog/dates";
import { DAILY_EVENT_CAP, DAILY_EVENTS_PER_IP, DAILY_EVENTS_PER_VISITOR } from "./limits";

const WARN_EVERY_MS = 60 * 60 * 1000;
/** Сколько ключей помнит доля на клиента; дальше вытесняется самый давний. */
const BUDGET_MAX_KEYS = 50_000;

export interface DailyCap {
  /** Списать n событий. false — сверх потолка: событий не писать. */
  take(n: number, now?: Date): boolean;
  /** Отказывал ли потолок сегодня — плашка в админке. */
  reachedToday(now?: Date): boolean;
}

interface CapState {
  day: string;
  used: number;
  reached: boolean;
  warnedAt: number;
}

const freshCap = (): CapState => ({ day: "", used: 0, reached: false, warnedAt: -Infinity });

/** `onReached` зовётся не чаще раза в час, пока потолок отказывает. */
export function createDailyCap(cap: number, onReached: () => void, state: CapState = freshCap()): DailyCap {
  const roll = (now: Date) => {
    const today = todayStr(now);
    if (today === state.day) return;
    state.day = today;
    state.used = 0;
    state.reached = false;
  };

  return {
    take(n, now = new Date()) {
      roll(now);
      if (state.used + n > cap) {
        state.reached = true;
        if (now.getTime() - state.warnedAt >= WARN_EVERY_MS) {
          state.warnedAt = now.getTime();
          onReached();
        }
        return false;
      }
      state.used += n;
      return true;
    },
    reachedToday(now = new Date()) {
      roll(now);
      return state.reached;
    },
  };
}

export interface DailyBudget {
  /** Поместятся ли ещё n событий ключа сегодня. */
  fits(key: string, n: number, now?: Date): boolean;
  take(key: string, n: number, now?: Date): void;
}

interface BudgetState {
  day: string;
  used: Map<string, number>;
}

/** Суточная доля на ключ (IP, id браузера). Порядок вставки — порядок первого события дня. */
export function createDailyBudget(
  limit: number,
  maxKeys = BUDGET_MAX_KEYS,
  state: BudgetState = { day: "", used: new Map() },
): DailyBudget {
  const roll = (now: Date) => {
    const today = todayStr(now);
    if (today === state.day) return;
    state.day = today;
    state.used.clear();
  };
  return {
    fits(key, n, now = new Date()) {
      roll(now);
      return (state.used.get(key) ?? 0) + n <= limit;
    },
    take(key, n, now = new Date()) {
      roll(now);
      const used = state.used.get(key);
      if (used === undefined && state.used.size >= maxKeys) {
        const oldest = state.used.keys().next().value;
        if (oldest !== undefined) state.used.delete(oldest);
      }
      state.used.set(key, (used ?? 0) + n);
    },
  };
}

const G = globalThis as {
  __inrentaVisitorCap?: CapState;
  __inrentaVisitorIpBudget?: BudgetState;
  __inrentaVisitorVidBudget?: BudgetState;
};

// В лог — ни id браузера, ни текста запроса, ни IP: только факт и потолок.
export const visitorEventsCap = createDailyCap(DAILY_EVENT_CAP, () => {
  console.warn(`[analytics] суточный потолок событий (${DAILY_EVENT_CAP}) достигнут, новые отбрасываются до полуночи по Москве`);
}, (G.__inrentaVisitorCap ??= freshCap()));

const ipBudget = createDailyBudget(DAILY_EVENTS_PER_IP, BUDGET_MAX_KEYS,
  (G.__inrentaVisitorIpBudget ??= { day: "", used: new Map() }));
const visitorBudget = createDailyBudget(DAILY_EVENTS_PER_VISITOR, BUDGET_MAX_KEYS,
  (G.__inrentaVisitorVidBudget ??= { day: "", used: new Map() }));

/**
 * Списать n событий пачки: доля IP, доля браузера и общий потолок. Не
 * помещается хоть в один — не списывается ни в одном, событий не писать.
 */
export function takeVisitorEvents(ip: string, visitorId: string, n: number, now: Date = new Date()): boolean {
  if (!ipBudget.fits(ip, n, now) || !visitorBudget.fits(visitorId, n, now)) return false;
  if (!visitorEventsCap.take(n, now)) return false;
  ipBudget.take(ip, n, now);
  visitorBudget.take(visitorId, n, now);
  return true;
}

/** Только для тестов: все потолки в исходное состояние. */
export function _resetVisitorCapsForTests(): void {
  Object.assign(G.__inrentaVisitorCap!, freshCap());
  G.__inrentaVisitorIpBudget!.day = "";
  G.__inrentaVisitorIpBudget!.used.clear();
  G.__inrentaVisitorVidBudget!.day = "";
  G.__inrentaVisitorVidBudget!.used.clear();
}
