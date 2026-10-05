import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { content } from "@theme/content";

export interface Crumb {
  label: string;
  href?: string; // последняя крошка — без ссылки
}

const t = content.breadcrumbs;

// Хлебные крошки. С md — вся цепочка. На телефоне цепочка из четырёх-пяти
// звеньев занимала две строки над заголовком, а пользуются в ней почти
// всегда одним — шагом вверх. Поэтому там одна ссылка «← {раздел}» на
// ближайшее звено со ссылкой, в рост пальца.
//
// Меняется только разметка: BreadcrumbList для поисковиков собирает страница
// из тех же items отдельно (lib/jsonld), и он остаётся полным.
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const up = items.findLast((c) => c.href);
  return (
    <nav aria-label={t.label} className="text-sm text-muted-foreground">
      {up && (
        <Link
          href={up.href as never}
          aria-label={t.up(up.label)}
          className="-ml-1 inline-flex min-h-11 max-w-full items-center gap-1.5 px-1 text-foreground md:hidden"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{up.label}</span>
        </Link>
      )}
      <ol className="hidden flex-wrap items-center gap-1 md:flex">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">/</span>}
            {c.href ? (
              <Link href={c.href as never} className="hover:text-foreground underline-offset-2 hover:underline">
                {c.label}
              </Link>
            ) : (
              <span className="text-foreground">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
