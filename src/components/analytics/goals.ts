// Цели Метрики — JS-события `reachGoal`. В интерфейсе Метрики каждая заводится
// целью «JavaScript-событие» с тем же идентификатором (docs/seo.md, «Аналитика»).
//
// Параметры маленькие и из закрытого списка значений: текст запроса, имя, почта
// и любые id в них не попадают. Список ниже — единственный источник и для
// типов, и для проверки в рантайме: значение не из списка отбрасывается, даже
// если вызов обошёл типы.
//
// Цель может случиться раньше, чем поднялся счётчик (показ страницы при
// гидрации), поэтому вызовы копятся в своей очереди, и её сбрасывает в счётчик
// YandexMetrika при монтировании. Без Метрики очередь не уходит никуда: в dev
// без YANDEX_METRIKA_ID её некому сбросить, а в админке YandexMetrika её
// выключает.

import { ZERO_REASONS } from "@/lib/search/zero-reason";
import { SIGNUP_METHODS } from "@/lib/analytics/signup";

type ParamSpec = Readonly<Record<string, readonly (string | boolean)[]>>;

const GOAL_PARAMS = {
  /** Отправка панели поиска: шапка, hero, экран поиска на телефоне. */
  search: { kind: ["text", "query", "category"] },
  /** Пустая выдача /search и её причина. */
  search_zero: { reason: ZERO_REASONS },
  /** Показ страницы чужого объявления. */
  listing_view: {},
  /** «Забронировать»: в аккаунте человек или ему сначала войти. */
  booking_click: { authed: [true, false] },
  /** Аккаунт создан только что: почтой, Яндексом или VK. */
  signup: { method: SIGNUP_METHODS },
  /** Заявка на бронь отправлена. */
  booking_sent: {},
  /** Первое сообщение владельцу — новая переписка. */
  chat_started: {},
  /** Первое изменение поля в форме нового объявления. */
  listing_started: {},
  /** Новое объявление опубликовано. */
  listing_created: {},
} as const satisfies Record<string, ParamSpec>;

export type Goal = keyof typeof GOAL_PARAMS;

export type GoalParams = {
  [G in Goal]: { -readonly [K in keyof (typeof GOAL_PARAMS)[G]]: (typeof GOAL_PARAMS)[G][K] extends readonly (infer V)[] ? V : never };
};

/** Параметры цели в вызове: у целей без параметров второго аргумента нет. */
export type GoalArgs<G extends Goal> = keyof GoalParams[G] extends never ? [] : [params: GoalParams[G]];

export const GOALS = Object.keys(GOAL_PARAMS) as Goal[];

/** Сколько вызовов ждут счётчик; дальше новые отбрасываются. */
export const GOAL_QUEUE_LIMIT = 20;

type SafeParams = Record<string, string | boolean>;
type Call = [Goal, SafeParams | undefined];

type State =
  | { mode: "pending"; queue: Call[] }
  | { mode: "on"; counterId: number }
  | { mode: "off" };

let state: State = { mode: "pending", queue: [] };

/** Только известные параметры цели и только значения из её списка. */
function safeParams(name: Goal, params: unknown): SafeParams | undefined {
  if (!params || typeof params !== "object") return undefined;
  const spec: ParamSpec = GOAL_PARAMS[name];
  const out: SafeParams = {};
  for (const [key, value] of Object.entries(params)) {
    const allowed = Object.hasOwn(spec, key) ? spec[key] : undefined;
    if (allowed?.includes(value as string | boolean)) out[key] = value as string | boolean;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function send(counterId: number, [name, params]: Call): void {
  try {
    if (params) window.ym?.(counterId, "reachGoal", name, params);
    else window.ym?.(counterId, "reachGoal", name);
  } catch {
    // Счётчик чужой код: его сбой не должен ломать кнопку, на которой сработала цель.
  }
}

/** Цель Метрики. Неизвестное имя молча отбрасывается. */
export function reachGoal<G extends Goal>(name: G, ...args: GoalArgs<G>): void {
  if (!Object.hasOwn(GOAL_PARAMS, name)) return;
  const call: Call = [name, safeParams(name, args[0])];
  if (state.mode === "off") return;
  if (state.mode === "on") {
    send(state.counterId, call);
    return;
  }
  if (state.queue.length < GOAL_QUEUE_LIMIT) state.queue.push(call);
}

/** Счётчик поднят (YandexMetrika): очередь уходит в него, дальше — сразу. */
export function startGoals(counterId: number): void {
  const queue = state.mode === "pending" ? state.queue : [];
  state = { mode: "on", counterId };
  for (const call of queue) send(counterId, call);
}

/** Счётчика на этой загрузке документа не будет: очередь и новые цели — в никуда. */
export function stopGoals(): void {
  state = { mode: "off" };
}

/** Только для тестов: исходное состояние модуля. */
export function _resetGoalsForTests(): void {
  state = { mode: "pending", queue: [] };
}

/** Только для тестов: что ждёт счётчик. */
export function _pendingGoalsForTests(): readonly Call[] {
  return state.mode === "pending" ? state.queue : [];
}
