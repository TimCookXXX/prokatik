"use client";

import { useEffect, useState } from "react";
// Свой useRouter у toploader: программный переход тоже запускает полосу
// загрузки. Без loading.tsx в каталоге другого отклика у перехода нет.
import { useRouter } from "nextjs-toploader/app";
import { CalendarDays, X } from "lucide-react";
import { content } from "@theme/content";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { Button } from "@/components/ui/button";
import { shortRangeLabel } from "@/lib/catalog/dates";
import type { RangePick } from "@/lib/booking/range-pick";
import { DateRangeCalendar } from "./DateRangeCalendar";

// Фильтр «свободно в эти даты» в шапке выдачи. Календарь без занятости: здесь
// выбирают период, а свободу в нём считает сервер по всем позициям сразу.
//
// Поповер, а не модалка: календарь — вспомогательный выбор рядом с кнопкой,
// затемнять ради него всю страницу незачем.
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
  const [open, setOpen] = useState(false);

  // Закрываем при прокрутке страницы. Radix держит поповер приклеенным к
  // кнопке, поэтому при скролле он уезжает вверх и наползает на липкий хедер:
  // тот ниже по z-index и накрыть поповер не может. Проще закрыть, чем городить
  // границы столкновений под высоту хедера.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, { passive: true });
    return () => window.removeEventListener("scroll", close);
  }, [open]);
  const [range, setRange] = useState<RangePick | null>(from && to ? { from, to } : null);

  const active = Boolean(from && to);
  const label = active ? shortRangeLabel(from!, to!) : content.search.when.any;

  const apply = () => {
    if (!range?.to) return;
    const url = new URL(window.location.href);
    url.searchParams.set("from", range.from);
    url.searchParams.set("to", range.to);
    url.searchParams.delete("page");
    setOpen(false);
    router.push(`${url.pathname}${url.search}` as never);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-sm border px-3 text-sm transition-colors ${
            active
              ? "border-selected bg-selected text-selected-foreground"
              : "border-border bg-background text-muted-foreground hover:text-foreground"
          }`}
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
            {content.search.when.show}
          </Button>
          {active && (
            <Button asChild variant="ghost" size="sm">
              <a href={resetHref}>
                <X className="mr-1 h-4 w-4" aria-hidden="true" />
                {content.search.when.reset}
              </a>
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
