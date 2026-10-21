import type { Metadata } from "next";
import { content } from "@theme/content";
import { assertAdmin } from "@/lib/auth/assert-admin";
import { adminSearchStats, type SearchStats } from "@/server/analytics-admin";
import { parseAnalyticsFilters } from "@/lib/analytics/admin-filters";
import { describeReason } from "@/lib/analytics/describe";
import { PeriodBar } from "@/components/admin/analytics/PeriodBar";
import { StatTable, type StatColumn } from "@/components/admin/analytics/StatTable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Поиски — админка", robots: { index: false } };

const t = content.adminAnalytics.searches;

const query = (q: string | null) => q ?? <span className="text-muted-foreground">{t.noQuery}</span>;
const numbers = <T extends { people: number; times: number }>(): StatColumn<T>[] => [
  { key: "people", label: t.people, numeric: true, cell: (r) => r.people },
  { key: "times", label: t.times, numeric: true, cell: (r) => r.times },
];

const TOP: StatColumn<SearchStats["top"][number]>[] = [
  { key: "q", label: t.query, cell: (r) => query(r.q) },
  ...numbers<SearchStats["top"][number]>(),
  { key: "lastTotal", label: t.lastTotal, numeric: true, cell: (r) => r.lastTotal ?? "—" },
];

// Сколько людей — сразу за запросом: ради этого числа таблицу и открывают.
const ZERO: StatColumn<SearchStats["zero"][number]>[] = [
  { key: "q", label: t.query, cell: (r) => query(r.q) },
  ...numbers<SearchStats["zero"][number]>(),
  { key: "reason", label: t.reason, cell: (r) => describeReason(r.reason) },
];

const PARTIAL: StatColumn<SearchStats["partial"][number]>[] = [
  { key: "q", label: t.query, cell: (r) => query(r.q) },
  { key: "usedQuery", label: t.usedQuery, cell: (r) => r.usedQuery ?? "—" },
  ...numbers<SearchStats["partial"][number]>(),
  { key: "lastTotal", label: t.lastTotal, numeric: true, cell: (r) => r.lastTotal ?? "—" },
];

function Block<T>({ id, title, note, rows, columns, rowKey }: {
  id: string;
  title: string;
  note: string;
  rows: T[];
  columns: StatColumn<T>[];
  rowKey: (row: T, i: number) => string;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="font-display text-lg font-bold">{title}</h2>
      <p className="text-xs text-muted-foreground">{note}</p>
      {rows.length === 0
        ? <p className="text-sm text-muted-foreground">{t.empty}</p>
        : <StatTable rows={rows} columns={columns} rowKey={rowKey} />}
    </section>
  );
}

export default async function AdminSearchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertAdmin();
  const filters = parseAnalyticsFilters(await searchParams);
  const stats = await adminSearchStats(filters);

  return (
    <section aria-label={content.adminAnalytics.nav.searches} className="flex flex-col gap-5">
      <PeriodBar base="/admin/searches" filters={filters} />
      <Block id="zero" title={t.zero} note={t.zeroNote} rows={stats.zero} columns={ZERO}
        rowKey={(r) => `${r.q ?? ""}|${r.reason}`} />
      <Block id="top" title={t.top} note={t.topNote} rows={stats.top} columns={TOP} rowKey={(r) => r.q ?? ""} />
      <Block id="partial" title={t.partial} note={t.partialNote} rows={stats.partial} columns={PARTIAL}
        rowKey={(r) => `${r.q ?? ""}|${r.usedQuery ?? ""}`} />
    </section>
  );
}
