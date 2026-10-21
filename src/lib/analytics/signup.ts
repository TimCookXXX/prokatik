// «Зарегистрировался» — цель Метрики `signup`. У входа через Яндекс и VK нет
// клиентского «успеха»: человек возвращается с провайдера обычной загрузкой
// страницы. Поэтому регистрацию узнаёт шапка по самому аккаунту: он стал живым
// только что, и сессия выдана в тот же момент. Чистые функции; данные — из
// сессии (createdAt, emailVerified, sessionIssuedAt).

/** Сколько после регистрации шапка ещё считает аккаунт новым. */
export const SIGNUP_GOAL_WINDOW_MS = 30 * 60 * 1000;

/**
 * Насколько выдача сессии может разойтись с регистрацией и всё ещё быть ею:
 * ссылка из письма и OAuth выдают сессию сразу за созданием или
 * подтверждением аккаунта. Вход паролем на другом устройстве позже — уже не
 * регистрация.
 */
export const SIGNUP_SESSION_SKEW_MS = 2 * 60 * 1000;

export const SIGNUP_METHODS = ["email", "yandex", "vk", "other"] as const;
export type SignupMethod = (typeof SIGNUP_METHODS)[number];

export interface SignupFacts {
  /** ISO-строка: сессия приезжает из auth() через JSON. */
  createdAt: string | null;
  emailVerified: string | null;
  /** Когда выдана текущая сессия (config.edge.ts, по её сроку). */
  sessionIssuedAt: string | null;
}

/**
 * Когда аккаунт стал живым. Почтой войти нельзя до подтверждения, а строка
 * пользователя создаётся ещё при отправке формы — поэтому у почты это
 * `emailVerified`. У OAuth `emailVerified` всегда NULL, и момент — создание.
 */
export function signupMoment(u: Pick<SignupFacts, "createdAt" | "emailVerified">): number | null {
  const at = Date.parse(u.emailVerified ?? u.createdAt ?? "");
  return Number.isNaN(at) ? null : at;
}

/**
 * Аккаунт стал живым в пределах окна, и эта сессия выдана тогда же, — то есть
 * это та самая сессия, с которой человек зарегистрировался. Без второго
 * условия вход в тот же аккаунт с другого браузера в пределах окна (ссылку из
 * письма открыли во встроенном браузере почты, потом вошли паролем в Safari)
 * засчитался бы второй регистрацией: флаг в localStorage у каждого браузера
 * свой. Отметка «из будущего» (часы базы и приложения чуть разошлись) — тоже
 * свежая.
 */
export function isFreshSignup(u: SignupFacts, now: number): boolean {
  const at = signupMoment(u);
  if (at === null || now - at >= SIGNUP_GOAL_WINDOW_MS) return false;
  const issued = Date.parse(u.sessionIssuedAt ?? "");
  return !Number.isNaN(issued) && Math.abs(issued - at) < SIGNUP_SESSION_SKEW_MS;
}

/** Способ регистрации: провайдер из `accounts`, без них — почта с паролем. */
export function signupMethod(emailVerified: string | null, providers: readonly string[]): SignupMethod {
  if (providers.includes("yandex")) return "yandex";
  if (providers.includes("vk")) return "vk";
  return emailVerified ? "email" : "other";
}
