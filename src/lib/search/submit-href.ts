// Куда ведёт отправка панели поиска «Что · Когда · Где». Чистая функция: панель
// в шапке и в hero зовёт её из onSubmit, а без JS та же форма уходит на
// `/search` обычным GET (action формы).
//
// Даты и «Где» берутся из панели, а не из адреса: пустые удаляются. Номер
// страницы сбрасывается всегда — новая выдача начинается с первой.

/** Параметры «Где» в адресе: точка, подпись, источник, точность (docs/domain.md). */
export const WHERE_PARAMS = ["loc", "la", "src", "lp"] as const;
export type WhereParams = Partial<Record<(typeof WHERE_PARAMS)[number], string>>;

/** Что выбрано в поле «Что». */
export type WhatValue =
  /** Подсказка-запрос (`/search?q=…&city=…`) или раздел (канонический путь без query). */
  | { kind: "query" | "category"; href: string }
  /** Набранный текст или строка «Показать все по «q»». */
  | { kind: "text"; q: string };

export interface SearchPanelValue {
  what: WhatValue;
  from?: string | null;
  to?: string | null;
  loc?: WhereParams | null;
}

export interface SearchLocation {
  pathname: string;
  searchParams: URLSearchParams | string;
  /** Текущий город (из пути, `?city=` или куки) — undefined, если неизвестен. */
  citySlug?: string;
}

/** Даты и «Где» панели — поверх переданных параметров; пустые удаляются. */
function applyPanel(params: URLSearchParams, v: SearchPanelValue): URLSearchParams {
  const set = (key: string, value: string | null | undefined) => {
    if (value) params.set(key, value); else params.delete(key);
  };
  set("from", v.from);
  set("to", v.to);
  for (const key of WHERE_PARAMS) set(key, v.loc?.[key]);
  // Без точки «Ближе» не от чего считать: «×» у «Где» снимает и её.
  if (!v.loc?.loc && params.get("sort") === "near") params.delete("sort");
  params.delete("page");
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const hasPanelValue = (v: SearchPanelValue) =>
  Boolean(v.from || v.to || WHERE_PARAMS.some((key) => v.loc?.[key]));

/**
 * Адрес перехода; null — переходить некуда (пустая панель вне выдачи), фокус
 * остаётся в «Что».
 */
export function searchSubmitHref(v: SearchPanelValue, at: SearchLocation): string | null {
  const { what } = v;

  if (what.kind !== "text") {
    const url = new URL(what.href, "http://x");
    return withQuery(url.pathname, applyPanel(url.searchParams, v));
  }

  const q = what.q.trim();
  if (q) {
    // Свободный текст — новый поиск: раздел, цена и залог прошлой выдачи не переносятся.
    const params = new URLSearchParams({ q });
    if (at.citySlug) params.set("city", at.citySlug);
    return withQuery("/search", applyPanel(params, v));
  }

  const current = new URLSearchParams(at.searchParams);
  if (at.pathname === "/search") {
    current.delete("q");
    return withQuery("/search", applyPanel(current, v));
  }
  if (at.citySlug && at.pathname.split("/")[1] === at.citySlug) {
    return withQuery(at.pathname, applyPanel(current, v));
  }
  if (hasPanelValue(v)) {
    const path = at.citySlug ? `/${at.citySlug}` : "/search";
    return withQuery(path, applyPanel(new URLSearchParams(), v));
  }
  return null;
}
