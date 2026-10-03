"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import { parseDateRange } from "@/lib/catalog/filters";
import { fieldWithin } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useCurrentCity } from "@/components/layout/use-current-city";
import {
  WHERE_PARAMS, searchSubmitHref, type WhatValue, type WhereParams,
} from "@/lib/search/submit-href";
import { WhatField } from "./WhatField";
import { WhenChip, WhenField } from "./WhenField";
import { usePopoverLayout } from "./MobileSuggestPanel";
import { usePanelDates } from "./panel-dates";

/** Гео-контекст города для «Где»: регион геоданных, центр, версия мини-индекса. */
export interface CityGeoContext {
  region: string;
  centre: { lat: number; lon: number };
  token: string;
}

/** Активный город для панели поиска; geo null — геоданных нет, «Где» не рисуется. */
export interface SearchCity {
  slug: string;
  name: string;
  geo: CityGeoContext | null;
}

// Панель поиска «Что · Когда · Где»; пока в ней поля «Что» и «Когда».
// Одна форма на поверхность: в шапке — узкая строка, в hero — большая плашка.
// «Когда» в шапке видно с lg; ниже его открывает чип в панели подсказок.
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
  const [dates, setDates] = usePanelDates(`${pathname}?${searchParams.toString()}`, fromUrl);

  // «Где» — что известно из адреса: поля в панели ещё нет, но поиск из выдачи
  // с точкой не должен её терять.
  const loc: WhereParams = {};
  for (const key of WHERE_PARAMS) {
    const v = searchParams.get(key);
    if (v) loc[key] = v;
  }

  const submit = (what: WhatValue) => {
    const href = searchSubmitHref(
      { what, from: dates?.from, to: dates?.to, loc },
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
      {WHERE_PARAMS.map((key) => loc[key] && <input key={key} type="hidden" name={key} value={loc[key]} />)}
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
          panelToolbar={<WhenChip value={dates} onClick={() => setWhenSheet(true)} />}
        />
        {/* Ниже lg поля «Когда» в шапке нет — выбранные даты выдаёт точка на
          * кнопке поиска (ширину поля она не ест), а сами они видны в чипе
          * панели подсказок. */}
        {dates && <span className="sr-only lg:hidden">{content.search.when.datesSet}</span>}
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
        {hidden}
        {/* Единственная лупа — и есть кнопка: зелёная справа, как «Найти» в hero. */}
        <button
          type="submit"
          aria-label={content.nav.search}
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-transform active:scale-[0.94]"
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          {dates && (
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
      className={cn(fieldWithin, "flex flex-col gap-2 p-2 text-left md:flex-row md:items-stretch", className)}
    >
      <WhatField
        id="what-hero"
        citySlug={citySlug}
        dates={dates}
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
        redirectFocus={() => document.querySelector<HTMLElement>("[data-site-header] [data-what-input]")}
      />
      <span aria-hidden="true" className="mx-3 h-px shrink-0 bg-border md:mx-0 md:my-2 md:h-auto md:w-px" />
      <WhenField variant="hero" value={dates} onChange={setDates} className="md:w-48 md:shrink-0" />
      {hidden}
      <Button type="submit" className="h-12 shrink-0 px-6 text-base font-semibold md:h-auto md:min-h-12">
        {content.nav.search}
      </Button>
    </form>
  );
}
