// «Зарегистрировался» — цель Метрики `signup`. У входа через Яндекс и VK нет
// клиентского «успеха»: человек возвращается с провайдера обычной загрузкой
// страницы. Поэтому регистрацию узнаёт шапка по самому аккаунту: он стал живым
// только что. Чистые функции; данные — из сессии (createdAt, emailVerified).

/** Сколько после регистрации шапка ещё считает аккаунт новым. */
export const SIGNUP_GOAL_WINDOW_MS = 30 * 60 * 1000;

export const SIGNUP_METHODS = ["email", "yandex", "vk", "other"] as const;
export type SignupMethod = (typeof SIGNUP_METHODS)[number];

export interface SignupFacts {
  /** ISO-строка: сессия приезжает из auth() через JSON. */
  createdAt: string | null;
  emailVerified: string | null;
}

/**
 * Когда аккаунт стал живым. Почтой войти нельзя до подтверждения, а строка
 * пользователя создаётся ещё при отправке формы — поэтому у почты это
 * `emailVerified`. У OAuth `emailVerified` всегда NULL, и момент — создание.
 */
export function signupMoment(u: SignupFacts): number | null {
  const at = Date.parse(u.emailVerified ?? u.createdAt ?? "");
  return Number.isNaN(at) ? null : at;
}

/**
 * Аккаунт стал живым в пределах окна. Отметка «из будущего» (часы базы и
 * приложения чуть разошлись) — тоже свежая.
 */
export function isFreshSignup(u: SignupFacts, now: number): boolean {
  const at = signupMoment(u);
  return at !== null && now - at < SIGNUP_GOAL_WINDOW_MS;
}

/** Способ регистрации: провайдер из `accounts`, без них — почта с паролем. */
export function signupMethod(emailVerified: string | null, providers: readonly string[]): SignupMethod {
  if (providers.includes("yandex")) return "yandex";
  if (providers.includes("vk")) return "vk";
  return emailVerified ? "email" : "other";
}
