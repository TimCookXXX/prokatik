// /{city}/{seg} — категория (слаг категории уникален глобально). Подкатегория по
// прямому слагу редиректится на канонический /{city}/{root}/{sub}. Карточка товара
// живёт на третьем сегменте (/{city}/{cat}/{slug}-{id}) — см. [sub]/page.tsx.
//
// Корень, пустой в самом городе, — 404. Исключение — действующая точка «Где»
// при ненулевой выдаче по региону: подсказки разделов и дерево с точкой ведут
// и в такие корни, страница тогда живёт, но с noindex — её canonical без точки
// отдаёт 404.
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  getAllCategories, getCategoryBySlug, getCategoryStats, getCityBySlug, getListingCountsByCategory,
  rollupToRoots, type Category, type City, type CityIds,
} from "@/server/catalog";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { CategoryListing, type CategorySearchParams } from "@/components/catalog/CategoryListing";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildBreadcrumbJsonLd } from "@/lib/jsonld";
import { content } from "@theme/content";
import { siteUrl } from "@/lib/site-config";
import { catalogDescription, catalogHeading, catalogTitle } from "@/lib/seo/titles";
import { getCityScope } from "@/server/city";
import { carryParams } from "@/lib/catalog/filters";
import { canonicalHref, categoryPath } from "@/lib/catalog/listing-path";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ city: string; seg: string }>;
  searchParams: Promise<CategorySearchParams>;
}

async function resolve(citySlug: string, seg: string) {
  const city = await getCityBySlug(citySlug);
  if (!city) return null;
  const category = await getCategoryBySlug(seg);
  if (!category) return null;
  return { city, category };
}

/** Активных объявлений корня (вместе с подразделами) в наборе городов. */
async function rootCount(cityIds: CityIds, root: Category): Promise<number> {
  const [cats, direct] = await Promise.all([getAllCategories(), getListingCountsByCategory(cityIds)]);
  return rollupToRoots(cats, direct).get(root.id) ?? 0;
}

/** Раздел вместе с подразделами — как его выдача. */
async function withChildren(cat: Category): Promise<string[]> {
  if (cat.parentId !== null) return [cat.id];
  const cats = await getAllCategories();
  return [cat.id, ...cats.filter((c) => c.parentId === cat.id).map((c) => c.id)];
}

/** Подкатегория → её корень; у корня — null. */
async function parentOf(cat: Category): Promise<Category | null> {
  if (cat.parentId === null) return null;
  return (await getAllCategories()).find((c) => c.id === cat.parentId) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: citySlug, seg } = await params;
  const r = await resolve(citySlug, seg);
  if (!r) return {};
  const cat = r.category;
  const root = await parentOf(cat);
  // Подкатегория по прямому слагу уходит 308 на канонический адрес; canonical
  // туда же — на случай, если ответ всё-таки отрисуется.
  const canonical = `${siteUrl()}${categoryPath(r.city.slug, cat, root)}`;
  // Пустой в городе корень отрисовывается только с точкой «Где» — и не индексируется.
  const emptyInCity = cat.parentId === null && (await rootCount([r.city.id], cat)) === 0;
  // Цена «от» и счётчики — по самому городу, как у canonical без точки «Где».
  const stats = await getCategoryStats([r.city.id], await withChildren(cat));
  return {
    title: { absolute: catalogTitle(cat.name, r.city, stats.minPriceDay) },
    description: catalogDescription(cat.name, r.city, stats),
    alternates: { canonical },
    ...(emptyInCity ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CitySegPage({ params, searchParams }: Props) {
  const { city: citySlug, seg } = await params;
  const r = await resolve(citySlug, seg);
  if (!r) notFound();
  const { city, category } = r;

  const sp = await searchParams;

  if (category.parentId !== null) {
    // Канонический адрес подкатегории — под корневой категорией. Даты и «Где»
    // переезжают вместе с ним (белый список canonicalHref).
    const root = await parentOf(category);
    if (root) {
      // Спред — ради индексной сигнатуры: у интерфейса параметров её нет.
      permanentRedirect(canonicalHref(categoryPath(city.slug, category, root), { ...sp }) as never);
    }
    notFound();
  }

  return <RootCategoryPage city={city} category={category} searchParams={sp} />;
}

async function RootCategoryPage({
  city, category, searchParams,
}: {
  city: City;
  category: Category;
  searchParams: CategorySearchParams;
}) {
  // Дети входят в выдачу корневой категории. Счётчики те же, что у дерева
  // внутри CategoryListing, — cache() не даёт им уйти в базу второй раз.
  const [categoryIds, scope, own] = await Promise.all([
    withChildren(category),
    // С точкой «Где» выдача — по всем городам региона (getCityScope).
    getCityScope(city, searchParams),
    rootCount([city.id], category),
  ]);
  // Пусто в самом городе: без точки «Где» страницы нет; с точкой она живёт,
  // пока по региону есть что показать (noindex ставит generateMetadata).
  if (own === 0 && (!scope.near || (await rootCount(scope.cityIds, category)) === 0)) notFound();

  const basePath = categoryPath(city.slug, category);
  // Крошки несут переносимые параметры (даты, «Где»), JSON-LD — нет: там канон.
  const carry = carryParams(searchParams).toString();
  const withCarry = (path: string) => (carry ? `${path}?${carry}` : path);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <JsonLd data={buildBreadcrumbJsonLd([
        { name: "Главная", url: "/" },
        { name: city.name, url: `/${city.slug}` },
        { name: category.name, url: basePath },
      ], siteUrl())} />
      <Breadcrumbs items={[
        { label: "Главная", href: "/" },
        { label: city.name, href: withCarry(`/${city.slug}`) },
        { label: category.name },
      ]} />
      <h1 className="mb-4 mt-3 font-display text-2xl font-bold">
        {catalogHeading(category.name, city)}
      </h1>
      {scope.nearby && (
        <p className="-mt-2 mb-4 text-sm text-muted-foreground">{content.search.nearby(city.name)}</p>
      )}
      <CategoryListing
        city={city}
        categoryIds={categoryIds}
        basePath={basePath}
        activeRootSlug={category.slug}
        activeLabel={category.name}
        searchParams={searchParams}
        scope={scope}
      />
    </main>
  );
}
