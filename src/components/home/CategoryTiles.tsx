import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { content } from "@theme/content";
import { verticalIcon } from "./categoryIcon";

export interface CategoryTile {
  slug: string;
  name: string;
  vertical: string | null;
}

/* Строка категорий — чипы прямо на холсте, без панели и без заголовка: она
 * читается как продолжение героя, а не как отдельный раздел.
 *
 * Числа объявлений в чипах не показываем сознательно: на старте их мало, и
 * «Спорт · 2» работает против витрины. Пустые категории отсеиваются страницей —
 * чип, за которым ничего нет, обещает то, чего в городе не найти. */
export function CategoryTiles({
  citySlug,
  categories,
}: {
  citySlug: string;
  categories: CategoryTile[];
}) {
  if (categories.length === 0) return null;
  return (
    // На телефоне — одна строка с горизонтальной прокруткой, а не перенос:
    // категорий может стать больше, и перенос разворачивал их в три ряда,
    // отжимая витрину за сгиб. Отрицательные поля гасят отступ страницы — чипы
    // прокручиваются от кромки до кромки. С md — перенос внутри колонки: на
    // широком экране строка, вылезающая за край колонки, ломала линию блоков.
    //
    // Правый край гаснет маской — намёк, что строка прокручивается. Ширина
    // гашения равна концевому отступу (16px): в конце прокрутки «Все
    // категории →» стоит перед ним и читается целиком.
    <section
      aria-label={content.home.categoriesHeading}
      className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [mask-image:linear-gradient(to_left,transparent,black_16px)] [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:[mask-image:none] [&::-webkit-scrollbar]:hidden"
    >
      {categories.map((c) => {
        const Icon = verticalIcon(c.vertical);
        return (
          <Link
            key={c.slug}
            href={`/${citySlug}/${c.slug}` as never}
            className="hoverable inline-flex shrink-0 items-center gap-2.5 rounded-sm border border-border bg-card px-4 py-2.5"
          >
            <Icon className="h-[18px] w-[18px] shrink-0 text-accent" aria-hidden="true" />
            <span className="text-base font-semibold text-foreground">{c.name}</span>
          </Link>
        );
      })}
      <Link
        href={`/${citySlug}` as never}
        className="inline-flex shrink-0 items-center gap-1.5 px-2 py-2.5 text-base font-semibold text-accent hover:underline"
      >
        {content.home.categoriesAll}
        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      </Link>
    </section>
  );
}
