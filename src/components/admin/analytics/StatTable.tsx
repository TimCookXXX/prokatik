// Таблица «Поисков»: первая колонка — текст (запрос), остальные — причина и
// числа. С sm — таблица; на телефоне — список карточек: запрос крупно, под ним
// «человек: 2 · раз: 2 · причина: такого нет в каталоге». Таблица шире экрана
// прятала бы за прокруткой вбок как раз число людей — то, ради чего её
// открывают.

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
  const [lead, ...rest] = columns;
  return (
    <>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card sm:hidden">
        {rows.map((row, i) => (
          <li key={rowKey(row, i)} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
            <span className="break-words font-medium">{lead.cell(row)}</span>
            <span className="break-words text-muted-foreground">
              {rest.map((c, j) => (
                <span key={c.key}>
                  {j > 0 && " · "}
                  {c.label}: <span className="tabular-nums text-foreground">{c.cell(row)}</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="align-bottom [&>th]:px-3 [&>th]:py-2.5 [&>th]:font-mono [&>th]:text-2xs [&>th]:font-medium [&>th]:leading-tight [&>th]:text-muted-foreground">
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
    </>
  );
}
