// Единственный переключатель учёта: можно ли считать этого посетителя — своей
// статистикой и Метрикой. Его спрашивают все, кто что-то отправляет или
// заводит: middleware (кука vid), корневой layout (счётчик Метрики), очередь
// целей, трекер и роут сбора.
//
// Сейчас режим — «учитываем, пока человек не отказался»: отказ ставит кука
// noanalytics с /privacy. Если понадобится согласие до учёта, меняется только
// этот модуль: функция начнёт требовать куку согласия, а сниппет ниже — тот же
// признак на JS.

import { OPT_OUT_COOKIE, OPT_OUT_VALUE } from "./visitor-cookie";

/** Значение куки по имени: у middleware, cookies() и document.cookie свой способ. */
export type CookieRead = (name: string) => string | undefined;

export function analyticsAllowed(read: CookieRead): boolean {
  return read(OPT_OUT_COOKIE) !== OPT_OUT_VALUE;
}

/**
 * Тот же признак JS-выражением над `document.cookie` — для инлайн-сниппета
 * Метрики: он исполняется до гидрации, и импортировать модуль туда нельзя.
 * Совпадение с analyticsAllowed держит тест.
 */
export const ANALYTICS_ALLOWED_JS =
  `!/(?:^|;\\s*)${OPT_OUT_COOKIE}=${OPT_OUT_VALUE}(?:;|$)/.test(document.cookie)`;
