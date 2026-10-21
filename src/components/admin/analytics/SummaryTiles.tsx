// Сводка за период: путь от «пришёл» до «отправил заявку» плитками. Люди —
// без повторов за весь период, а не сумма дней.

import { content } from "@theme/content";
import { Metric } from "@/components/ui/Metric";
import type { DayFigures } from "@/server/analytics-admin";

const t = content.adminAnalytics.summary;

const TILES: { key: keyof DayFigures; label: string }[] = [
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

export function SummaryTiles({ totals }: { totals: DayFigures }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {TILES.map(({ key, label }) => (
        <li key={key} className="rounded-lg border border-border bg-card px-3 py-2.5">
          {/* «Ничего не нашли» — охрой: это сигнал нехватки в каталоге. */}
          <Metric value={totals[key]} label={label} accent={key === "zero" && totals.zero > 0} />
        </li>
      ))}
    </ul>
  );
}
