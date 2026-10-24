import Link from "next/link";
import Image from "next/image";
import { BadgeCheck, ImageOff } from "lucide-react";
import { listingPhotos, type ListingWithOwner } from "@/server/catalog";
import { formatDeposit, formatHandoverShort, formatPrice } from "@/lib/catalog/format";
import { listingPath } from "@/lib/catalog/listing-path";
import { minDaysShort, primaryPrice, UNIT_DAYS } from "@/lib/catalog/tariff";
import { content } from "@theme/content";
import { eachDate, freeQty, type AvailabilityMap } from "@/lib/catalog/availability";
import { DISTANCE_TITLE, distanceLabel } from "@/lib/geo/distance";
import type { GeoPrecision } from "@/lib/geo/precision";
import { Avatar } from "@/components/ui/Avatar";
import { cardFrame } from "@/components/ui/card-frame";
import { HandoverIcon } from "@/components/catalog/HandoverIcon";
import { CardPhotos, type PhotoPriority } from "@/components/catalog/CardPhotos";

const HANDOVER_ICON = "h-[15px] w-[15px] shrink-0 text-accent";
const t = content.listingCard;
// Больше пяти снимков в карточке не листается: дальше — страница объявления.
const MAX_CARD_PHOTOS = 5;

/** sizes фото в сетке: две колонки ниже md, до трёх ниже 1200 px, дальше карточка ≤300 px. */
export const GRID_PHOTO_SIZES = "(max-width: 767px) 50vw, (max-width: 1199px) 33vw, 300px";
/** sizes фото в ленте «Ещё у …» / «Ещё в категории»: карточка 220–240 px. */
export const RAIL_PHOTO_SIZES = "240px";
const LIST_PHOTO_SIZES = "(max-width: 639px) 112px, 200px";

/**
 * Приоритет первого фото по месту карточки в выдаче: две первые — high,
 * остаток первого ряда (rowMax — колонок в самом широком ряду) — eager,
 * дальше — ленивая загрузка по умолчанию.
 */
export function cardEager(index: number, rowMax: number): PhotoPriority | undefined {
  if (index < 2) return "high";
  return index < rowMax ? "eager" : undefined;
}

/**
 * Нужен ли на карточках город: выдача захватила несколько городов или город
 * вне страницы (агломерация, точка «Где» на весь регион). Иначе город у всех
 * один и стоит в заголовке страницы — на карточке он только повтор.
 */
export function cardsShowCity(items: { citySlug: string }[], pageCitySlug?: string): boolean {
  const slugs = new Set(items.map((i) => i.citySlug));
  if (pageCitySlug !== undefined) slugs.add(pageCitySlug);
  return slugs.size > 1;
}

/* Место на карточке сетки — публичная подпись адреса (listings.location, без
 * номера дома). Подпись с точкой уже называет свой пункт: «Юбилейный,
 * Краснодар», «улица Гагарина, Яблоновский». Когда город в выдаче один, хвост
 * с ним срезается — остаётся район или улица. Когда городов несколько, подпись
 * идёт целиком, а к тексту без точки (`city`) город дописывается — как в
 * OwnerCard. Подписи нет — город. */
function placeLabel(
  location: string | null | undefined,
  precision: GeoPrecision | null | undefined,
  cityName: string,
  showCity: boolean,
): string {
  const label = location?.trim();
  if (!label || label.toLowerCase() === cityName.toLowerCase()) return cityName;
  if (showCity) return precision === "city" ? `${label}, ${cityName}` : label;
  const tail = `, ${cityName}`.toLowerCase();
  return label.toLowerCase().endsWith(tail) ? label.slice(0, -tail.length) : label;
}

// Карточка товара на публичных страницах: главная, каталог, поиск, профиль
// продавца, «Ещё у …» и «Ещё в категории».
//
// Сетка (по разбору reports/Карточки в выдаче маркетплейсов.md, решения —
// docs/decisions/0027): квадратное фото и текст — название до трёх строк, цена
// с короткой единицей, условия (залог и срок, если он не следует из единицы) и
// строка «владелец · место». На фото — только исключение «Занято»; правый
// верхний угол оставлен свободным под будущее «избранное». Владелец — строкой
// текста, не плашкой на снимке: имя на фото спорило со снимком.
//
// Список: фото слева, справа название, цена с полной единицей, залог и строка
// получения; плашка продавца на фото ведёт в его профиль.
//
// Адреса на карточке нет: только подпись без номера дома и расстояние по
// прямой (docs/decisions/0021).
//
// Кликается целиком: ссылка названия растянута псевдоэлементом на всю карточку
// (`after:inset-0`). Фото с одним снимком — не ссылка, его накрывает тот же
// псевдоэлемент. Фото с несколькими снимками в сетке листается (CardPhotos) и
// поэтому лежит поверх псевдоэлемента своей ссылкой — без табуляции и
// aria-hidden, чтобы не было второй остановки на тот же адрес.
//
// availabilityMap и from обязательны: занятость — половина смысла карточки,
// и необязательный проп молча вырождал бы её на страницах, где загрузку
// забыли добавить. Страница грузит занятость одним запросом на всю выдачу.
export function ListingCard({
  item,
  citySlug,
  availabilityMap,
  from,
  to = from,
  hrefQuery,
  view = "grid",
  showCity = false,
  showOwner = true,
  carousel = true,
  sizes = GRID_PHOTO_SIZES,
  eager,
}: {
  item: ListingWithOwner;
  citySlug: string;
  availabilityMap: AvailabilityMap;
  /** Дни, на которые показывается свобода: выбранный «Когда» или один сегодняшний. */
  from: string;
  to?: string;
  /** Переносимые параметры выдачи (даты, «Где»): карточка открывается с ними, и виджет брони — тоже. */
  hrefQuery?: string;
  /** Списком фото уезжает влево, остальное — в колонку рядом. */
  view?: "grid" | "list";
  /** Город в строке места сетки — когда выдача шире одного города (cardsShowCity). */
  showCity?: boolean;
  /** Строка владельца в сетке. Нет на его же профиле и в ленте «Ещё у …». */
  showOwner?: boolean;
  /** Листать снимки в сетке. В лентах — одно фото: свайп там листает ленту. */
  carousel?: boolean;
  /** sizes фото: GRID_PHOTO_SIZES для сеток, RAIL_PHOTO_SIZES для лент. В списке — свой. */
  sizes?: string;
  /** Приоритет загрузки первого фото по месту в выдаче (cardEager). */
  eager?: PhotoPriority;
}) {
  const list = view === "list";
  const { listing, ownerName, ownerImage, ownerIsVerified, categorySlug, cityName } = item;
  const photos = listingPhotos(listing);
  const photo = photos[0];
  const swipe = !list && carousel && photos.length > 1;
  const path = listingPath(citySlug, categorySlug, listing.slug, listing.id);
  const href = hrefQuery ? `${path}?${hrefQuery}` : path;
  // Главная цена с её единицей: у вещи без суточной — «2 250 ₽ в неделю».
  const primary = primaryPrice(listing);
  const minTerm = listing.minDays > 1 ? minDaysShort(listing.minDays) : null;
  // В сетке срок пишется, только если единица его не подразумевает: «/нед.»
  // уже значит «от 7 дней», «/мес.» — «от 30».
  const gridTerm = primary && listing.minDays > UNIT_DAYS[primary.unit] ? minTerm : null;
  // Сколько единиц свободно на ВСЕ дни периода — минимум по дням: аренде
  // нужна одна и та же вещь с первого дня по последний.
  const free = Math.min(...eachDate(from, to).map((d) => freeQty(listing.quantity, availabilityMap.get(d))));
  const busy = free <= 0;

  // Владелец в сетке: имя без заглушки — у безымянного строки нет.
  const owner = showOwner ? ownerName?.trim() || null : null;

  const handover = formatHandoverShort(listing.handoverPickup, listing.handoverDelivery);
  const deposit = formatDeposit(listing.depositType, listing.depositAmount);

  // Расстояние до точки «Где»: «≈ 3 км», «1,2 км», «350 м».
  const distance = item.distance ? distanceLabel(item.distance.km, item.distance.approx) : null;
  const distanceTag = distance && (
    <span title={DISTANCE_TITLE} className="shrink-0 whitespace-nowrap font-medium text-foreground">
      {distance}
    </span>
  );

  return (
    // relative — контейнер для растянутой ссылки названия; group — чтобы фото
    // увеличивалось при наведении на любую точку карточки.
    <article
      className={`${cardFrame} group relative ${
        list ? "flex min-h-[96px] flex-row sm:min-h-[150px]" : "flex flex-col"
      }`}
    >
      {/* Обёртка, а не ссылка: в списке плашка продавца ведёт в его профиль, а
        * вложенная ссылка невалидна. Фото и плашки — соседи внутри обёртки. */}
      <div className={`relative ${list ? "w-[112px] shrink-0 self-stretch sm:w-[200px]" : ""}`}>
        {swipe ? (
          <CardPhotos
            photos={photos.slice(0, MAX_CARD_PHOTOS).map((p) => p.url)}
            alt={listing.title}
            href={href}
            sizes={sizes}
            eager={eager}
          />
        ) : (
        /* Сеткой — квадрат, cover по центру. Списком фото заполняет колонку по
          * высоте ряда: absolute по обёртке, без пропорции — через h-full
          * пропорция начала бы задавать ширину. */
        <div
          className={`block overflow-hidden bg-muted ${
            list ? "absolute inset-0" : "relative aspect-square"
          }`}
        >
          {photo ? (
            <Image
              src={photo.url}
              alt={listing.title}
              fill
              sizes={list ? LIST_PHOTO_SIZES : sizes}
              loading={eager ? "eager" : undefined}
              fetchPriority={eager === "high" ? "high" : undefined}
              className="object-cover object-center transition-transform duration-300 motion-safe:group-hover:scale-[1.03]"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-8 w-8" aria-hidden="true" />
              <span className="sr-only">{t.noPhoto}</span>
            </span>
          )}
        </div>
        )}

        {/* Только исключение: признак, одинаковый у всех карточек, ничего не
          * различает. .glass-photo тёмная в обеих темах — снимок о теме не
          * знает, поэтому текст её собственный светлый. Правый верхний угол
          * свободен — место под «избранное». z-20 — над ссылкой листалки. */}
        {busy && (
          <span className="glass-photo pointer-events-none absolute left-2 top-2 z-20 inline-flex items-center rounded-sm px-2 py-0.5 text-2xs font-medium sm:left-2.5 sm:top-2.5 sm:px-2.5 sm:py-1">
            {t.busy}
          </span>
        )}

        {/* Плашка продавца — только в списке. z-10 поднимает её над растянутой
          * ссылкой названия; без relative: плашка absolute, а relative в
          * Tailwind объявлен позже и уронил бы её в поток. */}
        {list && (
          <Link
            href={`/u/${listing.ownerUserId}` as never}
            className="glass-photo tap-target absolute bottom-2 right-2 z-10 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-sm py-0.5 pl-0.5 pr-2 transition-opacity hover:opacity-90 sm:bottom-2.5 sm:right-2.5 sm:max-w-[calc(100%-1.25rem)] sm:gap-1.5 sm:py-1 sm:pl-1 sm:pr-2.5"
          >
            <span className="flex shrink-0 sm:hidden">
              <Avatar src={ownerImage} name={ownerName} size={18} />
            </span>
            <span className="hidden shrink-0 sm:flex">
              <Avatar src={ownerImage} name={ownerName} size={22} />
            </span>
            <span className="min-w-0 truncate text-micro font-medium sm:text-xs">
              {ownerName ?? t.noName}
            </span>
            {ownerIsVerified && (
              <BadgeCheck className="h-3 w-3 shrink-0 text-accent sm:h-3.5 sm:w-3.5" aria-label={t.verified} />
            )}
          </Link>
        )}
      </div>

      {list ? (
        <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
          <Link href={href as never} className="block min-w-0 after:absolute after:inset-0">
            <h3 className="line-clamp-2 break-words text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-accent sm:text-base">
              {listing.title}
            </h3>
          </Link>
          <p className="mt-1 flex items-baseline gap-x-1.5">
            <span className="shrink-0 font-mark text-lg font-bold leading-snug tracking-mark sm:text-xl">
              {primary ? formatPrice(primary.amount) : ""}
            </span>
            <span className="truncate text-xs text-muted-foreground sm:text-sm">
              {primary ? content.tariff.per[primary.unit] : ""}
              {minTerm && <span> · {minTerm}</span>}
            </span>
          </p>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">{deposit}</p>
          <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
            <HandoverIcon
              pickup={listing.handoverPickup}
              delivery={listing.handoverDelivery}
              className={HANDOVER_ICON}
            />
            <span className="min-w-0 truncate">{handover}</span>
            {distanceTag ? (
              <span className="flex h-[1lh] flex-1 flex-wrap gap-x-1 overflow-clip sm:min-w-[4.5rem]">
                <span className="flex shrink-0 gap-1">·{distanceTag}</span>
                <span className="hidden whitespace-nowrap sm:inline">· {cityName}</span>
              </span>
            ) : (
              <span className="shrink-0">· {cityName}</span>
            )}
          </p>
        </div>
      ) : (
        // Ряд держит цены на одной линии: название занимает от двух до трёх
        // строк, а цена, условия и строка владельца прижаты к низу (mt-auto)
        // — трёхстрочное название соседей не сдвигает.
        <div className="flex min-w-0 flex-1 flex-col px-3 pb-2.5 pt-2 sm:px-4 sm:pb-3.5 sm:pt-3">
          {/* 15 px и 500: жирной на карточке остаётся одна цена. min-h — две
            * строки leading-snug (1.35) в em. Подсветка названия висит на
            * group от <article>: ховер псевдоэлемента до h3 не доходит. */}
          <Link href={href as never} className="block min-w-0 after:absolute after:inset-0">
            <h3 className="line-clamp-3 min-h-[2.7em] break-words text-base font-medium leading-snug text-foreground transition-colors group-hover:text-accent">
              {listing.title}
            </h3>
          </Link>

          <div className="mt-auto pt-1">
            <p className="flex items-baseline gap-x-1">
              <span className="shrink-0 font-mark text-xl font-bold leading-tight tracking-mark">
                {primary ? formatPrice(primary.amount) : ""}
              </span>
              <span className="truncate text-xs leading-snug text-muted-foreground">
                {primary ? content.tariff.short[primary.unit] : ""}
              </span>
            </p>

            {/* Условия: залог всегда — для сервиса без оплаты внутри это
              * решающее условие; срок — только если его нет в единице. Залог
              * режется первым, срок короткий и не режется. */}
            <p className="flex gap-x-1 text-xs leading-snug text-muted-foreground">
              <span className="min-w-0 truncate">{deposit}</span>
              {gridTerm && <span className="shrink-0 whitespace-nowrap">· {gridTerm}</span>}
            </p>

            {/* Владелец и место одной строкой: «ПикаВел · ул. Степана Разина»;
              * при точке «Где» место заменяет расстояние — «≈ 1,2 км · ПикаВел».
              * Имя не шире 60 % строки, поэтому режется сначала место. Без
              * имени владельца нет вовсе — «Без имени» ничего не говорит.
              * Значок получения — только если есть доставка: самовывоз у почти
              * всех и ничего не различает. */}
            <p className="flex items-center gap-x-1 text-xs leading-snug text-muted-foreground">
              {listing.handoverDelivery && (
                <span title={handover} className="mr-0.5 flex shrink-0">
                  <HandoverIcon
                    pickup={listing.handoverPickup}
                    delivery={listing.handoverDelivery}
                    className="h-3.5 w-3.5 shrink-0 text-accent"
                  />
                  <span className="sr-only">{handover}</span>
                </span>
              )}
              {distanceTag}
              {owner && (
                <span className={`${distanceTag ? "min-w-0" : "max-w-[60%] shrink-0"} truncate`}>
                  {distanceTag && "· "}
                  {owner}
                </span>
              )}
              {!(distanceTag && owner) && (
                <span className="min-w-0 truncate">
                  {(distanceTag || owner) && "· "}
                  {placeLabel(listing.location, listing.geoPrecision, cityName, showCity)}
                </span>
              )}
            </p>
          </div>
        </div>
      )}
    </article>
  );
}
