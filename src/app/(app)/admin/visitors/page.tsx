import type { Metadata, Route } from "next";
import Link from "next/link";
import { content } from "@theme/content";
import { assertAdmin } from "@/lib/auth/assert-admin";
import { adminListVisitors, adminVisitorSummary } from "@/server/analytics-admin";
import { analyticsHref, cursorParam, parseVisitorListFilters } from "@/lib/analytics/admin-filters";
import { field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PeriodBar } from "@/components/admin/analytics/PeriodBar";
import { SummaryTiles } from "@/components/admin/analytics/SummaryTiles";
import { DaysTable } from "@/components/admin/analytics/DaysTable";
import { VisitorRow } from "@/components/admin/analytics/VisitorRow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Посетители — админка", robots: { index: false } };

const t = content.adminAnalytics;
const BASE = "/admin/visitors";

export default async function AdminVisitorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertAdmin();
  const filters = parseVisitorListFilters(await searchParams);
  const now = new Date();
  // Записи одного аккаунта, точный поиск и листание списка — это про гостей,
  // а не про сайт: сводка и таблица по всему сайту там только сдвигали бы
  // список на полтора экрана вниз и читались бы как цифры этого человека.
  const listOnly = Boolean(filters.user || filters.findText || filters.cursor);
  const [summary, list] = await Promise.all([
    listOnly ? null : adminVisitorSummary(filters, now),
    filters.findInvalid ? null : adminListVisitors(filters),
  ]);
  const base = { period: filters.period, all: filters.all };
  const keep = { user: filters.user, find: filters.findText || undefined };
  const cursor = filters.cursor ? { [filters.cursor.dir]: cursorParam(filters.cursor.at, filters.cursor.id) } : {};
  const pageHref = (c: { after?: string; before?: string }) =>
    analyticsHref(BASE, { ...base, ...keep, ...c }) as Route;
  // Карточка возвращает сюда же: с периодом, фильтром и страницей списка.
  const listQuery = analyticsHref("", { ...base, ...keep, ...cursor });
  const who = list?.user ? list.user.name || list.user.email : filters.user;

  return (
    <section aria-label={t.nav.visitors} className="flex flex-col gap-5">
      {summary?.capReached && (
        <p role="status" className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
          {t.capReached}
        </p>
      )}

      <PeriodBar base={BASE} filters={filters} keep={keep} />

      {summary && (
        <>
          <section aria-labelledby="summary" className="flex flex-col gap-2">
            <h2 id="summary" className="font-display text-lg font-bold">{t.summary.heading}</h2>
            <SummaryTiles totals={summary.totals} />
            <p className="text-xs text-muted-foreground">{t.summary.note}</p>
            {filters.all && <p className="text-xs text-muted-foreground">{t.period.allNote}</p>}
            <a href="#guests" className="self-start text-sm text-muted-foreground underline underline-offset-2 hoverable hover:text-foreground">
              {t.list.jump}
            </a>
          </section>

          <section aria-labelledby="days" className="flex flex-col gap-2">
            <h2 id="days" className="font-display text-lg font-bold">{t.days.heading}</h2>
            <DaysTable days={summary.days} today={summary.today} />
          </section>
        </>
      )}

      <section aria-labelledby="guests" className="flex scroll-mt-24 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="guests" className="min-w-0 break-words font-display text-lg font-bold">
            {who ? t.list.userHeading(who) : t.list.heading}
          </h2>
          {(filters.user || filters.findText) && (
            <Link href={analyticsHref(BASE, base) as Route} className="text-sm text-muted-foreground underline underline-offset-2 hoverable hover:text-foreground">
              {t.list.allGuests}
            </Link>
          )}
        </div>
        {filters.user && <p className="text-xs text-muted-foreground">{t.list.userNote}</p>}

        {/* Точный поиск: ClientID из Метрики или id браузера. GET — фильтр
          * остаётся в адресе, его можно переслать. */}
        <form name="admin_visitor_find" method="GET" action={BASE} className="flex flex-wrap gap-2">
          {filters.period !== 7 && <input type="hidden" name="period" value={filters.period} />}
          {filters.all && <input type="hidden" name="all" value="1" />}
          <label htmlFor="visitor-find" className="sr-only">{t.list.findLabel}</label>
          <input
            id="visitor-find"
            name="find"
            type="search"
            inputMode="text"
            autoComplete="off"
            defaultValue={filters.findText}
            placeholder={t.list.findPlaceholder}
            maxLength={64}
            className={`${field} h-11 min-w-0 flex-1 basis-56 px-3 text-sm`}
          />
          <Button type="submit" variant="outline">{t.list.findSubmit}</Button>
        </form>
        {filters.findInvalid && <p role="alert" className="text-sm text-destructive">{t.list.findInvalid}</p>}

        {list && list.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {filters.find ? t.list.findNothing : filters.user ? t.list.emptyUser : t.list.empty}
          </p>
        )}
        {list && list.rows.length > 0 && (
          <ul className="flex flex-col gap-2">
            {list.rows.map((row) => <VisitorRow key={row.id} row={row} now={now} listQuery={listQuery} />)}
          </ul>
        )}

        {list && (list.newer || list.older) && (
          <nav aria-label={t.list.heading} className="flex justify-between gap-2">
            {list.newer
              ? <Button asChild variant="outline" size="sm"><Link href={pageHref({ before: list.newer })}>{t.list.newer}</Link></Button>
              : <span />}
            {list.older
              ? <Button asChild variant="outline" size="sm"><Link href={pageHref({ after: list.older })}>{t.list.older}</Link></Button>
              : <span />}
          </nav>
        )}
      </section>
    </section>
  );
}
