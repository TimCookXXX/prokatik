import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { content } from "@theme/content";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCityBySlug } from "@/server/catalog";
import { resolveViewerCity } from "@/server/city";
import { parseQuery, type CategorySearchParams } from "@/lib/catalog/filters";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { SearchResults } from "@/components/catalog/SearchResults";

export const dynamic = "force-dynamic";

// noindex: без запроса страница показывает ту же выдачу, что и витрина города,
// а с параметрами разворачивается в бесконечную комбинаторику фильтров. Для
// поиска индексируются категорийные страницы — они и лежат в sitemap.
// Здесь именно noindex, а не Disallow в robots.txt: закрытый от обхода адрес
// робот не скачает и запрета внутри не прочитает.
export const metadata: Metadata = { title: content.search.title, robots: { index: false } };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<CategorySearchParams>;
}) {
  const sp = await searchParams;
  const q = parseQuery(sp);

  // Поиск в пределах города: ?city=… или выбранный город. Город здесь несущий,
  // а не декоративный, поэтому чужой слаг в адресе — это 404, а не молчаливый
  // откат к другому городу с чужой выдачей. Предпочтение так не работает: оно
  // не адрес, и отключённый в нём город просто уступает следующему.
  const city = sp.city
    ? (await getCityBySlug(sp.city)) ?? notFound()
    : await resolveViewerCity();

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <Breadcrumbs items={[{ label: "Главная", href: "/" }, { label: content.search.title }]} />
      {/* Город отделён точкой, а не предлогом: в базе он лежит в именительном
        * падеже, и «поиск по Казань» из него не собрать. Заголовок — весь
        * запрос, как его набрали; если нашлось только по части, это говорит
        * плашка над выдачей (SearchResults). */}
      <h1 className="mb-4 mt-3 font-display text-2xl font-bold">
        {q ? content.search.titleWithQuery(q) : content.search.title}
        {city && (
          <span className="ml-2 text-base font-normal text-muted-foreground">
            · {city.name}
          </span>
        )}
      </h1>

      {city ? (
        <SearchResults city={city} q={q} searchParams={sp} />
      ) : (
        <EmptyState>Города пока не заведены.</EmptyState>
      )}
    </main>
  );
}
