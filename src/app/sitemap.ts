import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-config";
import {
  getActiveCities, getAllActiveListingPaths, getAllCategories,
  getListingCountsByCategory, rollupToRoots,
} from "@/server/catalog";
import { categoryPath, listingPath } from "@/lib/catalog/listing-path";

// Sitemap читает БД в рантайме; force-dynamic — иначе Next prerender'ит
// во время build без БД и падает.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const out: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1.0 },
  ];

  const [citiesList, cats] = await Promise.all([getActiveCities(), getAllCategories()]);

  for (const city of citiesList) {
    const direct = await getListingCountsByCategory([city.id]);
    // Город без объявлений живёт (на него ведёт селектор), но с noindex — в
    // sitemap ему не место, как и его пустым разделам.
    if ([...direct.values()].every((n) => n === 0)) continue;
    out.push({ url: `${base}/${city.slug}`, changeFrequency: "daily", priority: 0.9 });

    const rootCounts = rollupToRoots(cats, direct);

    // Корневые категории — главные SEO-страницы; пустые в sitemap не попадают.
    for (const cat of cats.filter((c) => c.parentId === null)) {
      if ((rootCounts.get(cat.id) ?? 0) === 0) continue;
      out.push({
        url: `${base}${categoryPath(city.slug, cat)}`,
        changeFrequency: "daily",
        priority: 0.8,
      });
    }

    // Подкатегории существуют только с ≥1 активной позицией.
    for (const sub of cats.filter((c) => c.parentId !== null)) {
      if ((direct.get(sub.id) ?? 0) === 0) continue;
      const root = cats.find((c) => c.id === sub.parentId);
      if (!root) continue;
      out.push({
        url: `${base}${categoryPath(city.slug, sub, root)}`,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  }

  for (const l of await getAllActiveListingPaths()) {
    out.push({
      url: `${base}${listingPath(l.citySlug, l.categorySlug, l.listingSlug, l.listingId)}`,
      lastModified: l.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  return out;
}
