"use client";

import { DayPicker } from "react-day-picker";
import { ru } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { freeQty, type DayLoad } from "@/lib/catalog/availability";
import { isTooShortEnd, latestStart } from "@/lib/booking/range-pick";

function parse(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Календарь выбора дат с учётом занятости. Занятые дни (свободно < qty) показаны
// и заблокированы. Логика выбора (pickup → dropoff) живёт в BookingWidget:
// сюда приходят from/to (пустые = ничего не выбрано), клик по дню уходит вверх.
//
// Минимальный срок дни не отключает: пока ждём «Вернуть», дни ближе минимума
// помечены модификатором short — клик по ним растянет диапазон (BookingWidget).
// Отключаются только дни, с которых минимум уже не помещается до горизонта, и
// только как начало аренды.
export function BookingCalendar({
  from, to, onDayPick, today, maxDate, availability, quantity, qty,
  minDays = 1, pickingEnd = false,
}: {
  from: string;
  to: string;
  onDayPick: (date: string) => void;
  today: string;
  maxDate: string;
  availability: Record<string, DayLoad>;
  quantity: number;
  qty: number;
  /** Минимальный срок аренды, дней. */
  minDays?: number;
  /** Следующий клик — «Вернуть»: начало уже выбрано. */
  pickingEnd?: boolean;
}) {
  const isBooked = (date: Date) => freeQty(quantity, availability[fmt(date)]) < qty;
  const lastStart = latestStart(maxDate, minDays);
  const isLateStart = (date: Date) => !pickingEnd && fmt(date) > lastStart;
  const isShort = (date: Date) => {
    const k = fmt(date);
    return pickingEnd && Boolean(from) && k !== from && isTooShortEnd(from, k, minDays);
  };
  const isDisabled = (date: Date) => {
    const k = fmt(date);
    return k < today || k > maxDate || isBooked(date) || isLateStart(date);
  };

  // Пусто → выбора нет; только from → одиночный день (ждём «Вернуть»).
  const selected = from ? { from: parse(from), to: parse(to || from) } : undefined;

  return (
    <div className="rdp-theme">
      {/* today передаём явно: своё «сегодня» DayPicker считает по времени
        * браузера, и у человека восточнее Москвы подсветка разошлась бы с
        * серверным today — вплоть до подсвеченного дня, тут же залоченного
        * как прошлый. */}
      <DayPicker
        locale={ru}
        mode="range"
        selected={selected}
        onSelect={() => {}}
        onDayClick={(date) => { if (!isDisabled(date)) onDayPick(fmt(date)); }}
        disabled={[{ before: parse(today) }, { after: parse(maxDate) }, isBooked, isLateStart]}
        modifiers={{ booked: isBooked, past: (date) => fmt(date) < today, short: isShort }}
        modifiersClassNames={{ booked: "rdp-booked", past: "rdp-past", short: "rdp-short" }}
        startMonth={parse(today)}
        endMonth={parse(maxDate)}
        today={parse(today)}
        weekStartsOn={1}
        showOutsideDays
      />
    </div>
  );
}
