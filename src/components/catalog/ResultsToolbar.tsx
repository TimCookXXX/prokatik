// Лента управления выдачей каталога и поиска: «Категория · Фильтры (n) ·
// Даты · Сортировка» одним рядом над карточками. Server component.
//
// Каждый контрол — в одном экземпляре, раскладку меняет ширина:
// - на телефоне ряд листается вбок и прилипает под шапкой при прокрутке;
//   раздел и фильтры открываются шторками, переключатель сетки и списка живёт
//   в шторке фильтров — в ряду ему места нет;
// - с md раздел и фильтры стоят боковой панелью (ListingFilters), их чипы
//   скрыты, а в ряду остаются даты слева и сортировка с видом справа.
//
// Ряд стоит в общем столбце выдачи, а не в <aside>: на телефоне боковой
// панели нет, и всё, что над карточками, — эта лента.

import { content } from "@theme/content";
import { CategorySheet } from "@/components/catalog/CategorySheet";
import { FiltersSheet } from "@/components/catalog/FiltersSheet";
import { DateRangeFilter } from "@/components/catalog/DateRangeFilter";
import { SortMenu, type SortOption } from "@/components/catalog/SortMenu";
import { ViewToggle, type ListingView } from "@/components/catalog/ViewToggle";

export function ResultsToolbar({
  categoryLabel, categoryNav, filterForm, filterCount, dates, sortOptions, sort, view, gridHref, listHref,
}: {
  /** Текущий раздел — подпись чипа «Категория». */
  categoryLabel: string;
  categoryNav: React.ReactNode;
  filterForm: React.ReactNode;
  /** activeFilterCount по применённым фильтрам панели. */
  filterCount: number;
  dates: { from?: string; to?: string; resetHref: string; today: string };
  sortOptions: SortOption[];
  sort?: string;
  view: ListingView;
  gridHref: string;
  listHref: string;
}) {
  const toggle = (className?: string) => (
    <ViewToggle view={view} gridHref={gridHref} listHref={listHref} className={className} />
  );

  return (
    // Липкость — только ниже md: там лента и есть вся панель управления. Верх
    // — на нижний зазор шапки раньше её полного следа, и тот же зазор
    // отступом сверху: прилипшая лента закрывает фоном щель под плавающей
    // панелью шапки, и карточки не просвечивают между ними.
    // -mx-4 — фон и прокрутка во всю ширину экрана, за поля <main>.
    <div
      role="group"
      aria-label={content.catalogToolbar.label}
      data-results-toolbar
      className="max-md:sticky max-md:top-[calc(var(--header-total)-var(--header-inset))] max-md:z-30 max-md:-mx-4 max-md:bg-background max-md:pb-2 max-md:pt-[var(--header-inset)]"
    >
      {/* Ряд прокручивается от кромки до кромки экрана: поля <main> стоят
        * внутри прокрутки (px-4), и чип не обрезается за 16px до края, а
        * уходит за него — так видно, что ряд листается. Поля по вертикали —
        * место кольцу фокуса: overflow-x режет и по вертикали. */}
      <div className="-my-1 flex items-center gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:my-0 md:overflow-visible md:rounded-lg md:border md:border-border md:bg-card md:p-1.5 [&::-webkit-scrollbar]:hidden">
        <div className="contents md:hidden">
          <CategorySheet label={categoryLabel}>{categoryNav}</CategorySheet>
          <FiltersSheet count={filterCount} view={toggle()}>{filterForm}</FiltersSheet>
        </div>
        <DateRangeFilter {...dates} />
        <div className="flex shrink-0 items-center gap-2 md:ml-auto">
          <SortMenu options={sortOptions} current={sort} />
          {toggle("hidden md:flex")}
        </div>
      </div>
    </div>
  );
}
