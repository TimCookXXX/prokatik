"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import { fieldWithin } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useCurrentCity } from "@/components/layout/use-current-city";
import {
  WHERE_PARAMS, searchSubmitHref, type WhatValue, type WhereParams,
} from "@/lib/search/submit-href";
import { WhatField } from "./WhatField";

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

// Панель поиска «Что · Когда · Где»; пока в ней только поле «Что».
// Одна форма на поверхность: в шапке — узкая строка, в hero — большая плашка.
//
// Без JS и до гидрации это обычная GET-форма на /search: поле «Что» названо q,
// город и известные из адреса даты и «Где» лежат скрытыми полями. После
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
    if (!editing) setText(urlQ);
  }

  // Даты и «Где» — что известно из адреса: их полей в панели ещё нет, но
  // поиск из выдачи с датами не должен их терять.
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const loc: WhereParams = {};
  for (const key of WHERE_PARAMS) {
    const v = searchParams.get(key);
    if (v) loc[key] = v;
  }

  const submit = (what: WhatValue) => {
    const href = searchSubmitHref({ what, from, to, loc }, { pathname, searchParams, citySlug });
    if (!href) {
      // Не сказали, что нужно, — открываем подсказки вместо пустого перехода.
      inputRef.current?.focus();
      return;
    }
    inputRef.current?.blur();
    // Поле шапки сразу показывает то, что будет в адресе перехода: запрос
    // выдачи или пусто. Иначе после выбора подсказки в шапке осталось бы
    // название вещи — адрес без q синхронизацию не запустит.
    if (header) {
      const dest = new URL(href, "http://x");
      setText(dest.pathname === "/search" ? dest.searchParams.get("q") ?? "" : "");
    }
    router.push(href as never);
  };

  // Выбор в «Что» ведёт сразу: других полей в панели пока нет. С «Когда»
  // фокус будет переходить к нему, как в sravniprokat.
  const onPick = (what: WhatValue) => submit(what);

  const hidden = (
    <>
      {citySlug && <input type="hidden" name="city" value={citySlug} />}
      {from && <input type="hidden" name="from" value={from} />}
      {to && <input type="hidden" name="to" value={to} />}
      {WHERE_PARAMS.map((key) => loc[key] && <input key={key} type="hidden" name={key} value={loc[key]} />)}
    </>
  );

  const formProps = {
    role: "search",
    action: "/search",
    method: "get",
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      submit({ kind: "text", q: text });
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
          value={text}
          onChange={setText}
          onPick={onPick}
          inputRef={inputRef}
          label={content.search.whatLabel}
          labelClassName="sr-only"
          placeholder={content.nav.searchPlaceholder}
          inputClassName="text-sm"
          className="flex-1"
        />
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
        value={text}
        onChange={setText}
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
      {hidden}
      <Button type="submit" className="h-12 shrink-0 px-7 text-base font-semibold md:h-auto md:min-h-12">
        {content.nav.search}
      </Button>
    </form>
  );
}
