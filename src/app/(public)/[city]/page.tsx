// Хаб города: все активные товары города (фильтры, пагинация) + навигация по
// корневым категориям чипами.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getAllCategories, getCityBySlug, getListingCountsByCategory,
} from "@/server/catalog";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { CategoryListing, type CategorySearchParams } from "@/components/catalog/CategoryListing";
import { content } from "@theme/content";
import { siteUrl } from "@/lib/site-config";
import { headingCity, proseCity } from "@/lib/catalog/city-locative";
import { getCityScope } from "@/server/city";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ city: string }>;
  searchParams: Promise<CategorySearchParams>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: citySlug } = await params;
  const city = await getCityBySlug(citySlug);
  if (!city) return {};
  // Город без объявлений — не 404: на /{slug} ведёт селектор города, и только
  // что заведённый город встречал бы людей «Страница не найдена». Но и в индекс
  // пустая витрина не идёт; из sitemap её убирает sitemap.ts. Счётчики те же,
  // что у дерева разделов на странице (cache()).
  const counts = await getListingCountsByCategory([city.id]);
  const empty = [...counts.values()].every((n) => n === 0);
  return {
    title: `Аренда вещей ${headingCity(city)}`,
    description: `Всё для аренды ${proseCity(city)}: инструмент, техника, спорт, одежда и другое. Каталог с ценами и заявкой на бронь онлайн.`,
    alternates: { canonical: `${siteUrl()}/${city.slug}` },
    ...(empty ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CityPage({ params, searchParams }: Props) {
  const { city: citySlug } = await params;
  const city = await getCityBySlug(citySlug);
  if (!city) notFound();

  // Счётчики категорий грузит само дерево внутри CategoryListing — здесь нужен
  // только полный список id для выдачи «всё в городе».
  const allCategoryIds = (await getAllCategories()).map((c) => c.id);
  const sp = await searchParams;
  // С точкой «Где» выдача — по всем городам региона (getCityScope).
  const scope = await getCityScope(city, sp);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <Breadcrumbs items={[{ label: "Главная", href: "/" }, { label: city.name }]} />
      <h1 className="mb-4 mt-3 font-display text-2xl font-bold">Всё для аренды {headingCity(city)}</h1>
      {scope.nearby && (
        <p className="-mt-2 mb-4 text-sm text-muted-foreground">{content.search.nearby(city.name)}</p>
      )}
      <CategoryListing
        city={city}
        categoryIds={allCategoryIds}
        basePath={`/${city.slug}`}
        activeLabel="Все категории"
        searchParams={sp}
        scope={scope}
      />
    </main>
  );
}
