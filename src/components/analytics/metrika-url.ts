// Какие адреса Метрика видит. Правила общие для YandexMetrika (хиты переходов)
// и для форм входа (куда уходить после входа); инлайн-сниппет счётчика
// повторяет их на JS — импортировать модуль туда нельзя.

// Админка в Метрику не попадает: ни визитом, ни записью Вебвизора, ни адресом
// страницы. Решение принимается один раз на загрузку документа — в
// инлайн-сниппете по пути, с которого документ открыт. Поэтому в админку
// приходят только полной загрузкой: ссылкой `<a>` из публичной части и
// window.location после входа (goAfterAuth). Клиентский переход оставил бы
// записывать админку счётчик, поднятый публичной страницей.
export const METRIKA_SKIPPED_PATH = /^\/admin(?:\/|$)/;

export function isMetrikaSkipped(pathname: string): boolean {
  return METRIKA_SKIPPED_PATH.test(pathname);
}

/** Куда ведёт путь из параметра (`from=/admin/users?x=1`): без query и hash. */
function pathOf(target: string): string {
  return target.split(/[?#]/, 1)[0];
}

/**
 * Адрес в том виде, в каком его можно отдать Метрике — страницей или
 * источником перехода:
 * - секрет из ссылки (`token` сброса пароля) вырезается;
 * - `from`, ведущий в админку (`/login?from=/admin/…` от middleware), —
 *   тоже: адрес админки не уходит и параметром;
 * - свой адрес в админке (источник перехода из открытой админки) сводится к
 *   `/admin` без подразделов и параметров.
 */
export function metrikaSafeHref(href: string, origin = window.location.origin): string {
  if (!href) return href;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (url.origin === origin && isMetrikaSkipped(url.pathname)) return `${url.origin}/admin`;
  let changed = false;
  if (url.searchParams.has("token")) {
    url.searchParams.delete("token");
    changed = true;
  }
  const from = url.searchParams.get("from");
  if (from !== null && isMetrikaSkipped(pathOf(from))) {
    url.searchParams.delete("from");
    changed = true;
  }
  return changed ? url.href : href;
}
