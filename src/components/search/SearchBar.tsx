"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import { parseDateRange } from "@/lib/catalog/filters";
import { locationQuery, parseLocation, type UserPoint } from "@/lib/geo/location";
import { fieldWithin } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useCurrentCity } from "@/components/layout/use-current-city";
import { WHERE_PARAMS, searchSubmitHref, type WhatValue } from "@/lib/search/submit-href";
import { WhatField } from "./WhatField";
import { WhenChip, WhenField } from "./WhenField";
import { WhereChip, WhereField } from "./WhereField";
import { usePopoverLayout } from "./MobileSuggestPanel";
import { usePanelDates, usePanelWhere } from "./panel-dates";
import type { CityGeoContext } from "@/lib/geo/context";

/** Гео-контекст города для «Где»: регион геоданных, центр, версия мини-индекса. */
export type { CityGeoContext };

/** Активный город для панели поиска; geo null — геоданных нет, «Где» не рисуется. */
export interface SearchCity {
  slug: string;
  name: string;
  geo: CityGeoContext | null;
}

// Панель поиска «Что · Когда · Где». Одна форма на поверхность: в шапке —
// узкая строка, в hero — большая плашка. «Когда» и «Где» в шапке видны с lg;
// ниже их открывают чипы в панели подсказок. «Где» есть только в городе с
// геоданными (geo): без них у объявлений нет точек и расстояний.
//
// Без JS и до гидрации это обычная GET-форма на /search: поле «Что» названо q,
// город, даты и известное из адреса «Где» лежат скрытыми полями. После
// гидрации отправку перехватывает onSubmit и ведёт по searchSubmitHref —
// карточка, раздел или выдача.
export function SearchBar({
  variant,
  cities,
  citySlug: fixedCity,
  className,
}: {
  variant: "header" | "hero";
  /** Активные города — чтобы узнать город в адресе и не принять за него /cabinet. */
  cities: readonly SearchCity[];
  /** Город задан страницей (hero); без него — из адреса или предпочтения. */
  citySlug?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const slugs = useMemo(() => cities.map((c) => c.slug), [cities]);
  const current = useCurrentCity(slugs);
  const citySlug = fixedCity ?? current.slug;
  const header = variant === "header";
  const inputRef = useRef<HTMLInputElement>(null);
  const popover = usePopoverLayout();
  // Выбранная подсказка «Что»: держится, пока текст не тронули.
  const [picked, setPicked] = useState<WhatValue | null>(null);
  const [whenSheet, setWhenSheet] = useState(false);
  const [whereSheet, setWhereSheet] = useState(false);
  // Гео-контекст текущего города: город шапки меняется на клиенте, а с ним —
  // есть ли «Где» и чей мини-индекс адресов.
  const city = cities.find((c) => c.slug === citySlug);
  const whereCity = city?.geo ? { slug: city.slug, name: city.name, geo: city.geo } : null;

  // Шапка живёт в корневом layout'е и не перемонтируется: текст «Что» выводится
  // из адреса и пересчитывается при его смене — но не под руками. Иначе после
  // ухода с /search?q=дрель в шапке висела бы «дрель», а набранное пропадало бы
  // от постороннего обновления адреса.
  const urlQ = header && pathname === "/search" ? searchParams.get("q") ?? "" : "";
  const [text, setText] = useState(urlQ);
  const [syncedQ, setSyncedQ] = useState(urlQ);
  const [editing, setEditing] = useState(false);
  if (urlQ !== syncedQ) {
    setSyncedQ(urlQ);
    if (!editing) {
      setText(urlQ);
      setPicked(null);
    }
  }
  const onText = (next: string) => {
    setText(next);
    setPicked(null);
  };

  // Даты «Когда» — из адреса, уже нормализованные, как их видит выдача; выбор
  // в панели держится черновиком до перехода (общим с другой панелью страницы).
  const fromUrl = useMemo(
    () => parseDateRange({
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    }) ?? null,
    [searchParams],
  );
  const at = `${pathname}?${searchParams.toString()}`;
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

  const submit = (what: WhatValue) => {
    if (pending.current) {
      void pending.current.then(() => submit(what));
      return;
    }
    const point = whereRef.current;
    const href = searchSubmitHref(
      { what, from: dates?.from, to: dates?.to, loc: point ? locationQuery(point) : null },
      { pathname, searchParams, citySlug },
    );
    if (!href) {
      // Не сказали, что нужно, — открываем подсказки вместо пустого перехода.
      inputRef.current?.focus();
      return;
    }
    inputRef.current?.blur();
    setPicked(null);
    // Поле шапки сразу показывает то, что будет в адресе перехода: запрос
    // выдачи или пусто. Иначе после выбора подсказки в шапке осталось бы
    // название вещи — адрес без q синхронизацию не запустит.
    if (header) {
      const dest = new URL(href, "http://x");
      setText(dest.pathname === "/search" ? dest.searchParams.get("q") ?? "" : "");
    }
    router.push(href as never);
  };

  // Выбранная подсказка не уводит со страницы: фокус переходит к «Когда»,
  // как в sravniprokat, а переход — кнопкой поиска. Так это, пока «Когда» видно
  // рядом (с lg). Ниже lg его поля в шапке нет — только чип в панели
  // подсказок, которая с выбором закрывается, — и подсказка ведёт сразу, с
  // датами, выбранными до неё. «Показать все» — сам поиск, он ведёт всегда.
  const onPick = (what: WhatValue) => {
    if (what.kind === "text" || !popover) {
      submit(what);
      return;
    }
    setPicked(what);
    inputRef.current?.form?.querySelector<HTMLElement>("[data-when]")?.focus();
  };

  const hidden = (
    <>
      {citySlug && <input type="hidden" name="city" value={citySlug} />}
      {dates && <input type="hidden" name="from" value={dates.from} />}
      {dates && <input type="hidden" name="to" value={dates.to} />}
      {loc && WHERE_PARAMS.map((key) => loc[key] && <input key={key} type="hidden" name={key} value={loc[key]} />)}
    </>
  );

  const formProps = {
    role: "search",
    action: "/search",
    method: "get",
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      submit(picked ?? { kind: "text", q: text });
    },
    onFocus: (e: React.FocusEvent<HTMLFormElement>) => {
      if ((e.target as Node) === inputRef.current) setEditing(true);
    },
    onBlur: (e: React.FocusEvent<HTMLFormElement>) => {
      if ((e.target as Node) === inputRef.current) setEditing(false);
    },
  } as const;

  if (header) {
    return (
      <form
        {...formProps}
        aria-label={content.search.headerLabel}
        className={cn(fieldWithin, "flex h-9 w-full items-center gap-1 pl-3 pr-1", className)}
      >
        <WhatField
          id="what-header"
          citySlug={citySlug}
          dates={dates}
          where={suggestWhere}
          value={text}
          onChange={onText}
          onPick={onPick}
          inputRef={inputRef}
          label={content.search.whatLabel}
          labelClassName="sr-only"
          placeholder={content.nav.searchPlaceholder}
          inputClassName="text-sm"
          clearClassName="hidden sm:grid"
          className="flex-1"
          panelToolbar={
            <>
              {/* Даты короче адреса: недостаток ширины ест чип «Где», а не они. */}
              <span className="flex shrink-0"><WhenChip value={dates} onClick={() => setWhenSheet(true)} /></span>
              {whereCity && <WhereChip value={where} onClick={() => setWhereSheet(true)} />}
            </>
          }
        />
        {/* Ниже lg полей «Когда» и «Где» в шапке нет — выбор выдаёт точка на
          * кнопке поиска (ширину поля она не ест), а сами значения видны в
          * чипах панели подсказок. */}
        {dates && <span className="sr-only lg:hidden">{content.search.when.datesSet}</span>}
        {whereCity && where && <span className="sr-only lg:hidden">{content.search.where.set}</span>}
        <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-border lg:block" />
        <WhenField
          variant="header"
          value={dates}
          onChange={setDates}
          sheetOpen={whenSheet}
          onSheetOpenChange={setWhenSheet}
          // Чип, открывший шторку, размонтирован вместе с панелью: фокус
          // возвращается в поле, и панель подсказок открывается снова.
          returnFocus={() => inputRef.current}
          className="hidden lg:flex"
        />
        {whereCity && (
          <>
            <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-border lg:block" />
            <WhereField
              // Свой мини-индекс и центр у каждого города: смена города — новое поле.
              key={whereCity.slug}
              variant="header"
              city={whereCity}
              value={where}
              onChange={setWhere}
              track={track}
              sheetOpen={whereSheet}
              onSheetOpenChange={setWhereSheet}
              returnFocus={() => inputRef.current}
              className="lg:w-40 xl:w-52"
            />
          </>
        )}
        {hidden}
        {/* Единственная лупа — и есть кнопка: зелёная справа, как «Найти» в hero. */}
        <button
          type="submit"
          aria-label={content.nav.search}
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-transform active:scale-[0.94]"
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          {(dates || (whereCity && where)) && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-background lg:hidden"
            />
          )}
        </button>
      </form>
    );
  }

  return (
    <form
      {...formProps}
      aria-label={content.search.heroLabel}
      // По этой метке шапка на главной узнаёт, виден ли поиск hero (HeaderSearch).
      data-hero-search
      // Hero — одна колонка во всю ширину своего текста: с md три поля и
      // кнопка встают в одну строку.
      className={cn(fieldWithin, "flex flex-col gap-2 p-2 text-left md:flex-row md:items-stretch", className)}
    >
      <WhatField
        id="what-hero"
        citySlug={citySlug}
        dates={dates}
        where={suggestWhere}
        value={text}
        onChange={onText}
        onPick={onPick}
        inputRef={inputRef}
        label={content.search.whatLabel}
        labelClassName="text-xs text-muted-foreground"
        placeholder={content.search.heroPlaceholder}
        inputClassName="py-0.5 text-base font-semibold placeholder:font-normal md:text-[17px]"
        className="flex-1 justify-center gap-0.5 px-3 py-1.5 md:px-4"
        // Ниже lg — та же панель подсказок, что у шапки: её поле и получает фокус.
        // На главной поиск шапки может быть скрыт (inert, HeaderSearch): inert
        // не принимает и программный фокус, поэтому снимается здесь; фокус
        // внутри держит поиск видимым, и вернёт inert уже его уход.
        redirectFocus={() => {
          const target = document.querySelector<HTMLElement>("[data-site-header] [data-what-input]");
          target?.closest<HTMLElement>("[inert]")?.removeAttribute("inert");
          return target;
        }}
      />
      <span aria-hidden="true" className="mx-3 h-px shrink-0 bg-border md:mx-0 md:my-2 md:h-auto md:w-px" />
      <WhenField variant="hero" value={dates} onChange={setDates} className="md:w-48 md:shrink-0" />
      {whereCity && (
        <>
          <span aria-hidden="true" className="mx-3 h-px shrink-0 bg-border md:mx-0 md:my-2 md:h-auto md:w-px" />
          <WhereField
            key={whereCity.slug}
            variant="hero"
            city={whereCity}
            value={where}
            onChange={setWhere}
            track={track}
            className="md:w-48 md:shrink-0 lg:w-56"
          />
        </>
      )}
      {hidden}
      <Button type="submit" className="h-12 shrink-0 px-6 text-base font-semibold md:h-auto md:min-h-12">
        {content.nav.search}
      </Button>
    </form>
  );
}
