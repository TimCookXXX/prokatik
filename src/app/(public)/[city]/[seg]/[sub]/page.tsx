// /{city}/{seg}/{sub} — снова двусмысленно:
//   sub = {slug}-{id} и товар с этим id активен → карточка товара;
//   иначе seg = корневая категория, sub = подкатегория (список, 404 если пусто).
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import {
  getAllCategories, getAvailabilityRows, getCategoryById, getCategoryBySlug,
  getCityById, getCityBySlug, getActiveListingById, getListingCountsByCategory, getSellerById,
  getActiveListingCardsByOwner, getListingDistance, getListingsForCategories,
  listingPhotos,
  type Category, type City, type PublicListing, type Seller,
} from "@/server/catalog";
import { canonicalHref, extractListingId, listingPath } from "@/lib/catalog/listing-path";
import { carryParams } from "@/lib/catalog/filters";
import { formatPrice } from "@/lib/catalog/format";
import { addDaysStr, todayStr } from "@/lib/catalog/dates";
import type { AvailabilityMap } from "@/lib/catalog/availability";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { Gallery } from "@/components/catalog/Gallery";
import { ListingCard } from "@/components/catalog/ListingCard";
import { CategoryListing, type CategorySearchParams } from "@/components/catalog/CategoryListing";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildBreadcrumbJsonLd, buildProductJsonLd } from "@/lib/jsonld";
import { content } from "@theme/content";
import { siteConfig } from "@/lib/site-config";
import { headingCity, proseCity } from "@/lib/catalog/city-locative";
import { getCityScope } from "@/server/city";
import { buildAvailabilityByListing, freeQty } from "@/lib/catalog/availability";
import { isPubliclyVisible } from "@/lib/catalog/visibility";
import { BOOKING_HORIZON_DAYS, parseBookingParams } from "@/lib/booking/params";
import { BookingWidget } from "@/components/booking/BookingWidget";
import { authPanelProps } from "@/lib/auth/panel-props";
import { OwnerCard } from "@/components/booking/OwnerCard";
import { auth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getUserPhone } from "@/server/booking";
import { findThreadByListing } from "@/server/chat";
import { getDb } from "@/lib/db";
import { events } from "@db/schema";
import { newId } from "@/lib/id";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ city: string; seg: string; sub: string }>;
  searchParams: Promise<CategorySearchParams & { from?: string; to?: string; qty?: string }>;
}

type Resolved =
  | { kind: "subcategory"; city: City; root: Category; sub: Category }
  | { kind: "listing"; city: City; category: Category; listing: PublicListing; seller: Seller };

async function resolve(citySlug: string, seg: string, sub: string): Promise<Resolved | null> {
  const city = await getCityBySlug(citySlug);
  if (!city) return null;

  // Попытка: карточка товара /{city}/{cat}/{slug}-{id}.
  const parsed = extractListingId(sub);
  if (parsed) {
    const listing = await getActiveListingById(parsed.id);
    if (!listing) return null;
    // Город вещи задаёт её адрес, и новый адрес переносит её в другой город
    // региона. Старая ссылка под прежним городом уводится на настоящий — тем
    // же каноническим редиректом, что и при смене категории или названия.
    const [category, seller, listingCity] = await Promise.all([
      getCategoryById(listing.categoryId),
      getSellerById(listing.ownerUserId),
      listing.cityId === city.id ? city : getCityById(listing.cityId),
    ]);
    if (!category || !seller || !listingCity) return null;
    // Бан владельца уводит карточку в 404 — и саму страницу, и generateMetadata:
    // обе ходят сюда. Статус объявления бан гасит на записи, так что до этой
    // строки обычно не доходит; она страхует расхождение статуса с баном.
    if (!isPubliclyVisible({ status: listing.status, ownerBannedAt: seller.bannedAt })) return null;
    return { kind: "listing", city: listingCity, category, listing, seller };
  }

  // Иначе: подкатегория /{city}/{root}/{sub}.
  const root = await getCategoryBySlug(seg);
  if (!root || root.parentId !== null) return null;
  const cats = await getAllCategories();
  const subCat = cats.find((c) => c.slug === sub && c.parentId === root.id);
  if (!subCat) return null;
  return { kind: "subcategory", city, root, sub: subCat };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: citySlug, seg, sub } = await params;
  const r = await resolve(citySlug, seg, sub);
  if (!r) return {};
  if (r.kind === "subcategory") {
    return {
      title: `Аренда: ${r.sub.name.toLowerCase()} ${headingCity(r.city)}`,
      description: `${r.sub.name} напрокат ${proseCity(r.city)}: цены, залоги, календарь занятости.`,
      alternates: { canonical: `${siteConfig.url}/${r.city.slug}/${seg}/${sub}` },
    };
  }
  const priceBit = ` от ${formatPrice(r.listing.priceDay)}/сутки`;
  const canonical = listingPath(r.city.slug, r.category.slug, r.listing.slug, r.listing.id);
  return {
    // Город в хвосте, а не перед ценой: без падежа получалось бы «аренда,
    // Казань от 500 ₽» — читается как цена города.
    title: `${r.listing.title} — аренда${priceBit} ${proseCity(r.city)}`,
    description: r.listing.description ?? `${r.listing.title} напрокат ${proseCity(r.city)}.`,
    alternates: { canonical: `${siteConfig.url}${canonical}` },
  };
}

export default async function CitySubPage({ params, searchParams }: Props) {
  const { city: citySlug, seg, sub } = await params;
  const r = await resolve(citySlug, seg, sub);
  if (!r) notFound();

  const sp = await searchParams;
  if (r.kind === "subcategory") {
    return <SubcategoryPage r={r} searchParams={sp} />;
  }

  // Каноничность URL товара: город вещи, seg = слаг категории, slug-часть =
  // listing.slug. Даты, количество и «Где» переезжают вместе с ним (белый
  // список canonicalHref) — иначе старая ссылка теряла бы выбор в виджете брони.
  const parsed = extractListingId(sub);
  if (citySlug !== r.city.slug || seg !== r.category.slug || parsed?.slug !== r.listing.slug) {
    const path = listingPath(r.city.slug, r.category.slug, r.listing.slug, r.listing.id);
    permanentRedirect(canonicalHref(path, { ...sp }) as never);
  }
  return <ListingPage r={r} searchParams={sp} />;
}

async function SubcategoryPage({
  r, searchParams,
}: {
  r: Extract<Resolved, { kind: "subcategory" }>;
  searchParams: CategorySearchParams;
}) {
  const { city, root, sub } = r;
  // Страница подкатегории существует только при ≥1 активной позиции в самом
  // городе — с точкой «Где» и без неё одинаково: иначе страница жила бы, пока
  // в адресе есть точка, а её canonical и ссылка без «Где» вели бы в 404.
  // Выдача с точкой — по всем городам региона (getCityScope).
  const [scope, ownCounts] = await Promise.all([
    getCityScope(city, searchParams),
    getListingCountsByCategory([city.id]),
  ]);
  if ((ownCounts.get(sub.id) ?? 0) === 0) notFound();

  const categoryBasePath = `/${city.slug}/${root.slug}`;
  // Крошки несут переносимые параметры (даты, «Где»), JSON-LD — нет: там канон.
  const carry = carryParams(searchParams).toString();
  const withCarry = (path: string) => (carry ? `${path}?${carry}` : path);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <JsonLd data={buildBreadcrumbJsonLd([
        { name: "Главная", url: "/" },
        { name: city.name, url: `/${city.slug}` },
        { name: root.name, url: categoryBasePath },
        { name: sub.name, url: `${categoryBasePath}/${sub.slug}` },
      ], siteConfig.url)} />
      <Breadcrumbs items={[
        { label: "Главная", href: "/" },
        { label: city.name, href: withCarry(`/${city.slug}`) },
        { label: root.name, href: withCarry(categoryBasePath) },
        { label: sub.name },
      ]} />
      <h1 className="mb-4 mt-3 font-display text-2xl font-bold">
        Аренда: {sub.name.toLowerCase()} {headingCity(city)}
      </h1>
      {scope.nearby && (
        <p className="-mt-2 mb-4 text-sm text-muted-foreground">{content.search.nearby(city.name)}</p>
      )}
      <CategoryListing
        city={city}
        categoryIds={[sub.id]}
        basePath={`${categoryBasePath}/${sub.slug}`}
        activeRootSlug={root.slug}
        activeSubSlug={sub.slug}
        activeLabel={sub.name}
        searchParams={searchParams}
        scope={scope}
      />
    </main>
  );
}

async function ListingPage({
  r, searchParams,
}: {
  r: Extract<Resolved, { kind: "listing" }>;
  searchParams: CategorySearchParams & { qty?: string };
}) {
  const { city, category, listing, seller } = r;
  const photos = listingPhotos(listing);
  const sellerName = seller.name ?? "Продавец";
  const sellerHref = `/u/${seller.id}`;

  const session = await auth();
  const isAuthed = Boolean(session?.user);
  // Своё объявление: ни писать самому себе, ни бронировать свою вещь нельзя.
  const isOwn = session?.user?.id === listing.ownerUserId;
  // «Написать» ведёт сразу в конечный экран: существующий тред — в него,
  // иначе — в композер /chat/new. Промежуточного захода на список чатов нет.
  // Анониму тред неизвестен — ему всегда композер: после входа тот сам
  // редиректнет в тред, если он есть. Для своего объявления кнопки нет.
  const existingThreadId = isAuthed && !isOwn && session?.user?.id
    ? await findThreadByListing(listing.id, session.user.id)
    : null;
  const chatHref = existingThreadId ? `/chat/${existingThreadId}` : `/chat/new/${listing.id}`;
  const initialPhone = session?.user?.id ? (await getUserPhone(session.user.id)) ?? "" : "";
  const env = getEnv();
  const authProps = authPanelProps();
  // Расстояние до вещи от точки «Где» из адреса — считает SQL, точка
  // объявления в страницу не попадает.
  const { near } = await getCityScope(city, searchParams);
  const distance = near ? await getListingDistance(listing.id, near) : null;

  const from = todayStr();
  const rows = await getAvailabilityRows([listing.id], from, addDaysStr(from, BOOKING_HORIZON_DAYS));
  const map: AvailabilityMap = new Map(
    rows.map((row) => [row.date, { bookedQty: row.bookedQty, blockedQty: row.blockedQty }]),
  );
  const availabilityRecord = Object.fromEntries(map);

  const parsedSelection = parseBookingParams(searchParams, { today: from, maxQty: listing.quantity });
  // Стартовый выбор по умолчанию — первый свободный день (бронь доступна сразу,
  // без действий пользователя; сегодня может быть занято).
  const horizonDates = Array.from({ length: BOOKING_HORIZON_DAYS + 1 }, (_, i) => addDaysStr(from, i));
  const firstFree = horizonDates.find((d) => freeQty(listing.quantity, map.get(d)) > 0) ?? from;
  const selection = searchParams.from
    ? parsedSelection
    : { ...parsedSelection, from: firstFree, to: firstFree };

  // view_listing — сырьё для статистики. Ошибка записи не должна ронять страницу.
  try {
    await getDb().insert(events).values({
      id: newId(),
      entityType: "listing",
      entityId: listing.id,
      event: "view_listing",
      userId: session?.user?.id ?? null,
    });
  } catch (e) {
    console.error("[events] view_listing insert failed:", e);
  }

  const categoryHref = `/${city.slug}/${category.slug}`;
  const crumbs = [
    { label: "Главная", href: "/" },
    { label: city.name, href: `/${city.slug}` },
    { label: category.name, href: categoryHref },
    { label: listing.title },
  ];
  // Крошки на странице несут даты обратно в выдачу; JSON-LD строится из crumbs
  // без query — там канонические адреса.
  const carry = carryParams(searchParams, { today: from }).toString();
  const visibleCrumbs = carry
    ? crumbs.map((c) => (c.href && c.href !== "/" ? { ...c, href: `${c.href}?${carry}` } : c))
    : crumbs;

  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysStr(from, i));
  const available = weekDates.some((d) => freeQty(listing.quantity, map.get(d)) > 0);
  const canonicalPath = listingPath(city.slug, category.slug, listing.slug, listing.id);

  // Похожее: другие товары продавца и другие в этой категории (без текущего).
  const [sellerItemsAll, categoryItemsRes] = await Promise.all([
    getActiveListingCardsByOwner(seller.id),
    getListingsForCategories([city.id], [category.id], { pageSize: 13 }),
  ]);
  const moreFromSeller = sellerItemsAll.filter((i) => i.listing.id !== listing.id).slice(0, 8);
  const moreInCategory = categoryItemsRes.items.filter((i) => i.listing.id !== listing.id).slice(0, 8);

  // Занятость карточек в блоках «ещё»: у самой позиции она уже загружена выше,
  // но на горизонт брони — соседям хватает недели, как в каталоге.
  const relatedIds = [...moreFromSeller, ...moreInCategory].map((i) => i.listing.id);
  const relatedAvail = buildAvailabilityByListing(
    await getAvailabilityRows(relatedIds, from, addDaysStr(from, 6)),
  );

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <JsonLd data={buildProductJsonLd({
        title: listing.title,
        description: listing.description,
        priceDay: listing.priceDay,
        photoUrls: photos.map((p) => p.url),
        url: `${siteConfig.url}${canonicalPath}`,
        sellerName,
        available,
      })} />
      <JsonLd data={buildBreadcrumbJsonLd(
        crumbs.map((c) => ({ name: c.label, url: c.href })),
        siteConfig.url,
      )} />
      <Breadcrumbs items={visibleCrumbs} />
      <h1 className="mt-2 font-display text-xl font-bold sm:text-2xl">{listing.title}</h1>

      <div className="mt-3 grid grid-cols-1 gap-6 md:grid-cols-[1fr_360px]">
        <div>
          <Gallery photos={photos} title={listing.title} />

          <div className="mt-5">
            <OwnerCard
              name={sellerName}
              href={sellerHref}
              image={seller.image}
              isVerified={seller.isVerified}
              location={listing.location}
              geoPrecision={listing.geoPrecision}
              cityName={city.name}
              distance={distance}
              createdAt={seller.createdAt}
              chatHref={chatHref}
              isAuthed={isAuthed}
              isOwn={isOwn}
              authProps={authProps}
            />
          </div>

          {/* Описание и условия — на одной плашке, а не карточкой: между карточкой
            * владельца и заглушкой отзывов третья белая коробка сделала бы колонку
            * стопкой одинаковых поверхностей. Плашка тише и не спорит с ними за
            * внимание. Ширину строки держит сама плашка, поэтому max-w тексту не
            * нужен — обрезанная колонка внутри широкой подложки читалась бы как
            * ошибка вёрстки. */}
          <div className="mt-8 rounded-lg bg-muted">
            {listing.description && (
              <section className="p-4 sm:p-5">
                <h2 className="mb-2 font-mono text-2xs font-medium uppercase tracking-mono text-muted-foreground">Описание</h2>
                <p className="whitespace-pre-line text-sm leading-body">{listing.description}</p>
              </section>
            )}

            {/* Разделитель — только когда сверху есть описание: без него плашка
              * начиналась бы кантом в никуда. */}
            <section className={`p-4 sm:p-5 ${listing.description ? "border-t border-border" : ""}`}>
              <h2 className="mb-3 font-mono text-2xs font-medium uppercase tracking-mono text-muted-foreground">Условия аренды</h2>
              <ul className="flex flex-col gap-2.5 text-sm">
                <li className="flex gap-2.5">
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>Оплата и залог — напрямую с владельцем. Сервис сводит вас и ведёт заявку, платежей внутри нет.</span>
                </li>
                <li className="flex gap-2.5">
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>Заявка на бронь ни к чему не обязывает. Даты займутся только после подтверждения владельцем.</span>
                </li>
                <li className="flex gap-2.5">
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>
                    {listing.depositType === "none"
                      ? "Без залога."
                      : listing.depositType === "document"
                        ? "Залог — документ, возвращается после аренды."
                        : listing.depositAmount
                          ? `Залог ${formatPrice(listing.depositAmount)} — возвращается после возврата вещи в исходном состоянии.`
                          : "Залог — по договорённости с владельцем."}
                  </span>
                </li>
              </ul>
            </section>
          </div>

          {/* Отзывы — заглушка (данных отзывов пока нет). */}
          <section className="mt-8">
            <h2 className="mb-3 text-lg font-bold">Отзывы</h2>
            <div className="surface p-6 text-center text-sm text-muted-foreground">
              Отзывов пока нет — они появятся после первых аренд.
            </div>
          </section>

        </div>

        <aside className="flex flex-col gap-4 md:sticky md:top-20 md:self-start">
          <BookingWidget
            listingId={listing.id}
            listingTitle={listing.title}
            initialPhone={initialPhone}
            pathname={canonicalPath}
            initial={selection}
            today={from}
            maxDate={addDaysStr(from, BOOKING_HORIZON_DAYS)}
            availability={availabilityRecord}
            quantity={listing.quantity}
            priceDay={listing.priceDay}
            depositType={listing.depositType}
            depositAmount={listing.depositAmount}
            handoverPickup={listing.handoverPickup}
            handoverDelivery={listing.handoverDelivery}
            sellerName={sellerName}
            sellerHref={sellerHref}
            isAuthed={isAuthed}
            isOwn={isOwn}
            authProps={authProps}
          />
        </aside>
      </div>

      {moreFromSeller.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-bold">
            Ещё у{" "}
            <Link href={sellerHref as never} className="text-accent hover:underline">{sellerName}</Link>
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {moreFromSeller.map((item) => (
              <div key={item.listing.id} className="w-[220px] shrink-0 sm:w-[240px]">
                <ListingCard
                  item={item}
                  citySlug={item.citySlug}
                  availabilityMap={relatedAvail.get(item.listing.id) ?? new Map()}
                  from={from}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {moreInCategory.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-bold">
            Ещё в категории{" "}
            <Link href={categoryHref as never} className="text-accent hover:underline">{category.name}</Link>
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {moreInCategory.map((item) => (
              <div key={item.listing.id} className="w-[220px] shrink-0 sm:w-[240px]">
                <ListingCard
                  item={item}
                  citySlug={city.slug}
                  availabilityMap={relatedAvail.get(item.listing.id) ?? new Map()}
                  from={from}
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
