// Период (7 или 30 дней) и «показать ботов и свои заходы» — ссылками: фильтры
// живут в адресе, страница читает их на сервере. Остальные параметры
// страницы (чьи устройства, поиск гостя) переходят в ссылки как есть.

import Link from "next/link";
import type { Route } from "next";
import { content } from "@theme/content";
import { filterChip } from "@/components/ui/filter-chip";
import { analyticsHref, type AnalyticsFilters } from "@/lib/analytics/admin-filters";

const t = content.adminAnalytics.period;

export function PeriodBar({
  base, filters, keep = {},
}: {
  base: string;
  filters: AnalyticsFilters;
  keep?: { user?: string | null; find?: string };
}) {
  const href = (f: AnalyticsFilters) => analyticsHref(base, { period: f.period, all: f.all, ...keep }) as Route;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-2xs uppercase tracking-mono text-muted-foreground">{t.label}</span>
      {t.options.map((o) => {
        const active = String(filters.period) === o.value;
        return (
          <Link
            key={o.value}
            href={href({ ...filters, period: Number(o.value) as AnalyticsFilters["period"] })}
            aria-current={active ? "page" : undefined}
            className={filterChip(active)}
          >
            {o.label}
          </Link>
        );
      })}
      <Link
        href={href({ ...filters, all: !filters.all })}
        aria-current={filters.all ? "true" : undefined}
        className={filterChip(filters.all)}
      >
        {t.showAll}
      </Link>
    </div>
  );
}
