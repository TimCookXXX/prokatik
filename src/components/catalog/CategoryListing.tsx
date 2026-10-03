// Общий вид листинга категории/подкатегории: вводный блок из данных, дерево
// категорий, фильтры, сетка карточек, пагинация. Server component.

import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  buildCategoryTree, getAllCategories, getAvailabilityRows, getCategoryStats,
  getListingCountsByCategory, getListingsForCategories,
  DEFAULT_PAGE_SIZE,
  type City,
} from "@/server/catalog";
import {
  defaultSort, filterParams, parseFilters, sortOptionsFor, type CategorySearchParams,
} from "@/lib/catalog/filters";
import { todayStr, addDaysStr } from "@/lib/catalog/dates";
import { formatPrice, listingsCountLabel, ownersCountLabel } from "@/lib/catalog/format";
import { buildAvailabilityByListing } from "@/lib/catalog/availability";
import { ListingCard } from "@/components/catalog/ListingCard";
import { ListingFilters, type FilterState } from "@/components/catalog/ListingFilters";
import { CategoryTree } from "@/components/catalog/CategoryTree";
import { SortMenu } from "@/components/catalog/SortMenu";
import { DateRangeFilter } from "@/components/catalog/DateRangeFilter";
import { ViewToggle, parseView } from "@/components/catalog/ViewToggle";

export type { CategorySearchParams } from "@/lib/catalog/filters";

export async function CategoryListing({
  city, categoryIds, basePath, activeRootSlug, activeSubSlug, activeLabel, searchParams,
}: {
  city: City;
  categoryIds: string[];
  basePath: string;        // текущая страница (для формы фильтров и пагинации)
  activeRootSlug?: string; // корень текущей страницы; на витрине города его нет
  activeSubSlug?: string;
  activeLabel: string;     // подпись на мобильной кнопке выбора раздела
  searchParams: CategorySearchParams;
}) {
  const filters = parseFilters(searchParams);
  const [{ items, total }, stats, cats, directCounts] = await Promise.all([
    getListingsForCategories(city.id, categoryIds, filters),
    getCategoryStats(city.id, categoryIds),
    getAllCategories(),
    getListingCountsByCategory(city.id),
  ]);
  const tree = buildCategoryTree(cats, directCounts);

  // Границы слайдера — из раздела. Совпали min и max (или цен нет вовсе) —
  // двигать нечего, панель покажет обычные поля ввода.
  const priceBounds =
    stats.minPriceDay !== null && stats.maxPriceDay !== null && stats.maxPriceDay > stats.minPriceDay
      ? { min: stats.minPriceDay, max: stats.maxPriceDay }
      : undefined;

  // Занятость всех карточек страницы на неделю — одним запросом.
  const from = todayStr();
  const to = addDaysStr(from, 6);
  const availRows = await getAvailabilityRows(items.map((i) => i.listing.id), from, to);
  const availByListing = buildAvailabilityByListing(availRows);

  const filterState: FilterState = {
    priceMin: filters.priceMin, priceMax: filters.priceMax,
    deposit: filters.deposit, handover: filters.handover,
    verifiedOnly: filters.verifiedOnly, sort: filters.sort,
  };

  const page = filters.page ?? 1;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const view = parseView(searchParams.view);
  const withParams = (mutate: (q: URLSearchParams) => void) => {
    const q = filterParams(searchParams);
    mutate(q);
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const datesResetHref = withParams((q) => { q.delete("from"); q.delete("to"); });
  const gridHref = withParams((q) => q.delete("view"));
  const listHref = withParams((q) => q.set("view", "list"));

  // Адреса сортировки собирает сервер: SortMenu клиентский, и функцию через
  // границу ему не передать. Умолчание в адрес не пишется.
  const sortOptions = sortOptionsFor().map((o) => {
    const q = filterParams(searchParams);
    if (o.value === defaultSort()) q.delete("sort"); else q.set("sort", o.value);
    const qs = q.toString();
    return { ...o, href: qs ? `${basePath}?${qs}` : basePath };
  });

  const pageHref = (p: number) => {
    const q = filterParams(searchParams);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Вводный блок — только из данных */}
      {stats.listingCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {listingsCountLabel(stats.listingCount)} от {ownersCountLabel(stats.ownerCount)}
          {stats.minPriceDay !== null && (
            <>
              , цены от {formatPrice(stats.minPriceDay)}
              {stats.maxPriceDay !== null && stats.maxPriceDay !== stats.minPriceDay && (
                <> до {formatPrice(stats.maxPriceDay)}</>
              )} за сутки
            </>
          )}
          {stats.avgDeposit !== null && <>, средний залог {formatPrice(stats.avgDeposit)}</>}.
        </p>
      )}

      <div className="flex flex-col gap-5 md:flex-row">
        {/* Панель липнет под хедером: отступ считается от его полного
          * следа (--header-total), а не забитым числом — высота хедера уже
          * менялась, и 80px тут держались случайно. */}
        <aside className="md:sticky md:top-[calc(var(--header-total)+1rem)] md:h-fit md:w-64 md:shrink-0 md:self-start">
          <ListingFilters
            basePath={basePath}
            state={filterState}
            hidden={{
              view: searchParams.view ?? "",
              from: searchParams.from ?? "",
              to: searchParams.to ?? "",
              sort: searchParams.sort ?? "",
            }}
            priceBounds={priceBounds}
            categoryLabel={activeLabel}
            categoryNav={
              <CategoryTree
                tree={tree}
                citySlug={city.slug}
                activeRootSlug={activeRootSlug}
                activeSubSlug={activeSubSlug}
              />
            }
          />
        </aside>

        <div className="flex flex-1 flex-col gap-4">
          {/* Шапка выдачи: даты слева, сортировка и вид справа. Все ссылки
            * строятся от текущих параметров, чтобы переключение одного не
            * сбрасывало остальные и не тащило номер страницы. */}
          <div className="surface flex items-center justify-between gap-2 p-1.5">
            <DateRangeFilter
              from={searchParams.from}
              to={searchParams.to}
              resetHref={datesResetHref}
              today={from}
            />
            <div className="flex items-center gap-2">
              <SortMenu options={sortOptions} current={filters.sort} />
              <ViewToggle view={view} gridHref={gridHref} listHref={listHref} />
            </div>
          </div>

          {items.length === 0 ? (
            <EmptyState>По этим условиям позиций не нашлось.</EmptyState>
          ) : (
            <div className={view === "list"
              ? "flex flex-col gap-3"
              : "grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3"}>
              {items.map((item) => (
                <ListingCard
                  key={item.listing.id}
                  item={item}
                  citySlug={city.slug}
                  availabilityMap={availByListing.get(item.listing.id) ?? new Map()}
                  from={from}
                  view={view}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <nav aria-label="Пагинация" className="mt-6 flex items-center justify-center gap-3 text-sm">
              {page > 1 && (
                <Link href={pageHref(page - 1) as never} className="rounded-sm border border-border px-3 py-1.5 hoverable">
                  ← Назад
                </Link>
              )}
              <span className="text-muted-foreground">Страница {page} из {totalPages}</span>
              {page < totalPages && (
                <Link href={pageHref(page + 1) as never} className="rounded-sm border border-border px-3 py-1.5 hoverable">
                  Вперёд →
                </Link>
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
