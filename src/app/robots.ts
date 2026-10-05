import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-config";

export const dynamic = "force-dynamic";

/**
 * Clean-param Яндекса: параметры, которые не меняют содержимое по существу, —
 * робот склеивает такие адреса с адресом без них. Даты, «Где», вид, сортировка
 * и фильтры выдачи; метки рекламы и `_rsc` клиентской навигации Next. `page` не
 * входит — страницы пагинации различаются содержимым; `q` и `category` живут
 * только на /search, а там noindex. Google директиву игнорирует. Строка —
 * не длиннее 500 символов, параметры регистрозависимы.
 */
const CLEAN_PARAMS = [
  "from&to&qty&loc&la&src&lp&view&sort&price_min&price_max&deposit&handover&verified",
  "utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&_rsc",
] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Личные разделы анониму и так отвечают 307 на /login (middleware):
        // Disallow только экономит обход. /search, /login и /reset закрыты
        // noindex, а не здесь — запрещённую страницу робот не скачает и
        // метатег не прочитает (docs/seo.md, «robots.txt»).
        disallow: ["/admin", "/banned", "/api/", "/cabinet", "/chat", "/profile"],
        other: { "Clean-param": [...CLEAN_PARAMS] },
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
