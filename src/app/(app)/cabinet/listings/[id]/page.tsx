// Страница вещи в кабинете: всё, что этой вещи принадлежит, — её занятость, её
// заявки, её переписки. Раньше это был только экран правки, а занятость жила
// отдельным разделом со своим переключателем позиций: вещь приходилось выбирать
// дважды. Правка осталась здесь же, под ?tab=edit — форма длинная, держать её
// раскрытой над остальным нельзя.

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ImageOff } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { getOwnerListing } from "@/server/owner";
import { getCabinetRequests } from "@/server/cabinet";
import { toFeedRow, sortFeedRows } from "@/server/requests-feed";
import { getListingThreads } from "@/server/chat";
import {
  getActiveCities, getAllCategories, getAvailabilityRows, listingPhotos,
} from "@/server/catalog";
import { getCitiesGeo } from "@/server/city";
import { leafCategories } from "@/lib/owner/categories";
import { listingPath } from "@/lib/catalog/listing-path";
import { ListingForm } from "@/components/cabinet/ListingForm";
import { ListingAvailability } from "@/components/cabinet/ListingAvailability";
import { RequestsFeed } from "@/components/cabinet/RequestsFeed";
import { ListingRowActions } from "@/components/cabinet/ListingRowActions";
import { Avatar } from "@/components/ui/Avatar";
import { addDaysStr, todayStr, formatDayMonth } from "@/lib/catalog/dates";
import { ruPlural } from "@/lib/plural";
import { formatDeposit, formatPrice } from "@/lib/catalog/format";
import { occupancySummary, type AvailabilityMap } from "@/lib/catalog/availability";
import { BOOKING_HORIZON_DAYS } from "@/lib/booking/params";

export const dynamic = "force-dynamic";

const STATUS_WORD = { active: "Активно", hidden: "Скрыто", archived: "Архив" } as const;

// Заголовок вкладки — название вещи: список объявлений и одна вещь в истории
// браузера иначе называются одинаково.
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const session = await requireAuthState();
  if (!session) return { title: "Объявление", robots: { index: false } };
  const listing = await getOwnerListing(session.user.id, (await params).id);
  return {
    title: listing?.title ?? "Объявление",
    robots: { index: false },
  };
}

export default async function CabinetListingPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

  const { id } = await params;
  const rawTab = (await searchParams).tab;
  const editing = (Array.isArray(rawTab) ? rawTab[0] : rawTab) === "edit";

  const listing = await getOwnerListing(session.user.id, id);
  if (!listing) notFound();

  const isArchived = listing.status === "archived";
  // Архив — вид фильтра в списке, а не отдельная страница: возвращаемся туда,
  // откуда пришли, а не в общий список, где архивной вещи не видно.
  const backHref = isArchived ? "/cabinet/listings?view=archived" : "/cabinet/listings";
  const selfHref = `/cabinet/listings/${listing.id}`;
  const publicHref = listingPath(
    listing.citySlug, listing.categorySlug, listing.slug, listing.id,
  );

  const back = (
    /* Только на десктопе: на мобиле круглую кнопку «назад» рисует сама оболочка
     * кабинета, и вторая шла бы сразу за ней. Вид тот же — кружок с шевроном, —
     * но с подписью: на широком экране есть место сказать, куда ведёт, а
     * подчёркнутая ссылка над карточками читалась сноской, а не выходом.
     *
     * Из правки ведёт туда же, куда со страницы вещи, — в список. Прежде она
     * вела на саму вещь, и человек, зашедший править прямо из списка, попадал
     * на экран, которого не видел. Выходов и так два: «Сохранить» возвращает на
     * вещь, стрелка — в список. */
    <Link
      href={backHref as never}
      className="hidden w-fit items-center gap-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </span>
      {isArchived ? "К архиву" : "К объявлениям"}
    </Link>
  );

  // Справочники нужны только форме — на самой странице вещи их не читаем.
  if (editing) {
    const [cities, cats, geo] = await Promise.all([getActiveCities(), getAllCategories(), getCitiesGeo()]);
    // Та же раскладка, что и у страницы вещи: отступ под стрелкой задаёт gap
    // родителя, а не собственный margin ссылки. Иначе он складывался с gap'ом
    // на одном экране и не складывался на другом.
    return (
      <main className="flex flex-col gap-4">
        {back}
        <ListingForm
          mode="edit"
          listingId={listing.id}
          returnHref={selfHref}
          cities={cities.map((c) => ({
            id: c.id, name: c.name, nameLocative: c.nameLocative, slug: c.slug, geo: geo.get(c.slug) ?? null,
          }))}
          categories={leafCategories(cats)}
          // Полный адрес и точка — владельцу в его же форме; публичные
          // страницы их не выбирают (publicListingColumns).
          savedAddress={listing.address === null ? null : {
            label: listing.address,
            precision: listing.geoPrecision,
            point: listing.lat !== null && listing.lon !== null
              ? { lat: listing.lat, lon: listing.lon }
              : null,
          }}
          initial={{
            title: listing.title,
            cityId: listing.cityId,
            categoryId: listing.categoryId,
            description: listing.description ?? "",
            priceDay: String(listing.priceDay),
            depositType: listing.depositType,
            depositAmount: listing.depositAmount?.toString() ?? "",
            quantity: String(listing.quantity),
            handoverPickup: listing.handoverPickup,
            handoverDelivery: listing.handoverDelivery,
            photos: listingPhotos(listing),
          }}
        />
      </main>
    );
  }

  const from = todayStr();
  // Занятость архивной вещи не показываем: сдать её нельзя, и календарь с
  // формой закрытия дат предлагали бы действие, которого не существует. Тем же
  // правилом жил прежний раздел календаря — он отфильтровывал архив.
  const horizon = addDaysStr(from, BOOKING_HORIZON_DAYS);
  const [availRows, requests, threads] = await Promise.all([
    // На весь горизонт, а не на шесть недель: календарь листается по месяцам, и
    // строки за дальние месяцы нужны сразу — иначе они выглядели бы свободными.
    isArchived ? [] : getAvailabilityRows([listing.id], from, horizon),
    getCabinetRequests(session.user.id, { role: "owner", listingId: listing.id }),
    getListingThreads(listing.id, session.user.id),
  ]);
  const map: AvailabilityMap = new Map(
    availRows.map((r) => [r.date, { bookedQty: r.bookedQty, blockedQty: r.blockedQty }]),
  );
  // Окно сводки — месяц: столько владелец и держит в голове, а календарь
  // ниже отвечает на всё остальное.
  const summary = occupancySummary(listing.quantity, map, from, addDaysStr(from, 30));
  const feedRows = sortFeedRows(requests.map((r) => toFeedRow(r)));
  const photo = listingPhotos(listing)[0];

  return (
    <main className="flex flex-col gap-4">
      {back}

      {/* Шапка вещи — карточка, а не голый текст: страница целиком стояла на
        * фоне без единой подложки и читалась документом, а не экраном. */}
      <header className="surface flex items-start gap-3 p-3 sm:gap-4 sm:p-4">
        {/* Снимок 56px на любой ширине: он здесь опознаёт вещь, а не показывает
          * её — для разглядывания есть публичная страница. В 80px шапка была
          * выше своего содержимого и занимала треть первого экрана.
          *
          * Кегли на телефоне на ступень мельче: справа стоит пара «статус +
          * меню», и в полном размере название ломалось на две строки, а «залог»
          * отрывался от суммы. */}
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
          {photo ? (
            <Image src={photo.url} alt="" fill sizes="56px" className="object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-6 w-6" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {/* Название ведёт на само объявление — туда, где его видят арендаторы.
            * Ссылка только у активного: у скрытого и архивного публичной страницы
            * нет, и переход отдал бы 404. У них название остаётся текстом, а
            * почему — говорит плашка статуса рядом. */}
          <h2 className="break-words font-display text-base font-bold leading-tight sm:text-xl">
            {listing.status === "active" ? (
              <Link
                href={publicHref as never}
                className="transition-colors hover:text-accent"
              >
                {listing.title}
              </Link>
            ) : listing.title}
          </h2>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground sm:mt-1.5 sm:text-sm">
            <span className="font-mark text-base font-bold tracking-mark text-foreground sm:text-lg">
              {formatPrice(listing.priceDay)}
            </span>
            <span>в сутки</span>
            {/* Залог целиком: без nowrap «залог» отрывался от суммы и уезжал
              * на свою строку. */}
            <span className="whitespace-nowrap">
              · {formatDeposit(listing.depositType, listing.depositAmount)}
            </span>
            {listing.quantity > 1 && (
              <span className="whitespace-nowrap">· {listing.quantity} шт.</span>
            )}
          </p>
        </div>

        {/* self-start: группа держится уровня ПЕРВОЙ строки названия, а не
          * середины блока, когда название переносится. Явно, а не в надежде на
          * items-start родителя — тот легко поменять, не заметив следствия.
          *
          * Отрицательный отступ сверху — оптическое выравнивание, а не сдвиг
          * «на глаз»: кнопка меню высотой 36px, а первая строка названия — 20px
          * на мобиле и 25px от sm. Содержимое группы центрируется в её 36
          * пикселях и без этой поправки висит ниже строки на половину разницы.
          *
          * Кнопками «Править» и «Смотреть объявление» шапка занимала третий ряд
          * ради двух переходов; в меню они и так есть. */}
        <div className="-mt-2 flex shrink-0 items-center gap-1 self-start sm:-mt-1.5 sm:gap-2">
          <span className="whitespace-nowrap rounded-sm bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground sm:px-2 sm:text-xs">
            {STATUS_WORD[listing.status]}
          </span>
          <ListingRowActions
            listingId={listing.id}
            status={listing.status}
            title={listing.title}
            publicHref={publicHref}
          />
        </div>
      </header>

      {/* На десктопе две колонки: занятость уезжает в правую, потому что
        * календарь имеет свою естественную ширину и в широкой колонке оставлял
        * полэкрана пустыми. На мобиле всё встаёт в столбец, и занятость идёт
        * после заявок — у них горит срок, у занятости нет. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="заявки" count={requests.length}>
            {requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">Заявок на эту вещь пока не было.</p>
            ) : (
              /* Та же лента, что в разделе заявок, компактным видом: панель
               * узкая, а вещь и роль здесь и так известны. Один вид заявки на
               * весь кабинет — телефон и кнопки решения в шторке. */
              <RequestsFeed compact rows={feedRows} />
            )}
          </Panel>

          <Panel title="переписки" count={threads.length}>
            {threads.length === 0 ? (
              <p className="text-sm text-muted-foreground">По этой вещи вам ещё не писали.</p>
            ) : (
              <ul className="-mx-1 flex flex-col">
                {threads.map((t, i) => (
                  <li key={t.id} className="contents">
                    {i > 0 && <span aria-hidden="true" className="mx-3 h-px bg-border" />}
                    <Link
                      href={`/chat/${t.id}` as never}
                      className="flex min-h-[52px] items-center gap-3 rounded-sm px-3 transition-colors hoverable"
                    >
                      <Avatar src={t.peerImage} name={t.peerName} size={32} />
                      <span className="min-w-0 flex-1 truncate">{t.peerName ?? "Собеседник"}</span>
                      {t.unread > 0 && (
                        <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-pill bg-accent px-1.5 text-[13px] font-bold text-accent-foreground">
                          <span aria-hidden="true">{t.unread}</span>
                          <span className="sr-only">, непрочитанных</span>
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {!isArchived && (
          <Panel title="занятость">
            {/* Строкой — то, ради чего сюда чаще всего заходят: свободна ли вещь
              * и когда ближайшая занятость. Сетка ниже отвечает на другой
              * вопрос, «что там дальше по месяцу», и нужна реже. */}
            <p className="mb-3 text-sm">
              {summary.nextBusyFrom === null ? (
                "Ближайший месяц свободен целиком."
              ) : (
                <>
                  Занятость есть в {summary.busyDays} {ruPlural(summary.busyDays, "дне", "днях", "днях")} ближайшего месяца.
                  {" "}
                  <span className="text-muted-foreground">
                    Ближайшая занятость: {summary.nextBusyFrom === summary.nextBusyTo
                      ? formatDayMonth(summary.nextBusyFrom)
                      : `${formatDayMonth(summary.nextBusyFrom)} — ${formatDayMonth(summary.nextBusyTo!)}`}.
                  </span>
                </>
              )}
            </p>
            <ListingAvailability
              listingId={listing.id}
              quantity={listing.quantity}
              availability={Object.fromEntries(map)}
              today={from}
              maxDate={horizon}
            />
          </Panel>
        )}
      </div>
    </main>
  );
}

/* Блок страницы вещи. Общая подложка и общий заголовок: до этого шапка, заявки,
 * занятость и переписки были огорожены четырьмя разными способами — от голого
 * текста до списка с разделителями, — и страница выглядела собранной наспех. */
function Panel({
  title, count, children,
}: {
  title: string;
  /** Число рядом с заголовком. Не показывается, когда считать нечего. */
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="surface p-4 sm:p-5">
      <h3 className="mb-3 font-mono text-2xs uppercase tracking-mono text-muted-foreground">
        {title}
        {count !== undefined && <span className="ml-1.5 text-foreground">{count}</span>}
      </h3>
      {children}
    </section>
  );
}
