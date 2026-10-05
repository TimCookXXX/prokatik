// Общий вид листинга категории/подкатегории: вводный блок из данных, дерево
// категорий, фильтры, сетка карточек, пагинация. Server component.

import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  buildCategoryTree, getAllCategories, getAvailabilityRows, getCategoryStats,
  getListingCountsByCategory, getListingsForCategories,
  DEFAULT_PAGE_SIZE,
  type City,
} from "@/server/catalog";
import {
  carryParams, defaultSort, filterParams, parseFilters, sortContextOf, sortOptionsFor,
  type CategorySearchParams,
} from "@/lib/catalog/filters";
import { singleCityScope, type CityScope } from "@/lib/catalog/city-scope";
import { todayStr, addDaysStr } from "@/lib/catalog/dates";
import { formatPrice, listingsCountLabel, ownersFromLabel } from "@/lib/catalog/format";
import { buildAvailabilityByListing } from "@/lib/catalog/availability";
import { ListingCard } from "@/components/catalog/ListingCard";
import { FilterForm, ListingFilters, type FilterState } from "@/components/catalog/ListingFilters";
import { ResultsToolbar } from "@/components/catalog/ResultsToolbar";
import { activeFilterCount } from "@/lib/catalog/filter-count";
import { CategoryTree } from "@/components/catalog/CategoryTree";
import { parseView } from "@/components/catalog/ViewToggle";

export type { CategorySearchParams } from "@/lib/catalog/filters";

export async function CategoryListing({
  city, categoryIds, basePath, activeRootSlug, activeSubSlug, activeLabel, searchParams,
  scope = singleCityScope(city.id),
}: {
  city: City;
  categoryIds: string[];
  basePath: string;        // текущая страница (для формы фильтров и пагинации)
  activeRootSlug?: string; // корень текущей страницы; на витрине города его нет
  activeSubSlug?: string;
  activeLabel: string;     // подпись на мобильном чипе выбора раздела
  searchParams: CategorySearchParams;
  /**
   * Города выдачи и точка «Где» (getCityScope): с точкой — весь регион, и
   * выдача, счётчики дерева и статистика считаются по нему. Без — сам город.
   */
  scope?: CityScope;
}) {
  const today = todayStr();
  const filters = parseFilters(searchParams, { today, region: scope.region });
  const multiCity = scope.cityIds.length > 1;
  const [{ items, total }, stats, cats, directCounts, ownCounts] = await Promise.all([
    getListingsForCategories(scope.cityIds, categoryIds, filters),
    getCategoryStats(scope.cityIds, categoryIds),
    getAllCategories(),
    getListingCountsByCategory(scope.cityIds),
    // Какие подкатегории вообще есть у города — их страницы живут без точки.
    multiCity ? getListingCountsByCategory([city.id]) : undefined,
  ]);
  const tree = buildCategoryTree(cats, directCounts, ownCounts);

  // Границы слайдера — из раздела. Совпали min и max (или цен нет вовсе) —
  // двигать нечего, панель покажет обычные поля ввода.
  const priceBounds =
    stats.minPriceDay !== null && stats.maxPriceDay !== null && stats.maxPriceDay > stats.minPriceDay
      ? { min: stats.minPriceDay, max: stats.maxPriceDay }
      : undefined;

  // Занятость всех карточек страницы одним запросом: на выбранные даты, а без
  // них — неделя от сегодня. Диапазон уже нормализован parseFilters (from не
  // раньше сегодня), так что карточка показывает свободу на те же дни, по
  // которым отфильтрована выдача, а не «Занято» из-за сегодняшнего дня.
  const from = filters.availableFrom ?? today;
  const to = filters.availableTo ?? addDaysStr(today, 6);
  const availRows = await getAvailabilityRows(items.map((i) => i.listing.id), from, to);
  const availByListing = buildAvailabilityByListing(availRows);
  // Переносимые параметры (даты и «Где») едут дальше по каталогу: в карточки, в
  // ветки дерева разделов и в скрытые поля фильтров — «Показать» их не теряет.
  const carry = carryParams(searchParams, { today });
  const carryQuery = carry.toString();

  const filterState: FilterState = {
    priceMin: filters.priceMin, priceMax: filters.priceMax,
    deposit: filters.deposit, handover: filters.handover,
    verifiedOnly: filters.verifiedOnly, sort: filters.sort,
  };

  const filterHidden = {
    ...Object.fromEntries(carry),
    view: searchParams.view ?? "",
    sort: searchParams.sort ?? "",
  };
  const categoryNav = (
    <CategoryTree
      tree={tree}
      citySlug={city.slug}
      activeRootSlug={activeRootSlug}
      activeSubSlug={activeSubSlug}
      carryQuery={carryQuery}
    />
  );

  const page = filters.page ?? 1;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  // Страница за концом выдачи — 404, а не пустая сетка с кодом 200. Пустая
  // первая страница остаётся: фильтры, которые всё отсеяли, — законный адрес.
  if (page > 1 && page > totalPages) notFound();
  const view = parseView(searchParams.view);
  const withParams = (mutate: (q: URLSearchParams) => void) => {
    const q = filterParams(searchParams, { today });
    mutate(q);
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const datesResetHref = withParams((q) => { q.delete("from"); q.delete("to"); });
  const gridHref = withParams((q) => q.delete("view"));
  const listHref = withParams((q) => q.set("view", "list"));

  // Адреса сортировки собирает сервер: SortMenu клиентский, и функцию через
  // границу ему не передать. Умолчание в адрес не пишется; «Ближе» — только с
  // действующей точкой «Где».
  const sortCtx = sortContextOf(filters);
  const sortOptions = sortOptionsFor(sortCtx).map((o) => {
    const q = filterParams(searchParams, { today });
    if (o.value === defaultSort(sortCtx)) q.delete("sort"); else q.set("sort", o.value);
    const qs = q.toString();
    return { ...o, href: qs ? `${basePath}?${qs}` : basePath };
  });

  const pageHref = (p: number) => {
    const q = filterParams(searchParams, { today });
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Вводный блок — только из данных */}
      {stats.listingCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {listingsCountLabel(stats.listingCount)} {ownersFromLabel(stats.ownerCount)}
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
        {/* Боковая панель — с md; на телефоне раздел и фильтры открываются из
          * ленты над выдачей (ResultsToolbar). Панель липнет под хедером:
          * отступ считается от его полного следа (--header-total), а не
          * забитым числом — высота хедера уже менялась. */}
        <aside className="hidden md:sticky md:top-[calc(var(--header-total)+1rem)] md:block md:h-fit md:w-64 md:shrink-0 md:self-start">
          <ListingFilters
            basePath={basePath}
            state={filterState}
            hidden={filterHidden}
            priceBounds={priceBounds}
            categoryNav={categoryNav}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Все ссылки ленты строятся от текущих параметров, чтобы
            * переключение одного не сбрасывало остальные и не тащило номер
            * страницы. */}
          <ResultsToolbar
            categoryLabel={activeLabel}
            categoryNav={categoryNav}
            filterForm={
              <FilterForm basePath={basePath} state={filterState} hidden={filterHidden} priceBounds={priceBounds} />
            }
            filterCount={activeFilterCount(filterState, priceBounds)}
            dates={{ from: filters.availableFrom, to: filters.availableTo, resetHref: datesResetHref, today }}
            sortOptions={sortOptions}
            sort={filters.sort}
            view={view}
            gridHref={gridHref}
            listHref={listHref}
          />

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
                  // Свой город у каждой: с «Где» в выдаче и соседние города региона.
                  citySlug={item.citySlug}
                  availabilityMap={availByListing.get(item.listing.id) ?? new Map()}
                  from={from}
                  to={filters.availableTo}
                  hrefQuery={carryQuery}
                  view={view}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <nav aria-label="Пагинация" className="mt-6 flex items-center justify-center gap-3 text-sm">
              {page > 1 && (
                <Link href={pageHref(page - 1) as never} className="tap-target rounded-sm border border-border px-3 py-1.5 hoverable">
                  ← Назад
                </Link>
              )}
              <span className="text-muted-foreground">Страница {page} из {totalPages}</span>
              {page < totalPages && (
                <Link href={pageHref(page + 1) as never} className="tap-target rounded-sm border border-border px-3 py-1.5 hoverable">
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
