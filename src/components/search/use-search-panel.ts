"use client";

import { useMemo, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
// Свой useRouter у toploader: программный переход тоже запускает полосу
// загрузки. Без loading.tsx в каталоге другого отклика у перехода нет.
import { useRouter } from "nextjs-toploader/app";
import { parseDateRange } from "@/lib/catalog/filters";
import { locationQuery, parseLocation, type UserPoint } from "@/lib/geo/location";
import type { CityGeoContext } from "@/lib/geo/context";
import { useCurrentCity } from "@/components/layout/use-current-city";
import { WHERE_PARAMS, searchSubmitHref, type WhatValue } from "@/lib/search/submit-href";
import { usePanelDates, usePanelWhere } from "./panel-dates";
import {
  closeSearchScreen, isSearchScreenOpen, leaveSearchScreen, settleQuery, useSearchQuery,
} from "./search-query";
import { rememberQuery } from "./recent-queries";

/** Активный город для панели поиска; geo null — геоданных нет, «Где» не рисуется. */
export interface SearchCity {
  slug: string;
  name: string;
  geo: CityGeoContext | null;
}

/** Один и тот же адрес — путь и параметры без учёта их порядка. */
function sameHref(a: string, b: string): boolean {
  const x = new URL(a, "http://x");
  const y = new URL(b, "http://x");
  x.searchParams.sort();
  y.searchParams.sort();
  return x.pathname === y.pathname && x.searchParams.toString() === y.searchParams.toString();
}

export interface SubmitOptions {
  /**
   * С экрана поиска: router.replace вместо push — «назад» из выдачи вернёт на
   * страницу, а не на экран.
   */
  fromScreen?: boolean;
  /** Переходить некуда (пустая панель вне выдачи). */
  onEmpty?: () => void;
  /** Перед переходом. */
  onLeave?: () => void;
}

// Состояние панели «Что · Когда · Где» на текущем адресе — общее для формы
// (шапка и hero, SearchBar) и экрана поиска на телефоне (MobileSearchScreen).
// Каждый экземпляр читает одни и те же сторы: текст «Что» (search-query.ts),
// черновики дат и «Где» (panel-dates.ts), — поэтому выбор в hero видит экран,
// открытый из шапки, и наоборот.
export function useSearchPanel(cities: readonly SearchCity[], fixedCity?: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const slugs = useMemo(() => cities.map((c) => c.slug), [cities]);
  const current = useCurrentCity(slugs);
  const citySlug = fixedCity ?? current.slug;
  // Гео-контекст текущего города: город шапки меняется на клиенте, а с ним —
  // есть ли «Где» и чей мини-индекс адресов.
  const city = cities.find((c) => c.slug === citySlug);
  const whereCity = city?.geo ? { slug: city.slug, name: city.name, geo: city.geo } : null;

  const { text, picked, open } = useSearchQuery();

  // Даты «Когда» — из адреса, уже нормализованные, как их видит выдача; выбор
  // в панели держится черновиком до перехода (общим для всех панелей страницы).
  const fromUrl = useMemo(
    () => parseDateRange({
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    }) ?? null,
    [searchParams],
  );
  const qs = searchParams.toString();
  const at = `${pathname}?${qs}`;
  const [dates, setDates] = usePanelDates(at, fromUrl);

  // «Где» — точка из адреса (кодек lib/geo/location: мусор — без точки), выбор
  // в панели — черновиком, как даты. Город без геоданных поля не рисует, но
  // точку из адреса не теряет: она едет дальше скрытыми полями.
  const whereFromUrl = useMemo(
    () => parseLocation(Object.fromEntries(WHERE_PARAMS.map((k) => [k, searchParams.get(k)]))),
    [searchParams],
  );
  const [where, setWhereDraft] = usePanelWhere(at, whereFromUrl);
  // Выбор «Где» бывает позже нажатия «Найти» (Enter по набранному адресу,
  // геолокация): отправка ждёт промис и берёт точку из ref — состояние к этому
  // моменту ещё не перерисовано.
  const whereRef = useRef(where);
  whereRef.current = where;
  const setWhere = (p: UserPoint | null) => {
    whereRef.current = p;
    setWhereDraft(p);
  };
  const pending = useRef<Promise<void> | null>(null);
  const track = (p: Promise<void>) => {
    pending.current = p;
    void p.finally(() => { if (pending.current === p) pending.current = null; });
  };
  const loc = where ? locationQuery(where) : null;
  const suggestWhere = whereCity && loc ? { loc: loc.loc, lp: loc.lp } : null;

  /** Адрес перехода по «Что» с датами и «Где» панели; null — переходить некуда. */
  const hrefFor = (what: WhatValue) => {
    const point = whereRef.current;
    return searchSubmitHref(
      { what, from: dates?.from, to: dates?.to, loc: point ? locationQuery(point) : null },
      { pathname, searchParams, citySlug },
    );
  };

  const submit = (what: WhatValue, opts: SubmitOptions = {}) => {
    if (pending.current) {
      void pending.current.then(() => {
        // Экран закрыли, пока ждали «Где», — переход отменён: его запись
        // истории уже снята, и replace подменил бы саму страницу.
        if (opts.fromScreen && !isSearchScreenOpen()) return;
        submit(what, opts);
      });
      return;
    }
    const href = hrefFor(what);
    if (!href) {
      opts.onEmpty?.();
      return;
    }
    opts.onLeave?.();
    // Поле сразу показывает то, что будет в адресе перехода: запрос выдачи или
    // пусто. Иначе после выбора подсказки в шапке осталось бы название вещи —
    // адрес без q синхронизацию не запустит.
    const dest = new URL(href, "http://x");
    const destQ = dest.pathname === "/search" ? dest.searchParams.get("q") ?? "" : "";
    if (destQ) rememberQuery(destQ);
    if (opts.fromScreen) {
      // Тот же адрес — переходить некуда, но и подменять им запись экрана
      // нельзя: «назад» вёл бы на ту же страницу. Просто закрываем.
      if (sameHref(href, qs ? `${pathname}?${qs}` : pathname)) {
        closeSearchScreen();
        return;
      }
      leaveSearchScreen(destQ);
      router.replace(href as never);
      return;
    }
    settleQuery(destQ);
    router.push(href as never);
  };

  return {
    citySlug, whereCity, text, picked, open,
    dates, setDates, where, setWhere, track, loc, suggestWhere,
    hrefFor, submit,
  };
}
