"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Image from "next/image";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ImageOff, LayoutGrid, Search, X } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import { ruPlural } from "@/lib/plural";
import { formatPrice } from "@/lib/catalog/format";
import { compact } from "@/lib/search/text";
import { highlight } from "@/lib/search/match";
import type { WhatValue } from "@/lib/search/submit-href";
import type { DateRange } from "@/lib/catalog/filters";
import { PopoverContent } from "@/components/ui/Popover";
import { MobileSuggestPanel, usePopoverLayout } from "./MobileSuggestPanel";
import {
  EMPTY_SUGGEST, SUGGEST_DEBOUNCE_MS, cachedSuggest, fetchSuggest, sameTyping, shouldApply,
  suggestQuery, type SuggestCategory, type SuggestItem, type SuggestResult,
} from "./suggest-client";

type Row =
  | { kind: "category"; key: string; category: SuggestCategory }
  | { kind: "listing"; key: string; item: SuggestItem }
  | { kind: "all"; key: string };

interface Reply {
  city: string;
  q: string;
  /** Даты запроса ключом: ответ на прежние даты не про этот выбор. */
  dates: string;
  result: SuggestResult;
}

const prevent = (e: React.SyntheticEvent | Event) => e.preventDefault();

// «Что» (перенос WhatField из sravniprokat). Подсказки — объявления и разделы
// города с сервера (/api/search/suggest), а не из клиентского индекса.
// Выбор подсказки или строка «Показать все» сразу отдаётся наверх (onPick):
// куда дальше — к «Когда» или в переход, — решает панель. Enter без
// выделенной строки отправляет форму — свободный текст.
//
// Поле прозрачное: вид несёт обёртка fieldWithin в SearchBar.
//
// Список — поповер под полем с lg и полноэкранная панель под шапкой ниже
// (MobileSuggestPanel). Фокус всегда остаётся в поле: курсор по строкам
// ведётся aria-activedescendant, строки отмечены data-active (globals.css).
export function WhatField({
  id, citySlug, dates = null, value, onChange, onPick, inputRef, label, labelClassName, placeholder,
  inputClassName, clearClassName, className, redirectFocus, panelToolbar,
}: {
  /** Стабильный id: не useId, поле рендерится и на сервере, ids совпадают при гидрации. */
  id: string;
  /** Город подсказок; без него поле — просто ввод со строкой «Показать все». */
  citySlug: string | undefined;
  /** Даты «Когда»: с ними подсказки — только свободные на эти дни вещи. */
  dates?: DateRange | null;
  value: string;
  onChange: (text: string) => void;
  onPick: (what: WhatValue) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  label: string;
  labelClassName?: string;
  placeholder: string;
  inputClassName?: string;
  /** Классы крестика очистки: в узкой шапке он прячется, чтобы не съесть поле. */
  clearClassName?: string;
  className?: string;
  /**
   * Ниже lg — куда отдать фокус вместо своего списка. Hero на телефоне так
   * открывает ту же панель, что и шапка: панель лежит под шапкой и закрыла бы
   * поле hero, в котором человек печатает. Фокус уходит только по касанию или
   * клику: с клавиатуры Tab вернул бы его в hero, и дальше по странице было бы
   * не пройти. С клавиатуры поле ниже lg — простой ввод без списка.
   */
  redirectFocus?: () => HTMLElement | null;
  /** Чипы других полей в верхней строке панели подсказок (ниже lg). */
  panelToolbar?: React.ReactNode;
}) {
  const popover = usePopoverLayout();
  const anchorRef = useRef<HTMLDivElement>(null);
  // Ниже lg у поля с redirectFocus своего списка нет — список у поля шапки.
  const ownList = popover || !redirectFocus;
  const [requested, setOpen] = useState(false);
  const open = requested && ownList;
  // Фокус пришёл от указателя, а не с клавиатуры: pointerdown идёт раньше focus.
  const byPointer = useRef(false);
  const [active, setActive] = useState(-1);
  const [reply, setReply] = useState<Reply | null>(null);
  const [popular, setPopular] = useState<Reply | null>(null);
  const seq = useRef(0);
  const shownSeq = useRef(0);
  // Текст на момент прихода ответа: ответ сверяется с ним, а не с замыканием.
  const textRef = useRef(value);
  textRef.current = value;

  const query = suggestQuery(value);
  const { from: datesFrom, to: datesTo } = dates ?? {};
  const datesKey = datesFrom && datesTo ? `${datesFrom}|${datesTo}` : "";
  // Одна значимая буква — не запрос (как на сервере): показываем популярное.
  const typing = compact(value).length >= 2;

  // Подсказки на набранный текст: с дебаунсом, а из кэша — сразу. Устаревший
  // ответ (пришёл позже более нового или на стёртый текст) отбрасывается.
  useEffect(() => {
    if (!open || !citySlug || !typing) return;
    const range = datesFrom && datesTo ? { from: datesFrom, to: datesTo } : null;
    const apply = (mine: number, result: SuggestResult | null) => {
      if (!shouldApply({ seq: mine, q: query }, shownSeq.current, textRef.current)) return;
      shownSeq.current = mine;
      // Ошибка (429, сеть, 5xx) выглядит как «подсказок нет»: строка
      // «Показать все» работает и без них.
      setReply({ city: citySlug, q: query, dates: datesKey, result: result ?? EMPTY_SUGGEST });
      setActive(-1);
    };
    const cached = cachedSuggest(citySlug, query, range);
    if (cached) {
      apply(++seq.current, cached);
      return;
    }
    const t = setTimeout(() => {
      const mine = ++seq.current;
      void fetchSuggest(citySlug, query, range).then((result) => apply(mine, result));
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [open, citySlug, typing, query, datesFrom, datesTo, datesKey]);

  // Популярные разделы — при первом фокусе, дальше из кэша.
  const popularHere = popular?.city === citySlug ? popular : null;
  const popularReady = popularHere !== null;
  useEffect(() => {
    if (!open || !citySlug || typing || popularReady) return;
    let live = true;
    void fetchSuggest(citySlug, "").then((result) => {
      if (live && result) setPopular({ city: citySlug, q: "", dates: "", result });
    });
    return () => { live = false; };
  }, [open, citySlug, typing, popularReady]);

  // Прошлый ответ держится, пока летит новый (без спиннера и мигания), — если
  // он про этот же ввод, а не про стёртый целиком.
  const shown = typing && reply && reply.city === citySlug && reply.dates === datesKey && sameTyping(reply.q, query)
    ? reply
    : null;
  const sections: { title: string; rows: Row[] }[] = typing
    ? [
      {
        title: content.search.categories,
        rows: (shown?.result.categories ?? []).map((c) => ({ kind: "category" as const, key: `c:${c.href}`, category: c })),
      },
      {
        title: content.search.listings,
        rows: (shown?.result.items ?? []).map((item) => ({ kind: "listing" as const, key: `l:${item.id}`, item })),
      },
    ].filter((s) => s.rows.length)
    : popularHere?.result.categories.length
      ? [{
        title: content.search.popular,
        rows: popularHere.result.categories.map((c) => ({ kind: "category" as const, key: `c:${c.href}`, category: c })),
      }]
      : [];
  const suggestions = sections.flatMap((s) => s.rows);
  // «Показать все» — последней строкой при любом тексте: ведёт на /search и
  // работает, даже когда сервер не ответил.
  const flat: Row[] = typing ? [...suggestions, { kind: "all", key: "all" }] : suggestions;
  const noMatches = shown !== null && suggestions.length === 0;
  const showList = open && flat.length > 0;

  const close = () => { setOpen(false); setActive(-1); };

  const choose = (row: Row) => {
    close();
    if (row.kind === "all") {
      onPick({ kind: "text", q: value });
    } else if (row.kind === "category") {
      onChange(row.category.name);
      onPick({ kind: "category", href: row.category.href });
    } else {
      onChange(row.item.title);
      onPick({ kind: "listing", href: row.item.href });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!showList) { setOpen(true); return; }
      const n = flat.length;
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : a <= 0 ? n - 1 : a - 1));
    } else if (e.key === "Enter" && showList && active >= 0 && flat[active]) {
      e.preventDefault();
      choose(flat[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close();
    }
  };

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const total = suggestions.length;
  const announce = !showList || !typing || !shown
    ? ""
    : total
      ? `${total} ${ruPlural(total, ...content.search.suggestCount)}`
      : content.search.noSuggest;

  const option = (row: Row, i: number) => (
    <div
      key={row.key}
      id={optionId(i)}
      role="option"
      aria-selected={i === active}
      data-active={i === active}
      onMouseDown={prevent}
      onMouseEnter={() => setActive(i)}
      onClick={() => choose(row)}
      className={cn(
        "flex min-h-[44px] cursor-pointer items-center gap-3 px-4 py-2 text-left",
        row.kind === "all" && suggestions.length > 0 && "mt-1 border-t border-border",
      )}
    >
      {row.kind === "listing" ? <Thumb url={row.item.photoUrl} /> : (
        <span className="grid h-10 w-10 shrink-0 place-items-center text-muted-foreground" aria-hidden="true">
          {row.kind === "category" ? <LayoutGrid className="h-4 w-4" /> : <Search className="h-4 w-4" />}
        </span>
      )}
      {row.kind === "all" ? (
        <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">
          {content.search.showAll(value.trim())}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 text-[15px] leading-snug text-foreground">
            {highlight(row.kind === "listing" ? row.item.title : row.category.name, typing ? value : "")
              .map((part, j) => (part.hit
                ? <b key={j} className="font-semibold">{part.text}</b>
                // Голым текстом, а не <span>: пробел между словами в
                // отдельном элементе выпадает из доступного имени строки.
                : <Fragment key={j}>{part.text}</Fragment>))}
          </span>
          <span className="truncate text-[13px] leading-snug text-muted-foreground">
            {row.kind === "listing" ? (
              <>
                {row.item.categoryName}
                {" · "}
                <span className="font-mark font-semibold text-foreground">{formatPrice(row.item.priceDay)}</span>
                {" "}
                {content.search.perDay}
              </>
            ) : (
              `${row.category.count} ${ruPlural(row.category.count, ...content.search.listingCount)}`
            )}
          </span>
        </span>
      )}
    </div>
  );

  let n = -1;
  const list = showList && (
    <>
      {noMatches && (
        <p className="px-4 pb-1 pt-3 text-sm text-muted-foreground">{content.search.noMatches(value.trim())}</p>
      )}
      <div id={listId} role="listbox" aria-label={content.search.suggestLabel} className="flex flex-col py-1.5">
        {sections.map((sec) => (
          <div key={sec.title} role="group" aria-label={sec.title}>
            {/* Заголовок группы уже прочитан её aria-label. */}
            <p aria-hidden="true" className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {sec.title}
            </p>
            {sec.rows.map((row) => option(row, ++n))}
          </div>
        ))}
        {typing && option(flat[flat.length - 1], flat.length - 1)}
      </div>
    </>
  );

  return (
    <PopoverPrimitive.Root open={popover && showList} onOpenChange={(o) => { if (!o) close(); }}>
      <PopoverPrimitive.Anchor asChild>
        <div ref={anchorRef} className={cn("flex min-w-0 flex-col", className)}>
          <label htmlFor={`${id}-input`} className={labelClassName}>{label}</label>
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              id={`${id}-input`}
              name="q"
              type="text"
              role="combobox"
              data-what-input
              aria-autocomplete="list"
              aria-expanded={showList}
              // Ссылка только на смонтированный список: aria-controls на
              // несуществующий id скринридер считает битой связью.
              aria-controls={showList ? listId : undefined}
              aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
              placeholder={placeholder}
              value={value}
              onPointerDown={() => { byPointer.current = true; }}
              onFocus={(e) => {
                const pointer = byPointer.current;
                byPointer.current = false;
                const target = !ownList && pointer ? redirectFocus?.() : null;
                if (target && target !== e.currentTarget) { target.focus(); return; }
                setOpen(true);
                setActive(-1);
                e.currentTarget.select();
              }}
              onBlur={() => { byPointer.current = false; close(); }}
              onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
              onKeyDown={onKeyDown}
              className={cn(
                "w-full min-w-0 truncate bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
                inputClassName,
              )}
            />
            {value !== "" && (
              <button
                type="button"
                aria-label={content.search.clear}
                onMouseDown={prevent}
                onClick={() => { onChange(""); setOpen(true); setActive(-1); inputRef.current?.focus(); }}
                className={cn("hoverable grid h-7 w-7 shrink-0 place-items-center rounded-sm text-muted-foreground", clearClassName)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </PopoverPrimitive.Anchor>

      <div role="status" className="sr-only">{announce}</div>

      {popover && showList && (
        <PopoverContent
          // Обёртка списка, а не диалог: фокус в нём не бывает.
          role="presentation"
          onOpenAutoFocus={prevent}
          onCloseAutoFocus={prevent}
          // Клик по самому полю — не «мимо»: список закроет blur, если надо.
          onInteractOutside={(e) => {
            if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          onMouseDown={prevent}
          className="max-h-[min(70vh,520px)] w-[min(560px,calc(100vw-32px))] min-w-[var(--radix-popover-trigger-width)] overflow-y-auto p-0"
        >
          {list}
        </PopoverContent>
      )}

      {!popover && open && (
        <MobileSuggestPanel onClose={() => inputRef.current?.blur()} toolbar={panelToolbar}>{list}</MobileSuggestPanel>
      )}
    </PopoverPrimitive.Root>
  );
}

function Thumb({ url }: { url: string | null }) {
  return (
    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
      {url ? (
        <Image src={url} alt="" fill sizes="40px" className="object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center text-muted-foreground">
          <ImageOff className="h-4 w-4" />
        </span>
      )}
    </span>
  );
}
