"use client";

import { useEffect, useRef, useState } from "react";
// Свой useRouter у toploader: программный переход тоже запускает полосу
// загрузки. Без loading.tsx в каталоге другого отклика у перехода нет.
import { useRouter } from "nextjs-toploader/app";
import { CalendarDays, X } from "lucide-react";
import { content } from "@theme/content";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { Modal, ModalContent, ModalTitle } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { filterChip, toolbarChip, toolbarChipDesktop } from "@/components/ui/filter-chip";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/components/ui/use-desktop";
import { shortRangeLabel } from "@/lib/catalog/dates";
import type { RangePick } from "@/lib/booking/range-pick";
import { DateRangeCalendar } from "./DateRangeCalendar";

const t = content.search.when;

// Фильтр «свободно в эти даты» в шапке выдачи. Календарь без занятости: здесь
// выбирают период, а свободу в нём считает сервер по всем позициям сразу.
//
// С md — поповер у кнопки: календарь — вспомогательный выбор рядом с ней,
// затемнять ради него всю страницу незачем. Ниже — шторка Modal, как у «Когда»
// в панели поиска: поповер шириной в месяц на телефоне вылезал за кромку, а
// «Показать» и «Сбросить» в подвале шторки достаются большим пальцем.
//
// Диапазон применяется только целиком: одна выбранная граница ничего не
// фильтрует, иначе выдача менялась бы на полпути и объяснить это было бы нечем.
export function DateRangeFilter({
  from, to, resetHref, today,
}: {
  /** Уже нормализованный диапазон (parseFilters) — тот, что применён к выдаче. */
  from?: string;
  to?: string;
  /** Адрес без дат — готовой строкой: функцию клиенту через границу не передать. */
  resetHref: string;
  today: string;
}) {
  const router = useRouter();
  const desktop = useIsDesktop();
  const [popOpen, setPopOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);

  // Закрываем при прокрутке страницы. Radix держит поповер приклеенным к
  // кнопке, поэтому при скролле он уезжает вверх и наползает на липкий хедер:
  // тот ниже по z-index и накрыть поповер не может. Проще закрыть, чем городить
  // границы столкновений под высоту хедера. Шторку это не касается: под ней
  // страница не прокручивается.
  useEffect(() => {
    if (!popOpen) return;
    const close = () => setPopOpen(false);
    window.addEventListener("scroll", close, { passive: true });
    return () => window.removeEventListener("scroll", close);
  }, [popOpen]);
  const applied: RangePick | null = from && to ? { from, to } : null;
  const [range, setRange] = useState<RangePick | null>(applied);

  const active = applied !== null;
  const label = active ? shortRangeLabel(from!, to!) : t.any;

  // Каждое открытие начинает с применённого периода: брошенный выбор прошлого
  // раза выдачу не менял и всплывать не должен.
  const onOpenChange = (open: boolean) => {
    if (open) setRange(applied);
    if (open && !desktop) { setSheetOpen(true); return; }
    setPopOpen(open);
  };

  const apply = () => {
    if (!range?.to) return;
    const url = new URL(window.location.href);
    url.searchParams.set("from", range.from);
    url.searchParams.set("to", range.to);
    url.searchParams.delete("page");
    setPopOpen(false);
    setSheetOpen(false);
    router.push(`${url.pathname}${url.search}` as never);
  };

  // В шторке «Сбросить» есть всегда: применённые даты снимает переходом, а
  // недовыбранный период — просто очищает.
  const resetSheet = () => {
    if (!active) { setRange(null); return; }
    setSheetOpen(false);
    router.push(resetHref as never);
  };

  return (
    <>
      <Popover open={desktop && popOpen} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          {/* Ниже md чип открывает шторку, а не поповер, и Radix о ней не
            * знает: его aria-expanded так и остался бы false при открытой
            * шторке. Здесь открытость говорит сам чип; aria-controls Radix
            * ставит только открытому поповеру, а он в этом режиме закрыт. */}
          <button
            ref={chipRef}
            type="button"
            // С md — прежняя кнопка дат, с прежним зазором до значка. Накладка
            // ховера (.hoverable) остаётся: это общий язык наведения
            // (tokens.schema.md, «Состояния»), и у соседней сортировки она была.
            className={cn(
              filterChip(active), toolbarChip, toolbarChipDesktop(active),
              "whitespace-nowrap md:gap-2",
            )}
            {...(!desktop && { "aria-haspopup": "dialog" as const, "aria-expanded": sheetOpen })}
          >
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent>
          {/* Ширина обязательна: .rdp-theme тянет месяц и сетку на 100% контейнера
            * (он писался под карточку брони с известной шириной). У поповера
            * своей ширины нет, и без этого календарь растягивается во всю
            * доступную и рассыпается. */}
          <DateRangeCalendar
            months={1}
            autoClose={false}
            today={today}
            selected={range}
            onSelect={setRange}
            className="w-[19rem]"
          />
          <div className="mt-3 flex items-center gap-2">
            <Button type="button" size="sm" className="flex-1" onClick={apply} disabled={!range?.to}>
              {t.show}
            </Button>
            {active && (
              <Button asChild variant="ghost" size="sm">
                <a href={resetHref}>
                  <X className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t.reset}
                </a>
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Шторка открывается только жестом — Modal это требует: режим окна он
        * меряет в JS, и открытым с сервера его рендерить нельзя. */}
      <Modal open={sheetOpen} onOpenChange={setSheetOpen}>
        {/* Шторку открывает не её собственный Trigger, а чип поповера, и
          * Radix некуда вернуть фокус при закрытии — он падал на body. Вернуть
          * его на чип приходится вручную, как у «Когда» (WhenField). */}
        <ModalContent
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            chipRef.current?.focus();
          }}
        >
          <ModalTitle className="mb-3 text-lg font-bold">{t.title}</ModalTitle>
          <DateRangeCalendar
            months={1}
            autoClose={false}
            today={today}
            selected={range}
            onSelect={setRange}
          />
          <div className="mt-3 flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={resetSheet} disabled={!active && !range}>
              {t.reset}
            </Button>
            <Button type="button" className="flex-1" onClick={apply} disabled={!range?.to}>
              {t.show}
            </Button>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}
