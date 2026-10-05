// Выдача поиска: тот же вид, что у категории (фильтры + сетка карточек +
// пагинация), но источник — searchListings по городу. Server component.
//
// Запрос здесь — обычный сужающий фильтр, а не условие существования страницы:
// без него показывается весь город, с ним — то, что нашлось. Поэтому фильтры,
// разделы и верхняя панель живут независимо от `q`.
//
// Что нашлось и в каком порядке, решает индекс поиска (rankListingIds) — тот
// же, которым подсказки в шапке проверяют свои фразы. SQL получает готовый
// набор id и считает поверх него фильтры, фасеты, число найденного и страницы.

import Link from "next/link";
import { content } from "@theme/content";
import { ruPlural } from "@/lib/plural";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  getAllCategories, getAvailabilityRows, getSearchFacets, rollupToRoots,
  searchListings, DEFAULT_PAGE_SIZE, type City, type SearchMatch,
} from "@/server/catalog";
import { rankListingIds, type RankedIds } from "@/server/search";
import {
  carryParams, defaultSort, filterParams, parseFilters, sortContextOf, sortOptionsFor,
  type CategorySearchParams,
} from "@/lib/catalog/filters";
import { singleCityScope, type CityScope } from "@/lib/catalog/city-scope";
import { todayStr, addDaysStr } from "@/lib/catalog/dates";
import { buildAvailabilityByListing } from "@/lib/catalog/availability";
import { ListingCard } from "@/components/catalog/ListingCard";
import { FilterForm, ListingFilters, type FilterState } from "@/components/catalog/ListingFilters";
import { ResultsToolbar } from "@/components/catalog/ResultsToolbar";
import { activeFilterCount } from "@/lib/catalog/filter-count";
import { CategoryFacets } from "@/components/catalog/CategoryFacets";
import { parseView } from "@/components/catalog/ViewToggle";

export async function SearchResults({
  city, q, searchParams, scope = singleCityScope(city.id),
}: {
  city: City;
  q: string;
  searchParams: CategorySearchParams;
  /**
   * Города выдачи и точка «Где» (getCityScope): с точкой — весь регион, и
   * индекс поиска, выдача и фасеты считаются по нему. Без — сам город.
   */
  scope?: CityScope;
}) {
  // Категории и ранжирование идут отдельной волной, а не в общем Promise.all
  // ниже: от них зависят narrowIds и набор id, то есть сам запрос выдачи. На
  // витрине города такой зависимости нет — там набор разделов задаёт страница.
  const [cats, ranked] = await Promise.all([getAllCategories(), rankQuery(scope.cityIds, q)]);
  // Условие запроса: id из индекса; индекс упал — ILIKE по тексту; запроса нет
  // или в нём нет слов для поиска (одни стоп-слова) — весь город.
  const match: SearchMatch = ranked?.ids ? { ids: ranked.ids }
    : ranked === undefined ? { text: q } : { text: "" };
  // Без набора id сортировать по релевантности нечем — тогда и умолчание, и
  // меню как без запроса.
  const rankedQ = "ids" in match ? q : undefined;
  const today = todayStr();
  const filters = parseFilters(searchParams, { q: rankedQ, region: scope.region, today });
  const sortCtx = sortContextOf(filters, rankedQ);

  // Сужение по разделу: слаг из адреса → корень и все его подкатегории. Раздела
  // нет или слаг чужой — сужения нет, ищем по всему городу.
  const activeRoot = searchParams.category
    ? cats.find((c) => c.slug === searchParams.category && c.parentId === null)
    : undefined;
  const narrowIds = activeRoot
    ? [activeRoot.id, ...cats.filter((c) => c.parentId === activeRoot.id).map((c) => c.id)]
    : undefined;

  const [{ items, total }, facets] = await Promise.all([
    searchListings(scope.cityIds, match, filters, narrowIds),
    getSearchFacets(scope.cityIds, match, filters),
  ]);

  // Занятость всех карточек страницы одним запросом: на выбранные даты, а без
  // них — неделя от сегодня. Диапазон уже нормализован parseFilters (from не
  // раньше сегодня), так что карточка показывает свободу на те же дни, по
  // которым отфильтрована выдача, а не «Занято» из-за сегодняшнего дня.
  const from = filters.availableFrom ?? today;
  const to = filters.availableTo ?? addDaysStr(today, 6);
  const availRows = await getAvailabilityRows(items.map((i) => i.listing.id), from, to);
  const availByListing = buildAvailabilityByListing(availRows);
  // Переносимые параметры (даты и «Где») — в ссылки карточек и скрытые поля фильтров.
  const carry = carryParams(searchParams, { today });
  const carryQuery = carry.toString();

  // Границы слайдера — по результатам запроса, а не по всему городу: иначе
  // ручки стояли бы на ценах, которых в выдаче нет. Исключение — сам ценовой
  // фильтр: его getSearchFacets в границы не учитывает, иначе диапазон
  // схлопывался бы к выбранному и разжать его назад было бы нечем.
  const priceBounds =
    facets.minPriceDay !== null && facets.maxPriceDay !== null
      && facets.maxPriceDay > facets.minPriceDay
      ? { min: facets.minPriceDay, max: facets.maxPriceDay }
      : undefined;

  // Счётчики разделов — роллап прямых счётчиков на корни, как в дереве каталога.
  const rootCounts = rollupToRoots(cats, facets.countsByCategory);
  const view = parseView(searchParams.view);
  const searchHref = (params: URLSearchParams) => {
    if (q) params.set("q", q);
    params.set("city", city.slug);
    return `/search?${params.toString()}`;
  };
  const categoryFacets = cats
    .filter((c) => c.parentId === null && (rootCounts.get(c.id) ?? 0) > 0)
    .map((c) => {
      const params = filterParams(searchParams, { today });
      params.set("category", c.slug);
      return { slug: c.slug, name: c.name, count: rootCounts.get(c.id) ?? 0, href: searchHref(params) };
    });
  const allCategoriesHref = (() => {
    const params = filterParams(searchParams, { today });
    params.delete("category");
    return searchHref(params);
  })();

  const withParams = (mutate: (q: URLSearchParams) => void) => {
    const q = filterParams(searchParams, { today });
    mutate(q);
    return searchHref(q);
  };
  const datesResetHref = withParams((q) => { q.delete("from"); q.delete("to"); });
  const gridHref = withParams((q) => q.delete("view"));
  const listHref = withParams((q) => q.set("view", "list"));

  const filterState: FilterState = {
    priceMin: filters.priceMin, priceMax: filters.priceMax,
    deposit: filters.deposit, handover: filters.handover,
    verifiedOnly: filters.verifiedOnly, sort: filters.sort,
  };

  const filterHidden = {
    ...Object.fromEntries(carry),
    q,
    city: city.slug,
    category: searchParams.category ?? "",
    view: searchParams.view ?? "",
    sort: searchParams.sort ?? "",
  };
  const categoryNav = (
    <CategoryFacets facets={categoryFacets} allHref={allCategoriesHref} activeSlug={activeRoot?.slug} />
  );

  // Сужена ли выдача хоть чем-нибудь, кроме запроса, — от этого зависит текст
  // пустого состояния. Считаем по разобранным фильтрам, а не по filterParams:
  // туда входят вид и сортировка, а они выдачу не сужают и «условиями» не
  // являются.
  const hasFilters = Boolean(
    filters.priceMin !== undefined || filters.priceMax !== undefined
    || filters.deposit || filters.handover || filters.verifiedOnly
    || (filters.availableFrom && filters.availableTo) || activeRoot,
  );

  const page = filters.page ?? 1;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  // Умолчание в адрес не пишется: при запросе это «подходящие», и тогда
  // «новые» — явное `sort=new`.
  const sortOptions = sortOptionsFor(sortCtx).map((o) => {
    const params = filterParams(searchParams, { today });
    if (q) params.set("q", q);
    params.set("city", city.slug);
    if (o.value === defaultSort(sortCtx)) params.delete("sort"); else params.set("sort", o.value);
    return { ...o, href: `/search?${params.toString()}` };
  });

  const pageHref = (p: number) => {
    const params = filterParams(searchParams, { today });
    if (q) params.set("q", q);
    params.set("city", city.slug);
    if (p > 1) params.set("page", String(p));
    return `/search?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5 md:flex-row">
      {/* Боковая панель — с md; на телефоне раздел и фильтры открываются из
        * ленты над выдачей (ResultsToolbar). */}
      <aside className="hidden md:sticky md:top-[calc(var(--header-total)+1rem)] md:block md:h-fit md:w-64 md:shrink-0 md:self-start">
        <ListingFilters
          basePath="/search"
          state={filterState}
          priceBounds={priceBounds}
          hidden={filterHidden}
          categoryNav={categoryNav}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {/* Лента видна всегда, в том числе на пустой выдаче: единственный
          * способ снять фильтр дат — её календарь, а «Сбросить» в фильтрах
          * даты не трогает. Спрячь ленту на нуле результатов — и выбранные
          * даты стало бы нечем убрать, кроме правки адреса. */}
        <ResultsToolbar
          categoryLabel={activeRoot?.name ?? "Все разделы"}
          categoryNav={categoryNav}
          filterForm={
            <FilterForm basePath="/search" state={filterState} hidden={filterHidden} priceBounds={priceBounds} />
          }
          filterCount={activeFilterCount(filterState, priceBounds)}
          dates={{ from: filters.availableFrom, to: filters.availableTo, resetHref: datesResetHref, today }}
          sortOptions={sortOptions}
          sort={filters.sort}
          view={view}
          gridHref={gridHref}
          listHref={listHref}
        />
        {ranked?.ids && ranked.dropped.length > 0 && (
          <p role="status" className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
            {content.search.subsetNotice(q, ranked.usedQuery)}
          </p>
        )}
        {items.length === 0 ? (
          // Пусто по разным причинам, и валить их в одну фразу нельзя: «в
          // городе ничего нет» — прямая ложь, когда выдачу обнулил фильтр или
          // номер страницы за концом списка. Страница вперёд идёт первой: с
          // неё ещё и уйти нужно ссылкой, кнопок пагинации внизу уже нет.
          page > 1 ? (
            <EmptyState>
              На этой странице ничего нет.{" "}
              <Link href={pageHref(1) as never} className="text-accent hoverable">
                Вернуться к началу выдачи
              </Link>
            </EmptyState>
          ) : q !== "" ? (
            <EmptyState>Ничего не найдено по запросу «{q}».</EmptyState>
          ) : hasFilters ? (
            <EmptyState>По этим условиям позиций не нашлось.</EmptyState>
          ) : (
            <EmptyState>В этом городе пока нечего арендовать.</EmptyState>
          )
        ) : (
          <>
            {/* Число найденного — только здесь: подсказки «Что» чисел не
              * показывают (docs/decisions/0023). */}
            <p className="text-sm text-muted-foreground">
              {total} {ruPlural(total, ...content.search.listingCount)}
            </p>
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
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Ранжирование запроса по индексу. null — запроса нет; undefined — индекс
 * недоступен, и выдача уходит на аварийный ILIKE (ошибка в лог, страница жива).
 */
async function rankQuery(cityIds: string[], q: string): Promise<RankedIds | null | undefined> {
  if (!q) return null;
  try {
    return await rankListingIds(cityIds, q);
  } catch (e) {
    console.error("[search] индекс поиска недоступен, выдача по ILIKE:", e);
    return undefined;
  }
}
