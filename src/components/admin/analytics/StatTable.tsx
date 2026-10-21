// Таблица «Поисков»: первая колонка — текст (запрос, причина), остальные —
// числа справа. На телефоне листается вбок в своём контейнере.

import type { ReactNode } from "react";

export interface StatColumn<T> {
  key: string;
  label: string;
  numeric?: boolean;
  cell: (row: T) => ReactNode;
}

export function StatTable<T>({ rows, columns, rowKey }: {
  rows: T[];
  columns: StatColumn<T>[];
  rowKey: (row: T, index: number) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:font-mono [&>th]:text-2xs [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-mono [&>th]:text-muted-foreground">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? "text-right" : "text-left"}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-t border-border">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 ${c.numeric ? "whitespace-nowrap text-right tabular-nums" : "break-words"}`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
