"use client";

import { useEffect, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import { ru } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import { BOOKING_HORIZON_DAYS } from "@/lib/booking/params";
import { pickRange, type RangePick } from "@/lib/booking/range-pick";
import {
  addDaysStr, dateRangeLabel, daysLabel, formatDayMonthShort,
} from "@/lib/catalog/dates";
import type { DateRange } from "@/lib/catalog/filters";

// Пауза перед автозакрытием: успеть увидеть выбранный период.
const AUTO_CLOSE_MS = 220;

const PREVIEW_CLASSES = {
  preview_start: "rdp-selected rdp-range_start",
  preview_middle: "rdp-selected rdp-range_middle",
  preview_end: "rdp-selected rdp-range_end",
};

function parse(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}
function fmt(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Подпись выбранного периода: «сб 12 — пн 14 окт · 3 дня». */
export function whenLabel(from: string, to: string): string {
  return `${dateRangeLabel(from, to)} · ${daysLabel(from, to)}`;
}

// Календарь диапазона без занятости — для поиска: поле «Когда» в панели и
// фильтр дат на выдаче. Сетка — react-day-picker (клавиатура, ARIA, тема
// .rdp-theme), взаимодействие — из sravniprokat:
// - два клика в любом порядке (pickRange), второй в тот же день — один день;
// - пока выбран только первый день, под курсором виден будущий период;
// - строка статуса aria-live говорит, что делать дальше;
// - autoClose: через 220 мс после второго клика выбор фиксируется сам.
//
// Выбор держит потребитель (selected/onSelect): чем его зафиксировать —
// закрытием поповера, «Готово» или «Показать», — решает он. Дни раньше today и
// дальше горизонта брони закрыты: забронировать их всё равно нельзя.
export function DateRangeCalendar({
  months, autoClose, today, selected, onSelect, onCommit, className,
}: {
  /** Сколько месяцев рядом — по контейнеру потребителя, а не по ширине окна. */
  months: 1 | 2;
  autoClose: boolean;
  /** Сегодня "YYYY-MM-DD": своё «сегодня» DayPicker берёт из часов браузера. */
  today: string;
  selected: RangePick | null;
  onSelect: (sel: RangePick) => void;
  /** Период готов; с autoClose — после паузы, без него не вызывается. */
  onCommit?: (range: DateRange) => void;
  className?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (closing.current) clearTimeout(closing.current); }, []);

  const lastDay = addDaysStr(today, BOOKING_HORIZON_DAYS);
  const inRange = (d: string) => d >= today && d <= lastDay;
  const awaitingEnd = Boolean(selected?.from && !selected.to);

  const pick = (day: string) => {
    if (closing.current) clearTimeout(closing.current);
    const next = pickRange(selected ?? {}, day);
    onSelect(next);
    setHover(null);
    if (next.to && autoClose && onCommit) {
      const range = { from: next.from, to: next.to };
      closing.current = setTimeout(() => onCommit(range), AUTO_CLOSE_MS);
    }
  };

  // Пока ждём второй день — превью до курсора. Оно только рисуется: в selected
  // DayPicker уходит настоящий выбор, иначе aria-selected получали бы дни, по
  // которым просто прошла стрелка, и скринридер называл бы их выбранными.
  const preview: DateRange | null = selected && !selected.to
    ? hover
      ? (hover < selected.from ? { from: hover, to: selected.from } : { from: selected.from, to: hover })
      : { from: selected.from, to: selected.from }
    : null;

  const status = selected?.to
    ? whenLabel(selected.from, selected.to)
    : selected
      ? content.search.when.pickLast(formatDayMonthShort(selected.from))
      : content.search.when.pickFirst;

  // Превью и с клавиатуры: фокус на дне — то же, что курсор над ним.
  const onHover = (date: Date) => {
    const d = fmt(date);
    if (awaitingEnd && inRange(d)) setHover(d);
  };

  return (
    <div className={cn("rdp-theme", months === 2 && "rdp-pair", className)} onMouseLeave={() => setHover(null)}>
      {/* today явно — см. BookingCalendar: своё «сегодня» DayPicker берёт из
        * времени браузера, а не из деловой зоны. */}
      <DayPicker
        mode="range"
        locale={ru}
        numberOfMonths={months}
        selected={selected
          ? { from: parse(selected.from), to: selected.to ? parse(selected.to) : undefined }
          : undefined}
        // Превью красится классами выбранного диапазона (rdp-selected снимает с
        // дня ховер темы), но aria-selected от них не появляется.
        modifiers={preview ? {
          preview_start: parse(preview.from),
          preview_end: parse(preview.to),
          preview_middle: { after: parse(preview.from), before: parse(preview.to) },
        } : undefined}
        modifiersClassNames={PREVIEW_CLASSES}
        // Выбор считает pickRange, а не DayPicker: у библиотеки своя логика
        // диапазона (клик внутри готового двигает границу), у нас — SP.
        onSelect={() => {}}
        onDayClick={(date, modifiers) => { if (!modifiers.disabled) pick(fmt(date)); }}
        onDayMouseEnter={onHover}
        onDayFocus={onHover}
        disabled={[{ before: parse(today) }, { after: parse(lastDay) }]}
        startMonth={parse(today)}
        endMonth={parse(lastDay)}
        defaultMonth={parse(selected?.from ?? today)}
        today={parse(today)}
        weekStartsOn={1}
      />
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-center text-sm font-semibold text-foreground">
        {status}
      </p>
    </div>
  );
}
