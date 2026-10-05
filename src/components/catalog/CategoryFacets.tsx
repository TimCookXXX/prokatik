// Разделы, в которых нашлось по запросу. Ссылки, а не поля формы: раздел
// применяется сразу по клику — так же, как дерево категорий в каталоге, чтобы
// внутри панели не было двух разных поведений.
//
// Ключевое отличие от дерева: эти ссылки НЕ уводят со страницы поиска, они
// сохраняют запрос и остальные фильтры и лишь сужают выдачу.

import Link from "next/link";
import { content } from "@theme/content";

export interface CategoryFacet {
  slug: string;
  name: string;
  count: number;
  href: string;
}

export function CategoryFacets({
  facets, allHref, activeSlug,
}: {
  facets: CategoryFacet[];
  /** Сброс сужения — «Все разделы». */
  allHref: string;
  activeSlug?: string;
}) {
  if (facets.length === 0) return null;

  const row = (href: string, name: string, count: number | null, active: boolean) => (
    <Link
      href={href as never}
      className={`flex items-center justify-between gap-2 rounded-sm px-3 py-1.5 text-sm [@media(pointer:coarse)]:min-h-11 transition-colors ${
        active
          ? "bg-selected text-selected-foreground"
          : "text-muted-foreground hoverable hover:text-foreground"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <span className="min-w-0 truncate">{name}</span>
      {count !== null && (
        <span className="shrink-0 font-mark text-xs text-muted-foreground">{count}</span>
      )}
    </Link>
  );

  return (
    <nav aria-label="Разделы" className="flex flex-col gap-0.5">
      {row(allHref, content.search.allCategories, null, !activeSlug)}
      {facets.map((f) => (
        <span key={f.slug}>{row(f.href, f.name, f.count, f.slug === activeSlug)}</span>
      ))}
    </nav>
  );
}
