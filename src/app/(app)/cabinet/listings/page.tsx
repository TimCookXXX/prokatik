import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { countNewRequestsByListing, getOwnerListings } from "@/server/owner";
import { getCitiesGeo } from "@/server/city";
import {
  getActiveCities, getAllCategories, getAvailabilityRows, listingPhotos,
} from "@/server/catalog";
import { listingPath } from "@/lib/catalog/listing-path";
import { buildAvailabilityByListing, freeQty } from "@/lib/catalog/availability";
import { todayStr } from "@/lib/catalog/dates";
import { Button } from "@/components/ui/button";
import { ListingsFilter } from "@/components/cabinet/ListingsFilter";
import { isListingsView, type ListingsView } from "@/lib/owner/listings-view";
import type { ListingRow } from "@/components/cabinet/ListingsList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Мои объявления", robots: { index: false } };

// Вид приходит из адреса: строкой, массивом при повторе ключа или мусором.
// Всё, что не вид, — это «Все», а не ошибка: фильтр не должен ронять страницу.
function parseView(raw: string | string[] | undefined): ListingsView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isListingsView(value) ? value : "all";
}

export default async function CabinetListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

  const view = parseView((await searchParams).view);

  const [items, cities, cats, pendingByListing, citiesGeo] = await Promise.all([
    getOwnerListings(session.user.id),
    getActiveCities(),
    getAllCategories(),
    countNewRequestsByListing(session.user.id),
    getCitiesGeo(),
  ]);
  const citySlug = new Map(cities.map((c) => [c.id, c.slug]));
  const catSlug = new Map(cats.map((c) => [c.id, c.slug]));
  const catName = new Map(cats.map((c) => [c.id, c.name]));

  // Архивные едут сюда же: они не отдельная страница, а вид фильтра. Порядок у
  // всех один — по дате создания; своей сортировки «сверху убранное только
  // что» у архива больше нет.
  //
  // Занятость — одним запросом на страницу и только по активным: у скрытых и
  // архивных плашки нет, а без строк занятости freeQty вернул бы всё
  // количество и нарисовал бы им зелёное «Свободно».
  const from = todayStr();
  const activeIds = items.filter((l) => l.status === "active").map((l) => l.id);
  const availByListing = buildAvailabilityByListing(
    await getAvailabilityRows(activeIds, from, from),
  );

  const rows: ListingRow[] = items.map((l) => {
    const cSlug = citySlug.get(l.cityId);
    const catS = catSlug.get(l.categoryId);
    // Публичная страница есть только у активного. У скрытого и архивного её
    // нет, а слага города может не быть вовсе — город деактивировали.
    const publicHref = l.status === "active" && cSlug && catS
      ? listingPath(cSlug, catS, l.slug, l.id)
      : null;
    return {
      id: l.id,
      title: l.title,
      photoUrl: listingPhotos(l)[0]?.url ?? null,
      categoryName: catName.get(l.categoryId) ?? null,
      priceDay: l.priceDay,
      depositType: l.depositType,
      depositAmount: l.depositAmount,
      status: l.status,
      freeToday: l.status === "active"
        ? freeQty(l.quantity, availByListing.get(l.id)?.get(from))
        : null,
      quantity: l.quantity,
      // Архивная вещь из каталога убрана, но заявка по ней могла остаться
      // ждущей ответа — прочерк тут врал бы.
      pendingRequests: pendingByListing.get(l.id) ?? 0,
      publicHref,
      // Без точки и в городе, где адрес можно выбрать из подсказок. Архив не
      // просим: в каталоге его нет, и расстояния там некому показывать.
      needsAddress: l.status !== "archived" && l.geoPrecision === "city"
        && !!cSlug && !!citiesGeo.get(cSlug),
    };
  });

  return (
    <section aria-label="Мои объявления">
      {rows.length === 0 ? (
        <>
          {/* Единственное место, где кнопка осталась: у пустого списка она и
            * есть призыв к действию. В непустом её нет ни на десктопе, где
            * разместить можно из шапки сайта и из блока над кабинетом, ни на
            * мобиле, где «Сдать» с плюсом постоянно висит в нижней панели. */}
          <div className="mb-4 flex justify-end">
            <Button asChild size="sm" className="tap-target">
              <Link href={"/cabinet/listings/new" as never}>+ Разместить</Link>
            </Button>
          </div>
          <EmptyState>
            Разместите первое объявление — оно появится в каталоге.
          </EmptyState>
        </>
      ) : (
        <ListingsFilter rows={rows} initialView={view} />
      )}
    </section>
  );
}
