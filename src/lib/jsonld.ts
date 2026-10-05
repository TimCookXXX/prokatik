// Конструкторы schema.org объектов для встраивания через
// <script type="application/ld+json"> на публичных страницах каталога.
// Возвращают plain objects; сериализует вызывающий (components/seo/JsonLd).

export interface JsonLd {
  "@context": "https://schema.org";
  "@type": string;
  // Индекс намеренно `any`: schema.org-объекты имеют разную форму,
  // а потребители/тесты ходят по полям напрямую.
  [k: string]: any;
}

const stripSlash = (s: string) => s.replace(/\/$/, "");

export function buildProductJsonLd(input: {
  title: string;
  description: string | null;
  priceDay: number;
  photoUrls: string[];
  url: string;            // абсолютный URL карточки позиции
  sellerName: string;
  available: boolean;     // есть ли свободные единицы в ближайшую неделю
}): JsonLd {
  const ld: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.title,
    url: input.url,
  };
  if (input.description) ld.description = input.description;
  if (input.photoUrls.length > 0) ld.image = input.photoUrls;
  ld.offers = {
    "@type": "Offer",
    price: input.priceDay,
    priceCurrency: "RUB",
    // Аренда посуточная: цена за день, бизнес-модель LeaseOut. Голая price
    // читается как цена покупки — за что она, говорит priceSpecification:
    // unitCode DAY (код UN/CEFACT) за одни сутки.
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: input.priceDay,
      priceCurrency: "RUB",
      unitCode: "DAY",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "DAY" },
    },
    // itemCondition не ставится: поля «новое / б/у» в объявлении нет, а
    // угаданное состояние — ложь в разметке.
    businessFunction: "http://purl.org/goodrelations/v1#LeaseOut",
    availability: input.available
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock",
    url: input.url,
    seller: { "@type": "Person", name: input.sellerName },
  };
  return ld;
}

export function buildBreadcrumbJsonLd(
  items: Array<{ name: string; url?: string }>,
  siteUrl: string,
): JsonLd {
  const base = stripSlash(siteUrl);
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      ...(it.url ? { item: `${base}${it.url}` } : {}),
    })),
  };
}

/**
 * Сайт как организация — на главной. Логотип — квадратная иконка PWA: Google
 * берёт логотип не меньше 112×112, а знак со скобками в ширину для этого не
 * годится.
 */
export function buildOrganizationJsonLd(input: { name: string; siteUrl: string; email: string }): JsonLd {
  const base = stripSlash(input.siteUrl);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    url: `${base}/`,
    logo: `${base}/icons/icon-512.png`,
    email: input.email,
  };
}

/**
 * Сайт — на главной: имя сайта в выдаче. SearchAction не добавляется: Google с
 * ноября 2024 не показывает строку поиска по сайту в выдаче.
 */
export function buildWebSiteJsonLd(input: { name: string; siteUrl: string }): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: input.name,
    url: `${stripSlash(input.siteUrl)}/`,
    inLanguage: "ru",
  };
}
