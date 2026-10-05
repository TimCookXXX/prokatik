import { seo } from "@theme/seo";

/**
 * Общая часть Open Graph. Её задаёт корневой layout, а страница со своим
 * `openGraph` (сейчас только карточка объявления) обязана повторить её: Next
 * сливает метаданные сегментов поверхностно, и собственный `openGraph`
 * заменяет родительский целиком — без этих полей пропали бы og:site_name и
 * og:locale.
 *
 * Картинки здесь нет: картинку по умолчанию даёт файловая конвенция
 * `src/app/opengraph-image.tsx`, а Next подставляет её, только пока у сегмента
 * нет своего `openGraph.images`.
 */
export const baseOpenGraph = {
  type: "website",
  siteName: seo.siteName,
  locale: seo.locale,
} as const;
