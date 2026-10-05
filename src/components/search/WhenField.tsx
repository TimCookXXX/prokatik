"use client";

import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CalendarDays, X } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import { dateRangeLabel, daysLabel, todayStr } from "@/lib/catalog/dates";
import type { DateRange } from "@/lib/catalog/filters";
import type { RangePick } from "@/lib/booking/range-pick";
import { PopoverContent } from "@/components/ui/Popover";
import { Modal, ModalContent, ModalTitle } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { filterChip } from "@/components/ui/filter-chip";
import { DateRangeCalendar, whenLabel } from "@/components/catalog/DateRangeCalendar";
import { usePopoverLayout } from "./MobileSuggestPanel";

const t = content.search.when;

// «Когда» в панели поиска. Порог тот же, что у списка «Что» (lg):
// - с lg — поповер под полем, два месяца, период фиксируется сам через 220 мс
//   после второго клика или закрытием поповера; переход — кнопкой поиска;
// - ниже — шторка Modal с одним месяцем и «Готово». В шапке ниже lg самого
//   поля нет: шторку открывает чип в панели подсказок (sheetOpen снаружи).
//
// «Сегодня» считается на клиенте при открытии, а не приходит пропом: шапка
// живёт в корневом layout'е и не перерисовывается, и после полуночи открытая
// вкладка разрешила бы выбрать вчерашний день.
export function WhenField({
  variant, value, onChange, sheetOpen, onSheetOpenChange, returnFocus, className,
}: {
  variant: "header" | "hero";
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
  /** Шторка под управлением снаружи — её открывает чип панели подсказок. */
  sheetOpen?: boolean;
  onSheetOpenChange?: (open: boolean) => void;
  /** Куда вернуть фокус, когда шторка закрылась (чип к тому времени размонтирован). */
  returnFocus?: () => HTMLElement | null;
  className?: string;
}) {
  const popover = usePopoverLayout();
  const [popOpen, setPopOpen] = useState(false);
  const [ownSheet, setOwnSheet] = useState(false);
  const sheet = sheetOpen ?? ownSheet;
  const [sel, setSel] = useState<RangePick | null>(value);
  const [today, setToday] = useState<string | null>(null);

  // Каждое открытие начинает с применённого значения и свежего «сегодня».
  const prepare = () => {
    setSel(value);
    setToday(todayStr());
  };

  const setSheet = (open: boolean) => {
    if (sheetOpen === undefined) setOwnSheet(open);
    onSheetOpenChange?.(open);
  };
  // Шторку готовим на переходе в «открыта», а не в обработчике: управляемую
  // снаружи открывает чип, и обработчика здесь у неё нет.
  const [wasSheet, setWasSheet] = useState(sheet);
  if (sheet !== wasSheet) {
    setWasSheet(sheet);
    if (sheet) prepare();
  }

  // Один выбранный день — однодневная аренда: обе границы включены.
  const commit = (s: RangePick | null) => onChange(s ? { from: s.from, to: s.to ?? s.from } : null);

  const onOpenChange = (open: boolean) => {
    if (open && !popover) { setSheet(true); return; }
    if (open) prepare();
    // Закрытие поповера и есть фиксация: кликнул мимо — выбор остаётся.
    else if (popOpen) commit(sel);
    setPopOpen(open);
  };

  const reset = () => {
    setSel(null);
    onChange(null);
    setPopOpen(false);
    setSheet(false);
  };

  const header = variant === "header";
  const valueText = value ? whenLabel(value.from, value.to) : t.any;

  return (
    <>
      <PopoverPrimitive.Root open={popover && popOpen} onOpenChange={onOpenChange}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            data-when
            aria-label={`${t.label}: ${valueText}`}
            className={cn(
              header
                ? "hoverable h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-sm"
                : "hoverable flex min-w-0 flex-col justify-center gap-0.5 rounded-sm px-3 py-1.5 text-left md:px-4",
              className,
            )}
          >
            {header ? (
              <>
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {value ? (
                  <span className="whitespace-nowrap text-foreground">
                    {dateRangeLabel(value.from, value.to)}
                    {/* Число дней — с xl: на lg шапка делит ряд с городом и меню. */}
                    <span className="hidden xl:inline"> · {daysLabel(value.from, value.to)}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t.label}</span>
                )}
              </>
            ) : (
              <>
                {/* Число дней — в подписи: строка значения делит ряд с «Что» и
                  * без него помещается в узкую колонку hero. */}
                <span className="truncate text-xs text-muted-foreground">
                  {t.label}{value && ` · ${daysLabel(value.from, value.to)}`}
                </span>
                <span className={cn(
                  "truncate py-0.5 text-base md:text-[17px]",
                  value ? "font-semibold text-foreground" : "text-muted-foreground",
                )}>
                  {value ? dateRangeLabel(value.from, value.to) : t.any}
                </span>
              </>
            )}
          </button>
        </PopoverPrimitive.Trigger>

        {popover && popOpen && today && (
          <PopoverContent className="w-[39rem] max-w-[calc(100vw-24px)] p-4">
            <DateRangeCalendar
              months={2}
              autoClose
              today={today}
              selected={sel}
              onSelect={setSel}
              onCommit={(range) => { onChange(range); setPopOpen(false); }}
            />
            {(sel || value) && (
              <div className="mt-1 flex">
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  <X className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t.any}
                </Button>
              </div>
            )}
          </PopoverContent>
        )}
      </PopoverPrimitive.Root>

      <Modal open={sheet} onOpenChange={setSheet}>
        <ModalContent
          aria-describedby={undefined}
          className="md:max-w-[26rem]"
          onCloseAutoFocus={(e) => {
            const target = returnFocus?.();
            if (!target) return;
            e.preventDefault();
            target.focus();
          }}
        >
          <ModalTitle className="mb-3 text-lg font-bold">{t.title}</ModalTitle>
          {today && (
            <DateRangeCalendar months={1} autoClose={false} today={today} selected={sel} onSelect={setSel} />
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={reset}>{t.any}</Button>
            <Button type="button" className="flex-1" onClick={() => { commit(sel); setSheet(false); }}>
              {t.done}
            </Button>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}

/** Чип «Когда» в верхней строке панели подсказок (шапка ниже lg). */
export function WhenChip({ value, onClick }: { value: DateRange | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${t.label}: ${value ? whenLabel(value.from, value.to) : t.any}`}
      // Язык чипов фильтра (8 px, выбранный — заливкой), но в рост поля панели.
      className={cn(filterChip(Boolean(value)), "h-9 min-w-0 text-sm")}
    >
      <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{value ? dateRangeLabel(value.from, value.to) : t.label}</span>
    </button>
  );
}
