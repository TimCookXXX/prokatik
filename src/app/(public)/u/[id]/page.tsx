// Публичный профиль продавца — витрина, а не служебная страница: обложка,
// которую владелец загрузил в кабинете, аватар нахлёстом, имя, «на сайте с»,
// значок «Проверен», bio и сетка активных объявлений. Резолв по id: ника в
// системе нет, а имя в адрес не выносим — это частное лицо, а не магазин.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { notFound } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import {
  getSellerById, getSellerStats, getActiveListingCardsByOwner, getAvailabilityRows,
} from "@/server/catalog";
import { buildAvailabilityByListing } from "@/lib/catalog/availability";
import { todayStr, addDaysStr, formatMonthYearGen } from "@/lib/catalog/dates";
import { AvatarViewer } from "@/components/ui/AvatarViewer";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { ListingCard } from "@/components/catalog/ListingCard";
import { Metric } from "@/components/ui/Metric";
import { ProfileCover } from "@/components/account/ProfileCover";
import { ruPlural } from "@/lib/plural";
import { siteUrl } from "@/lib/site-config";

export const dynamic = "force-dynamic";

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const seller = await getSellerById(id);
  if (!seller || seller.bannedAt) return {};
  // Имя может отсутствовать: у OAuth-профиля без имени и у старых записей.
  const name = seller.name ?? "Продавец";
  return {
    title: `${name} — объявления`,
    description: `Объявления пользователя ${name}: аренда вещей с бронью онлайн.`,
    alternates: { canonical: `${siteUrl()}/u/${id}` },
  };
}

export default async function SellerProfilePage({ params }: Props) {
  const { id } = await params;
  const seller = await getSellerById(id);
  // Витрина забаненного закрыта: он загружает обложку и bio сам, и после бана
  // они не должны оставаться на публичном адресе.
  if (!seller || seller.bannedAt) notFound();

  const [stats, items] = await Promise.all([
    getSellerStats(seller.id),
    getActiveListingCardsByOwner(seller.id),
  ]);
  const from = todayStr();
  const availRows = await getAvailabilityRows(items.map((i) => i.listing.id), from, addDaysStr(from, 6));
  const availByListing = buildAvailabilityByListing(availRows);

  const displayName = seller.name ?? "Продавец";
  // «Казань · на сайте с марта 2024» — города может не быть, тогда остаётся
  // одна дата. Аренды отсюда ушли в метрики справа, чтобы число не повторялось
  // в строке и в счётчике.
  const byline = [
    stats.cityName,
    `на сайте с ${formatMonthYearGen(seller.createdAt)}`,
  ].filter(Boolean).join(" · ");

  return (
    <main>
      {/* Обложка уезжает под плавающую панель хедера; крошки лежат на фото
        * под ней, затемнение держит их читаемыми на любой фотографии. */}
      <ProfileCover src={seller.coverUrl} className="-mt-[var(--header-total)] h-40 md:h-52" priority>
        <div className="absolute inset-x-0 top-[calc(var(--header-total)+4px)]">
          {/* Обложка тёмная в обеих темах (своя или стандартная), поэтому
            * крошки всегда светлые: утилиты Breadcrumbs читают токены, здесь
            * они локально переопределены.
            *
            * px-4 ВНУТРИ ограничителя ширины, как у контейнера страницы ниже:
            * снаружи бокс становился шириной 1200 плюс отступы, и крошки
            * вылезали из колонки на 16px с каждой стороны. */}
          <div className="mx-auto w-full max-w-[1200px] px-4 [--color-foreground:#F5F5F7] [--color-muted-fg:rgba(245,245,247,0.72)]">
            <Breadcrumbs items={[{ label: "Главная", href: "/" }, { label: displayName }]} />
          </div>
        </div>
      </ProfileCover>

      <div className="mx-auto w-full max-w-[1200px] px-4 pb-8">
        {/* Визитка: имя, статус, числа и bio — одной поверхностью, которая
          * наезжает на обложку. Тексты получают подложку, а фото перестаёт быть
          * самостоятельным блоком в полэкрана и работает фоном под визиткой. */}
        {/* relative обязателен: визитка отрицательным margin залезает на обложку,
          * а та позиционирована и без своего контекста рисуется поверх неё. */}
        <div className="surface relative -mt-6 md:-mt-14">
          {/* Паддинг, кегль имени и вылет аватара те же, что в визитке кабинета
            * (AccountHero): это одна и та же карточка в двух местах, и размеры
            * у неё обязаны совпадать. */}
          <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:gap-5">
            {/* items-start на мобиле, items-center с md.
              *
              * На десктопе строка низкая: аватар в 96px перекрывает её целиком,
              * и центрирование читается как одно целое — посадка из макета.
              *
              * На телефоне справка занимает три-четыре строки, и центрировать
              * по ней нельзя: при центрировании аватар наружу не выходит вовсе,
              * а если вытянуть его отрицательным margin — он повисает над
              * серединой блока и выглядит отдельно от него. Поэтому равнение по
              * верху, а margin подобран так, чтобы центр аватара совпал со
              * СТРОКОЙ ИМЕНИ: 72/2 − 28 ≈ середина первой строки. Эта величина
              * постоянная, сколько бы строк ни было в справке. */}
            <div className="flex min-w-0 flex-1 items-start gap-4 md:items-center md:gap-5">
              {/* Аватар остаётся элементом строки, а выступает за верхнюю кромку
                * отрицательным margin: при items-center центрируется его сжатый
                * margin-box, поэтому он и свисает, и держится почти на одной
                * линии с именем. Вынуть его из потока (absolute) нельзя — центр
                * уезжает выше имени; оставить в потоке без margin тоже: 96px
                * задают высоту всей визитки, и она раздувается.
                *
                * Выступ на мобиле меньше: на этой высоте лежат крошки на
                * обложке, и подниматься выше аватару некуда.
                *
                * Кольцо цвета КАРТОЧКИ — аватар выступает на фотографию, и без
                * него кромка карточки резала бы его пополам.
                *
                * Размер у AvatarViewer задан пропом (инлайновые width/height),
                * классом на брейкпоинте не масштабируется — рендерим два. */}
              <div className="-mt-7 shrink-0 md:-mt-12">
                <span className="md:hidden">
                  <AvatarViewer src={seller.image} name={seller.name} size={72} className="shadow-[0_0_0_4px_var(--color-card)]" />
                </span>
                <span className="hidden md:block">
                  <AvatarViewer src={seller.image} name={seller.name} size={96} className="shadow-[0_0_0_4px_var(--color-card)]" />
                </span>
              </div>

              <div className="min-w-0">
                <h1 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-display text-xl font-extrabold leading-tight tracking-tight md:text-2xl">
                  {displayName}
                  {seller.isVerified && (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-accent/15 px-2.5 py-0.5 text-sm font-medium text-accent">
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Проверен
                    </span>
                  )}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">{byline}</p>
              </div>
            </div>

            {/* Только на десктопе: на телефоне числа вставали отдельной строкой
              * под справкой и тянули визитку вверх ради того, что и так видно
              * в сетке объявлений под ней. */}
            <div className="hidden shrink-0 md:flex md:gap-8">
              <Metric value={items.length} label={ruPlural(items.length, "вещь", "вещи", "вещей")} />
              <Metric value={stats.deals} label={ruPlural(stats.deals, "аренда", "аренды", "аренд")} />
            </div>
          </div>

          {seller.bio && (
            <>
              <div className="h-px bg-border" />
              {/* max-w-2xl остаётся: визитка во всю ширину страницы, и строка
                * без ограничения уехала бы за 1100px. */}
              <p className="max-w-2xl p-4 text-[15px] leading-body [text-wrap:pretty]">
                {seller.bio}
              </p>
            </>
          )}
        </div>

        <section aria-labelledby="seller-listings" className="mt-7">
          {/* Без числа в заголовке: оно уже стоит метрикой в визитке. */}
          <h2 id="seller-listings" className="mb-3.5 font-display text-xl font-bold">
            Вещи в аренду
          </h2>
          {items.length === 0 ? (
            <EmptyState className="min-h-[25svh]">У продавца пока нет активных объявлений.</EmptyState>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
              {items.map((item) => (
                <ListingCard
                  key={item.listing.id}
                  item={item}
                  citySlug={item.citySlug}
                  availabilityMap={availByListing.get(item.listing.id) ?? new Map()}
                  from={from}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
