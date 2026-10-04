import Link from "next/link";
import { content } from "@theme/content";
import { getAvailabilityRows, type ListingWithOwner } from "@/server/catalog";
import { buildAvailabilityByListing } from "@/lib/catalog/availability";
import { addDaysStr, todayStr } from "@/lib/catalog/dates";
import { ListingCard } from "@/components/catalog/ListingCard";

export async function RecentItems({
  items,
  citySlug,
}: {
  items: ListingWithOwner[];
  citySlug: string;
}) {
  if (items.length === 0) return null;

  // Занятость всех карточек — одним запросом, как в каталоге и поиске.
  const from = todayStr();
  const availRows = await getAvailabilityRows(
    items.map((i) => i.listing.id),
    from,
    addDaysStr(from, 6),
  );
  const availByListing = buildAvailabilityByListing(availRows);

  return (
    // Без панели: карточки — сами по себе поверхности, и на холсте они читаются
    // как карточки, а внутри залитой панели превращались в коробки в коробке.
    <section>
      {/* flex-wrap обязателен: заголовок набран сорока пунктами, и на телефоне
        * он вместе с несжимаемой ссылкой не встаёт в строку — без переноса
        * ссылка выносила бы всю страницу за правый край. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        {/* Сорок пунктов — кегль макета, нарисованного на 1440: в контейнере
          * 1200 он звучит громче остального сайта, где заголовок раздела —
          * 22 пункта. Держим общий размер, иначе главная кричит там, где
          * каталог говорит. */}
        <h2 className="font-display text-2xl font-extrabold tracking-mark text-foreground">
          {content.home.recentHeading}
        </h2>
        <Link
          href={`/${citySlug}` as never}
          className="shrink-0 text-base font-semibold text-accent hover:underline"
        >
          {content.home.recentAll} →
        </Link>
      </div>

      {/* Сеткой, а не лентой с горизонтальной прокруткой: объявлений на старте
        * мало, и уводить половину за край экрана нечем оправдать. Две колонки
        * и зазоры на телефоне — те же, что в каталоге и поиске: карточка одна
        * на весь проект, и выдача под ней должна вести себя одинаково. */}
      <div className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-4 wide:grid-cols-4">
        {items.map((item) => (
          <ListingCard
            key={item.listing.id}
            item={item}
            citySlug={citySlug}
            availabilityMap={availByListing.get(item.listing.id) ?? new Map()}
            from={from}
          />
        ))}
      </div>
    </section>
  );
}
