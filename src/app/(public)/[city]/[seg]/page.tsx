// /{city}/{seg} — категория (слаг категории уникален глобально). Подкатегория по
// прямому слагу редиректится на канонический /{city}/{root}/{sub}. Карточка товара
// живёт на третьем сегменте (/{city}/{cat}/{slug}-{id}) — см. [sub]/page.tsx.
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  getAllCategories, getCategoryBySlug, getCityBySlug,
  type Category, type City,
} from "@/server/catalog";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { CategoryListing, type CategorySearchParams } from "@/components/catalog/CategoryListing";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildBreadcrumbJsonLd } from "@/lib/jsonld";
import { content } from "@theme/content";
import { siteConfig } from "@/lib/site-config";
import { headingCity, proseCity } from "@/lib/catalog/city-locative";
import { getCityScope } from "@/server/city";
import { carryParams } from "@/lib/catalog/filters";
import { canonicalHref } from "@/lib/catalog/listing-path";

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: citySlug, seg } = await params;
  const r = await resolve(citySlug, seg);
  if (!r) return {};
  const cat = r.category;
  return {
    title: `Аренда: ${cat.name.toLowerCase()} ${headingCity(r.city)}`,
    description: `${cat.name} напрокат ${proseCity(r.city)}: каталог товаров с ценами, залогами и календарём занятости.`,
    alternates: { canonical: `${siteConfig.url}/${r.city.slug}/${seg}` },
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
    const cats = await getAllCategories();
    const root = cats.find((c) => c.id === category.parentId);
    if (root) {
      // Спред — ради индексной сигнатуры: у интерфейса параметров её нет.
      const path = `/${city.slug}/${root.slug}/${category.slug}`;
      permanentRedirect(canonicalHref(path, { ...sp }) as never);
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
  // Счётчики грузит дерево внутри CategoryListing; здесь нужны только дети —
  // их id входят в выдачу корневой категории.
  const cats = await getAllCategories();
  const children = cats.filter((c) => c.parentId === category.id);
  const categoryIds = [category.id, ...children.map((c) => c.id)];
  const basePath = `/${city.slug}/${category.slug}`;
  // С точкой «Где» выдача — по всем городам региона (getCityScope).
  const scope = await getCityScope(city, searchParams);
  // Крошки несут переносимые параметры (даты, «Где»), JSON-LD — нет: там канон.
  const carry = carryParams(searchParams).toString();
  const withCarry = (path: string) => (carry ? `${path}?${carry}` : path);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <JsonLd data={buildBreadcrumbJsonLd([
        { name: "Главная", url: "/" },
        { name: city.name, url: `/${city.slug}` },
        { name: category.name, url: basePath },
      ], siteConfig.url)} />
      <Breadcrumbs items={[
        { label: "Главная", href: "/" },
        { label: city.name, href: withCarry(`/${city.slug}`) },
        { label: category.name },
      ]} />
      <h1 className="mb-4 mt-3 font-display text-2xl font-bold">
        Аренда: {category.name.toLowerCase()} {headingCity(city)}
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
