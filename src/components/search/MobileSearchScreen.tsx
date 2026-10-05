"use client";

import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, History as RecentIcon, Search, X } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import { field, fieldWithin } from "@/components/ui/field";
import type { WhatValue } from "@/lib/search/submit-href";
import { WhatField } from "./WhatField";
import { WhenChip, WhenField } from "./WhenField";
import { WhereChip, WhereField } from "./WhereField";
import { forgetQuery, useRecentQueries } from "./recent-queries";
import {
  closeSearchScreen, openSearchScreen, screenInput, screenReturnTarget, setQueryText,
} from "./search-query";
import { useSearchPanel, type SearchCity } from "./use-search-panel";

const t = content.search;

/** Сколько «Часто ищут» на пустом экране: два-три ряда чипов на телефоне. */
const POPULAR_ON_SCREEN = 8;

const prevent = (e: React.SyntheticEvent) => e.preventDefault();

/** Обычный клик — переход роутером; с модификатором — как у любой ссылки. */
const plainClick = (e: React.MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * Кнопка, которая выглядит полем «Что» и открывает экран поиска (ниже lg).
 * Показывает текущий запрос. Тап открывает экран и в том же обработчике ставит
 * фокус в его поле — так iOS поднимает клавиатуру. Enter и пробел — как у
 * любой кнопки.
 */
export function SearchScreenTrigger({
  variant, text, notes = [], className,
}: {
  variant: "header" | "hero";
  text: string;
  /** Что ещё выбрано в панели (даты, «Где»): точка на кнопке и текст для скринридера. */
  notes?: readonly string[];
  className?: string;
}) {
  const name = [text ? `${t.whatLabel}: ${text}` : t.whatLabel, ...notes].join(", ");
  const common = {
    type: "button" as const,
    "aria-haspopup": "dialog" as const,
    "aria-label": name,
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => openSearchScreen(e.currentTarget),
  };

  if (variant === "hero") {
    return (
      <button
        {...common}
        className={cn("hoverable flex min-w-0 flex-col justify-center gap-0.5 rounded-sm px-3 py-1.5 text-left md:px-4", className)}
      >
        <span className="truncate text-xs text-muted-foreground">{t.whatLabel}</span>
        <span className={cn(
          "truncate py-0.5 text-base md:text-[17px]",
          text ? "font-semibold text-foreground" : "text-muted-foreground",
        )}>
          {text || t.heroPlaceholder}
        </span>
      </button>
    );
  }

  return (
    <button
      {...common}
      className={cn(field, "tap-target flex h-9 w-full min-w-0 items-center gap-2 pl-3 pr-2.5 text-left", className)}
    >
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className={cn("min-w-0 flex-1 truncate text-sm", text ? "text-foreground" : "text-muted-foreground")}>
        {text || content.nav.searchPlaceholder}
      </span>
      {notes.length > 0 && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
    </button>
  );
}

// Экран поиска на телефоне и планшете (ниже lg): «←», поле «Что» во всю ширину,
// чипы «Когда» и «Где»; до ввода — недавние запросы и «Часто ищут», при вводе —
// подсказки WhatField. Один на страницу: его открывают и триггер шапки, и
// триггер hero (search-query.ts), текст у них общий.
//
// Radix Dialog порталом в body — не внутри HeaderSearch, который бывает inert.
// Dialog делает фон inert, держит ловушку фокуса и складывается в стек со
// шторками «Когда»/«Где» (vaul — тоже Radix Dialog). Экран монтируется при
// открытии, а не заранее (forceMount): модальный Dialog прячет остальную
// страницу от скринридера при монтировании, а не при открытии. Синхронный
// монтаж даёт flushSync в openSearchScreen.
//
// Открытость не зависит от фокуса поля: спрятанная клавиатура и шторки экран
// не закрывают. Закрывают «←», Esc и «назад»; переход с экрана — router.replace.
export function MobileSearchScreen({ cities }: { cities: readonly SearchCity[] }) {
  const panel = useSearchPanel(cities);
  const { open, text, picked, citySlug, whereCity, dates, setDates, where, setWhere, track, suggestWhere } = panel;
  const recent = useRecentQueries();
  const [whenSheet, setWhenSheet] = useState(false);
  const [whereSheet, setWhereSheet] = useState(false);
  // Экран закрылся («назад», переход) — шторки закрываются вместе с ним.
  if (!open && (whenSheet || whereSheet)) {
    setWhenSheet(false);
    setWhereSheet(false);
  }
  const whenChip = useRef<HTMLButtonElement>(null);
  const whereChip = useRef<HTMLButtonElement>(null);

  // Любой выбор на экране — переход: раздел тоже, «Когда» рядом нет.
  const submit = (what: WhatValue) => panel.submit(what, {
    fromScreen: true,
    onEmpty: () => screenInput.current?.focus(),
  });
  const queryHref = (q: string) => panel.hrefFor({ kind: "text", q }) ?? "/search";
  const runQuery = (q: string) => (e: React.MouseEvent) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    submit({ kind: "text", q });
  };

  const empty = (
    // mousedown гасится: тап по строке не уводит фокус из поля, и клавиатура
    // не прыгает. Прокрутку пальцем это не трогает.
    <div onMouseDown={prevent} className="flex flex-col gap-6 px-4 pb-6 pt-2">
      {recent.length > 0 && (
        // Запросы человека — личное: в записи Вебвизора размыты.
        <section aria-labelledby="search-screen-recent" className="ym-hide-content">
          <h2 id="search-screen-recent" className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t.recentHeading}
          </h2>
          <ul className="-mx-4">
            {recent.map((q) => (
              <li key={q} className="flex items-center">
                <a
                  href={queryHref(q)}
                  onClick={runQuery(q)}
                  className="hoverable flex min-h-[44px] min-w-0 flex-1 items-center gap-3 pl-4 pr-2 text-[15px] text-foreground"
                >
                  <RecentIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{q}</span>
                </a>
                <button
                  type="button"
                  aria-label={t.recentRemove(q)}
                  onClick={() => forgetQuery(q)}
                  className="hoverable mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="search-screen-popular">
        <h2 id="search-screen-popular" className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {content.home.popularLabel}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {content.home.popularQueries.slice(0, POPULAR_ON_SCREEN).map((q) => (
            <li key={q}>
              <a
                href={queryHref(q)}
                onClick={runQuery(q)}
                className="hoverable inline-flex h-9 items-center rounded-sm border border-border bg-card px-3 text-sm text-foreground"
              >
                {q}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(o) => { if (!o) closeSearchScreen(); }}>
        <Dialog.Portal>
          {/* Подложка держит блокировку прокрутки страницы (Radix вешает её на overlay). */}
          <Dialog.Overlay className="fixed inset-0 z-50 bg-background" />
          <Dialog.Content
            data-search-screen
            aria-modal="true"
            aria-label={t.screenLabel}
            aria-describedby={undefined}
            // Фокус ставит openSearchScreen — сразу в поле, не в первую кнопку.
            onOpenAutoFocus={(e) => { e.preventDefault(); screenInput.current?.focus(); }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              screenReturnTarget()?.focus();
            }}
            // z-50 — выше липкой шапки и таб-бара (z-40); боковые и верхний
            // инсеты — под чёлку, нижний — у прокрутки.
            className="fixed inset-0 z-50 flex flex-col bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[var(--safe-top)] text-foreground focus:[outline:none]"
          >
            <Dialog.Title className="sr-only">{t.screenLabel}</Dialog.Title>
            <WhatField
              id="what-screen"
              citySlug={citySlug}
              dates={dates}
              where={suggestWhere}
              value={text}
              onChange={setQueryText}
              onPick={submit}
              inputRef={screenInput}
              label={t.whatLabel}
              labelClassName="sr-only"
              placeholder={content.nav.searchPlaceholder}
              // 16px: мельче iOS увеличивает страницу при фокусе.
              inputClassName="text-base"
              clearClassName="h-9 w-9"
              className="flex-1"
              renderInline={({ field: whatField, list, typing }) => (
                <>
                  <div className="flex items-center gap-1 pl-1 pr-3 pt-2">
                    <button
                      type="button"
                      onClick={closeSearchScreen}
                      aria-label={t.screenBack}
                      className="hoverable grid h-11 w-11 shrink-0 place-items-center rounded-lg text-foreground"
                    >
                      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                    </button>
                    {/* «Найти» — клавишей клавиатуры (enterKeyHint="search"). */}
                    <form
                      action="/search"
                      method="get"
                      onSubmit={(e) => {
                        e.preventDefault();
                        submit(picked ?? { kind: "text", q: text });
                      }}
                      className={cn(fieldWithin, "flex h-11 min-w-0 flex-1 items-center pl-3 pr-1")}
                    >
                      {whatField}
                    </form>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 px-4 py-2">
                    {/* Даты короче адреса: недостаток ширины ест чип «Где», а не они. */}
                    <span className="flex shrink-0">
                      <WhenChip value={dates} onClick={() => setWhenSheet(true)} buttonRef={whenChip} />
                    </span>
                    {whereCity && <WhereChip value={where} onClick={() => setWhereSheet(true)} buttonRef={whereChip} />}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
                    {typing ? list : empty}
                  </div>
                </>
              )}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <WhenField
        variant="sheet"
        value={dates}
        onChange={setDates}
        sheetOpen={open && whenSheet}
        onSheetOpenChange={setWhenSheet}
        returnFocus={() => whenChip.current}
      />
      {whereCity && (
        <WhereField
          key={whereCity.slug}
          variant="sheet"
          city={whereCity}
          value={where}
          onChange={setWhere}
          track={track}
          sheetOpen={open && whereSheet}
          onSheetOpenChange={setWhereSheet}
          returnFocus={() => whereChip.current}
        />
      )}
    </>
  );
}
