// Таблица по дням периода: прямой ответ на «сколько было вчера и сколько из
// них приходили раньше». Широкая — листается вбок в своём контейнере, body
// при этом не скроллится.

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

export function DaysTable({ days, today }: { days: DayRow[]; today: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:font-mono [&>th]:text-2xs [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-mono [&>th]:text-muted-foreground">
            <th scope="col" className="text-left">{t.day}</th>
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col" className="text-right">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((row) => (
            <tr key={row.day} className="border-t border-border">
              <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-normal">
                {weekdayShort(row.day)} {formatDayMonthShort(row.day)}
                {row.day === today && <span className="ml-1.5 text-xs text-muted-foreground">{t.today}</span>}
              </th>
              {COLUMNS.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 text-right tabular-nums ${row[c.key] === 0 ? "text-muted-foreground" : ""}`}
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
