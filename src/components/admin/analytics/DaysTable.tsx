// Таблица по дням периода: прямой ответ на «сколько было вчера и сколько из
// них приходили раньше». На ноутбуке помещается в колонку админки: подписи
// столбцов переносятся по словам, без разрядки и капса. На телефоне листается
// вбок в своём контейнере (body при этом не скроллится), а столбец дня стоит
// на месте — дата видна при любой прокрутке.

import { content } from "@theme/content";
import { formatDayMonthShort, weekdayShort } from "@/lib/catalog/dates";
import type { DayFigures, DayRow } from "@/server/analytics-admin";

const t = content.adminAnalytics.days;

const COLUMNS: { key: keyof DayFigures; label: string }[] = [
  { key: "people", label: t.people },
  { key: "new", label: t.new },
  { key: "returned", label: t.returned },
  { key: "searched", label: t.searched },
  { key: "zero", label: t.zero },
  { key: "viewed", label: t.viewed },
  { key: "clicked", label: t.clicked },
  { key: "requested", label: t.requested },
  { key: "signups", label: t.signups },
];

// Столбец дня прилипает слева: фон карточки, иначе цифры проезжали бы под ним.
const DAY_CELL = "sticky left-0 z-10 bg-card px-3 text-left";

export function DaysTable({ days, today }: { days: DayRow[]; today: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[600px] border-collapse text-sm">
        <thead>
          <tr className="align-bottom [&>th]:py-2.5 [&>th]:font-mono [&>th]:text-2xs [&>th]:font-medium [&>th]:leading-tight [&>th]:text-muted-foreground">
            <th scope="col" className={DAY_CELL}>{t.day}</th>
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col" className="px-2 text-right lg:px-1.5">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((row) => (
            <tr key={row.day} className="border-t border-border">
              <th scope="row" className={`${DAY_CELL} whitespace-nowrap py-2 font-normal`}>
                {weekdayShort(row.day)} {formatDayMonthShort(row.day)}
                {row.day === today && <span className="ml-1.5 text-xs text-muted-foreground">{t.today}</span>}
              </th>
              {COLUMNS.map((c) => (
                <td
                  key={c.key}
                  className={`px-2 py-2 text-right tabular-nums lg:px-1.5 ${row[c.key] === 0 ? "text-muted-foreground" : ""}`}
                >
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
