"use client";

import { useRef } from "react";
import { Search } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import { fieldWithin } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { WHERE_PARAMS, type WhatValue } from "@/lib/search/submit-href";
import { WhatField } from "./WhatField";
import { WhenField } from "./WhenField";
import { WhereField } from "./WhereField";
import { SearchScreenTrigger } from "./MobileSearchScreen";
import { pickWhat, setQueryFocused, setQueryText } from "./search-query";
import { useSearchPanel, type SearchCity } from "./use-search-panel";

/** Гео-контекст города для «Где»: регион геоданных, центр, версия мини-индекса. */
export type { CityGeoContext } from "@/lib/geo/context";
/** Активный город для панели поиска; geo null — геоданных нет, «Где» не рисуется. */
export type { SearchCity };

// Панель поиска «Что · Когда · Где». Одна форма на поверхность: в шапке —
// узкая строка, в hero — большая плашка. «Где» есть только в городе с
// геоданными (geo): без них у объявлений нет точек и расстояний.
//
// Ниже lg вместо поля «Что» — кнопка-триггер полноэкранного экрана поиска
// (MobileSearchScreen): в шапке — вместо всей формы, в hero — вместо поля
// «Что». Переключение только классами (lg:hidden / hidden lg:flex), без
// JS-ветки: ширину сервер не знает, и десктоп не прыгает при загрузке.
//
// Без JS и до гидрации это обычная GET-форма на /search: поле «Что» названо q,
// город, даты и известное из адреса «Где» лежат скрытыми полями. Ниже lg без
// JS поля «Что» нет — триггер экрана работает только со скриптом. После
// гидрации отправку перехватывает onSubmit и ведёт по searchSubmitHref —
// раздел или выдача. Текст «Что» общий у шапки, hero и экрана (search-query.ts).
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
  const panel = useSearchPanel(cities, fixedCity);
  const { citySlug, whereCity, text, picked, dates, setDates, where, setWhere, track, loc, suggestWhere } = panel;
  const header = variant === "header";
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (what: WhatValue) => panel.submit(what, {
    // Не сказали, что нужно, — открываем подсказки вместо пустого перехода.
    onEmpty: () => inputRef.current?.focus(),
    onLeave: () => inputRef.current?.blur(),
  });

  // Подсказка-запрос и «Показать все» — сам поиск: ведут в выдачу сразу.
  // Выбранный раздел не уводит со страницы: фокус переходит к «Когда», как в
  // sravniprokat, а переход — кнопкой поиска. Форма видна только с lg, где
  // «Когда» стоит рядом; на экране поиска раздел ведёт сразу.
  const onPick = (what: WhatValue) => {
    if (what.kind !== "category") {
      submit(what);
      return;
    }
    pickWhat(what);
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
  } as const;

  const what = {
    citySlug,
    dates,
    where: suggestWhere,
    value: text,
    onChange: setQueryText,
    onPick,
    inputRef,
    onFocusChange: setQueryFocused,
    label: content.search.whatLabel,
  };

  if (header) {
    return (
      <>
        <SearchScreenTrigger
          variant="header"
          text={text}
          // Даты и «Где» на триггере — точкой: сами значения видны в чипах экрана.
          notes={[
            ...(dates ? [content.search.when.datesSet] : []),
            ...(whereCity && where ? [content.search.where.set] : []),
          ]}
          className={cn("lg:hidden", className)}
        />
        <form
          {...formProps}
          aria-label={content.search.headerLabel}
          className={cn(fieldWithin, "hidden h-9 w-full items-center gap-1 pl-3 pr-1 lg:flex", className)}
        >
          <WhatField
            {...what}
            id="what-header"
            labelClassName="sr-only"
            placeholder={content.nav.searchPlaceholder}
            inputClassName="text-sm"
            clearClassName="hidden sm:grid"
            className="flex-1"
          />
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
          <WhenField variant="header" value={dates} onChange={setDates} className="flex" />
          {whereCity && (
            <>
              <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
              <WhereField
                // Свой мини-индекс и центр у каждого города: смена города — новое поле.
                key={whereCity.slug}
                variant="header"
                city={whereCity}
                value={where}
                onChange={setWhere}
                track={track}
                className="lg:w-40 xl:w-52"
              />
            </>
          )}
          {hidden}
          {/* Единственная лупа — и есть кнопка: зелёная справа, как «Найти» в hero. */}
          <button
            type="submit"
            aria-label={content.nav.search}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-transform active:scale-[0.94]"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </form>
      </>
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
      {/* Ниже lg — кнопка экрана поиска, тот же экран, что у шапки. */}
      <SearchScreenTrigger variant="hero" text={text} className="flex-1 lg:hidden" />
      <WhatField
        {...what}
        id="what-hero"
        labelClassName="text-xs text-muted-foreground"
        placeholder={content.search.heroPlaceholder}
        inputClassName="py-0.5 text-base font-semibold placeholder:font-normal md:text-[17px]"
        className="hidden flex-1 justify-center gap-0.5 px-3 py-1.5 md:px-4 lg:flex"
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
