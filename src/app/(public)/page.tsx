import type { Metadata } from "next";
import { seo } from "@theme/seo";
import { auth } from "@/lib/auth";
import { authPanelProps } from "@/lib/auth/panel-props";
import {
  getAllCategories, getListingCountsByCategory, getRecentListings, rollupToRoots,
} from "@/server/catalog";
import { getCitiesGeo, resolveViewerCity } from "@/server/city";
import { Hero } from "@/components/home/Hero";
import { CategoryTiles } from "@/components/home/CategoryTiles";
import { RecentItems } from "@/components/home/RecentItems";
import { HowItWorks } from "@/components/home/HowItWorks";
import { ListYourItemBand } from "@/components/home/ListYourItemBand";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // absolute — иначе к заголовку применится шаблон `%s — inrenta` из корневого
  // layout и имя задвоится.
  title: { absolute: seo.defaultTitle },
  description: seo.defaultDescription,
};

export default async function HomePage() {
  const [session, defaultCity, cats, citiesGeo] = await Promise.all([
    auth(),
    resolveViewerCity(),
    getAllCategories(),
    getCitiesGeo(),
  ]);

  const roots = cats.filter((c) => c.parentId === null);
  const counts = defaultCity
    ? rollupToRoots(cats, await getListingCountsByCategory([defaultCity.id]))
    : null;

  // Восемь последних — ровно два ряда по четыре на десктопе.
  const recent = defaultCity ? await getRecentListings(defaultCity.id, 8) : [];

  // Только непустые категории: чип, за которым в городе ничего нет, обещает
  // то, чего человек не найдёт. Числа в чипах не показываем.
  const chips = counts
    ? roots
        .filter((c) => (counts.get(c.id) ?? 0) > 0)
        .map((c) => ({ slug: c.slug, name: c.name, vertical: c.vertical }))
    : [];

  // Город поиска в hero — та же запись, что у шапки, с тем же гео-контекстом.
  const heroCity = defaultCity
    ? { slug: defaultCity.slug, name: defaultCity.name, geo: citiesGeo.get(defaultCity.slug) ?? null }
    : undefined;

  const user = session?.user;
  const placeHref = user ? "/cabinet/listings/new" : "/login";

  // Анониму «Разместить» открывает вход модалкой, а не уводит на /login.
  const authProps = user ? undefined : authPanelProps();

  return (
    // Стопка панелей одной ширины. Контейнер совпадает с шапкой и подвалом,
    // иначе края главной разъезжаются с плавающей панелью над ней.
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 pb-4 pt-5">
      <Hero city={heroCity} placeHref={placeHref} authProps={authProps} />

      {defaultCity && <CategoryTiles citySlug={defaultCity.slug} categories={chips} />}

      {defaultCity && <RecentItems items={recent} citySlug={defaultCity.slug} />}

      <HowItWorks />

      <ListYourItemBand href={placeHref} authProps={authProps} />
    </main>
  );
}
