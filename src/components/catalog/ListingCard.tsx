import Link from "next/link";
import Image from "next/image";
import { BadgeCheck, ImageOff } from "lucide-react";
import { listingPhotos, type Listing, type ListingWithOwner } from "@/server/catalog";
import { formatDeposit, formatHandoverShort, formatPrice } from "@/lib/catalog/format";
import { listingPath } from "@/lib/catalog/listing-path";
import { eachDate, freeQty, type AvailabilityMap } from "@/lib/catalog/availability";
import { DISTANCE_TITLE, distanceLabel } from "@/lib/geo/distance";
import { Avatar } from "@/components/ui/Avatar";
import { cardFrame } from "@/components/ui/card-frame";
import { cn } from "@/lib/utils";
import { HandoverIcon } from "@/components/catalog/HandoverIcon";

const HANDOVER_ICON = "h-[15px] w-[15px] shrink-0 text-accent";

// Карточка товара на публичных страницах: главная, каталог, поиск, профиль
// продавца. Фото с плашками занятости и продавца, название, цена с залогом и
// подвал со способом получения, городом и — при точке «Где» — расстоянием.
// Адреса на карточке нет: только расстояние по прямой (docs/decisions/0021).
//
// У кабинета карточек больше нет: там ListingsList — таблица со статусом,
// занятостью и счётчиком заявок. Общего кода с ним не осталось, и cardFrame
// теперь принадлежит только витрине.
//
// Кликается целиком: ссылка названия растянута псевдоэлементом на всю карточку
// (`after:inset-0`), поэтому отдельной кнопки «Подробнее» больше нет, а фото —
// не ссылка: два якоря на один адрес дали бы лишнюю остановку табуляции.
// Плата за приём — текст внутри карточки не выделяется мышью.
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
}) {
  const list = view === "list";
  const { listing, ownerName, ownerImage, ownerIsVerified, categorySlug, cityName } = item;
  const photo = listingPhotos(listing)[0];
  const path = listingPath(citySlug, categorySlug, listing.slug, listing.id);
  const href = hrefQuery ? `${path}?${hrefQuery}` : path;
  const price = formatPrice(listing.priceDay);
  // Сколько единиц свободно на ВСЕ дни периода — минимум по дням: аренде
  // нужна одна и та же вещь с первого дня по последний. Дату «свободно с»
  // карточка не показывает, календарь на самой позиции скажет точнее.
  const free = Math.min(...eachDate(from, to).map((d) => freeQty(listing.quantity, availabilityMap.get(d))));

  // Зелёный — свободно всё, охра — часть занята, серый — мест нет.
  // Красный не берём: занятость это состояние предмета, а не отмена и спор.
  const busy = free <= 0;
  const partial = free > 0 && free < listing.quantity;
  const tone = busy ? "text-muted-foreground" : partial ? "text-accent" : "text-primary";
  const dot = busy ? "bg-muted-foreground" : partial ? "bg-accent" : "bg-primary";

  const handover = formatHandoverShort(listing.handoverPickup, listing.handoverDelivery);
  // Приглушение второй ступенью только в тёмной теме. В светлой
  // --color-muted-fg уже #5F6165 и подобран ровно под контраст 4.5 — шаг ниже
  // увёл бы город под норму.
  const placeTone = "dark:text-muted-foreground/70";

  // Расстояние до точки «Где»: «≈ 3 км», «1,2 км», «350 м». На узкой карточке
  // (две колонки на 360 — ≈ 135 px контента) оно заменяет город: город виден
  // на странице объявления и в подписи над выдачей. С sm — «1,2 км · Город»,
  // если город влезает целиком.
  const distance = item.distance ? distanceLabel(item.distance.km, item.distance.approx) : null;
  const distanceTag = distance && (
    <span title={DISTANCE_TITLE} className="shrink-0 whitespace-nowrap font-medium text-foreground">
      {distance}
    </span>
  );
  // Расстояние с городом — один ряд, где город виден только целиком. Не влез —
  // переносится второй строкой, а её срезает высота в одну строку: «Самов…
  // ≈ 1 км · Яблонов…» с двумя многоточиями читалось хуже, чем без города.
  // Ряд получает только остаток после способа получения (flex-1 от нуля), так
  // что тот режется последним. Само расстояние не срезается: overflow-clip, а
  // не hidden, оставляет ряду минимум по содержимому — ниже sm это ровно
  // расстояние; с sm в минимум вошёл бы город, поэтому там минимум задан явно.
  const distancePlace = (lead: React.ReactNode, className: string) => (
    <span className={`flex h-[1lh] flex-1 flex-wrap gap-x-1 overflow-clip sm:min-w-[4.5rem] ${className}`}>
      {lead}
      <span className={`hidden whitespace-nowrap sm:inline ${placeTone}`}>· {cityName}</span>
    </span>
  );

  return (
    // relative — контейнер для растянутой ссылки названия; group — чтобы фото
    // увеличивалось при наведении на любую точку карточки, а не только на сам
    // снимок (он больше не ссылка и своего ховера не имеет).
    <article
      className={`${cardFrame} group relative ${
        list ? "flex min-h-[96px] flex-row sm:min-h-[150px]" : "flex flex-col"
      }`}
    >
      {/* Обёртка, а не ссылка: плашка продавца ведёт в его профиль, а вложенная
        * ссылка невалидна и не кликается. Поэтому фото и обе плашки — соседи,
        * позиционируются относительно этой обёртки. */}
      <div className={`relative ${list ? "w-[112px] shrink-0 self-stretch sm:w-[200px]" : ""}`}>
        {/* Списком фото заполняет колонку по высоте ряда. Через h-full этого
          * делать нельзя: при заданном aspect-[4/3] высота начинает определять
          * ШИРИНУ, и фото вылезает из колонки поверх текста. Поэтому оно
          * absolute и растягивается по обёртке, а пропорция снимается. */}
        <div
          className={`block overflow-hidden bg-muted ${
            list ? "absolute inset-0" : "relative aspect-[4/3]"
          }`}
        >
          {photo ? (
            <Image
              src={photo.url}
              alt={listing.title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-8 w-8" aria-hidden="true" />
              <span className="sr-only">Без фото</span>
            </span>
          )}
        </div>

        {/* Плашки лежат на фотографии, поэтому .glass-photo: она тёмная в обеих
          * темах — снимок о теме интерфейса не знает.
          *
          * Только слово, без «N из M»: точный остаток на витрине ничего не
          * решает, а календарь на самой позиции скажет точнее. Оттенок точки
          * при этом сохраняет разницу — зелёная значит свободно всё, охряная
          * что часть уже занята. */}
        <span className="glass-photo pointer-events-none absolute left-2 top-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-sm px-2 py-0.5 text-micro font-medium sm:left-2.5 sm:top-2.5 sm:max-w-[calc(100%-1.25rem)] sm:px-2.5 sm:py-1 sm:text-2xs">
          <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
          <span className={`truncate ${tone}`}>{busy ? "Занято" : "Свободно"}</span>
        </span>

        {/* max-w и truncate: длинное имя режется многоточием, а не распирает
          * плашку за край фотографии.
          *
          * z-10 поднимает плашку над растянутой ссылкой названия — без него
          * профиль продавца стал бы некликабельным. Именно z-10, без relative:
          * плашка absolute, а relative в Tailwind объявлен позже при той же
          * специфичности и уронил бы её из фото в поток. */}
        <Link
          href={`/u/${listing.ownerUserId}` as never}
          className="glass-photo tap-target absolute bottom-2 right-2 z-10 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-sm py-0.5 pl-0.5 pr-2 transition-opacity hover:opacity-90 sm:bottom-2.5 sm:right-2.5 sm:max-w-[calc(100%-1.25rem)] sm:gap-1.5 sm:py-1 sm:pl-1 sm:pr-2.5"
        >
          {/* Размер аватара — инлайновые width/height от пропа, классом на
            * брейкпоинте его не ужать; поэтому два, как на витрине продавца.
            * Обёртка именно flex: Avatar — inline-элемент, в строке он сел бы
            * на базовую линию с пустотой под собой, и items-center центрировал
            * бы эту пустоту вместе с ним. */}
          <span className="flex shrink-0 sm:hidden">
            <Avatar src={ownerImage} name={ownerName} size={18} />
          </span>
          <span className="hidden shrink-0 sm:flex">
            <Avatar src={ownerImage} name={ownerName} size={22} />
          </span>
          <span className="min-w-0 truncate text-micro font-medium sm:text-xs">
            {ownerName ?? "Без имени"}
          </span>
          {/* Охра, а не зелень: по закону цвета зелёный — «можно нажать», а
            * проверка это состояние аккаунта. Плашка кликабельна целиком, но
            * значок в ней ничего не запускает. Так же он выглядит в визитках
            * профиля, кабинета и в карточке владельца под фото. */}
          {ownerIsVerified && (
            <BadgeCheck
              className="h-3 w-3 shrink-0 text-accent sm:h-3.5 sm:w-3.5"
              aria-label="Проверен"
            />
          )}
        </Link>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
        {/* Две строки с многоточием и место под две строки всегда: в узкой
          * колонке телефона одна строка оставляла от названия «Перфоратор
          * Ма…», а карточки в ряду обязаны быть одной высоты — короткое
          * название в одну строку сдвинуло бы цену вверх только в своей
          * колонке. min-h — две строки leading-snug (1.375) в em, поэтому
          * верна на обоих кеглях. Только в сетке: строка списка стоит одна в
          * ряду, ровнять ей не с кем, и резерв под вторую строку был бы
          * пустой дырой под коротким названием.
          *
          * after:inset-0 растягивает эту ссылку на всю карточку. Подсветка
          * названия висит на group от <article>, а не на hover самой ссылки:
          * ховер от псевдоэлемента до h3 не доходит — тот потомок, а не
          * предок. */}
        <Link href={href as never} className="block min-w-0 after:absolute after:inset-0">
          <h3 className={cn(
            "line-clamp-2 break-words text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-accent sm:text-base",
            !list && "min-h-[2.75em]",
          )}>
            {listing.title}
          </h3>
        </Link>

        {/* Две строки всегда: сумма с единицей, под ней залог. Одной строкой
          * они не помещаются на реальных числах — «3 334 ₽ в сутки · залог
          * 3 242 ₽» переносило залог, и высота карточек в ряду начинала
          * зависеть от длины суммы. Единица остаётся при сумме: «в сутки»
          * относится к ней, а залог — отдельный факт.
          * Строка суммы не переносится (flex без wrap), длинная единица
          * обрезается многоточием. */}
        <p className="mt-1 flex items-baseline gap-x-1.5">
          <span className="shrink-0 font-mark text-lg font-bold leading-snug tracking-mark sm:text-xl">
            {price}
          </span>
          <span className="truncate text-xs text-muted-foreground sm:text-sm">
            в сутки
          </span>
        </p>
        <p className="truncate text-xs text-muted-foreground sm:text-sm">
          {formatDeposit(listing.depositType, listing.depositAmount)}
        </p>

        {/* Списком подвала нет — карточка горизонтальна, и волосяная линия
          * через неё делила бы не зоны, а колонки. Поэтому способ получения
          * идёт отдельной строкой под ценой: в саму строку цены он не встаёт,
          * та выключена по базовой линии и иконка села бы на неё криво. */}
        {list && (
          <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
            <HandoverIcon
              pickup={listing.handoverPickup}
              delivery={listing.handoverDelivery}
              className={HANDOVER_ICON}
            />
            <span className="min-w-0 truncate">{handover}</span>
            {distanceTag
              ? distancePlace(<span className="flex shrink-0 gap-1">·{distanceTag}</span>, "")
              : <span className={`shrink-0 ${placeTone}`}>· {cityName}</span>}
          </p>
        )}
      </div>

      {/* Подвал сеткой: способ получения слева, город справа. Город виден и на
        * телефоне — он короткий, и когда рядом не помещается «Самовывоз или
        * доставка», обрезается многоточием именно способ получения: он длиннее
        * и переживает обрезку понятнее, чем название города.
        *
        * Ниже sm, в две узкие колонки, от способа оставалось «С…» — подпись
        * там только для скринридера, видно один значок (подсказка — в title).
        * Значок у способа свой на каждый случай, и он тот же, что на странице
        * позиции и в фильтре «Как забрать». */}
      {!list && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-3 text-xs text-muted-foreground sm:px-4 sm:text-sm">
          <span title={handover} className="flex shrink-0">
            <HandoverIcon
              pickup={listing.handoverPickup}
              delivery={listing.handoverDelivery}
              className={HANDOVER_ICON}
            />
          </span>
          <span className="min-w-0 truncate max-sm:sr-only">{handover}</span>
          {distanceTag ? (
            // Прижат вправо: расстояние у края, город перед ним.
            distancePlace(distanceTag, "justify-end")
          ) : (
            <span className={`ml-auto shrink-0 pl-2 ${placeTone}`}>{cityName}</span>
          )}
        </div>
      )}
    </article>
  );
}
