// Уведомление поисковиков (IndexNow) о смене объявлений: создание, правка, смена
// статуса, бан и разбан владельца. Пинг уходит через after() — после ответа, и
// для мутаций в транзакции зовётся уже после коммита: иначе робот мог бы прийти
// раньше, чем изменение стало видно.
//
// Адреса берутся без фильтра по статусу: скрытую или архивную вещь тоже надо
// отправить, чтобы робот перезапросил её и увидел 404. По той же причине город
// не обязан быть активным. Чтение здесь, а не в server/catalog.ts: тот отдаёт
// только публичное.
//
// В dev и тестах (indexNowEnabled) ничего не планируется и не читается. Ошибки
// давятся: объявление уже сохранено, а пинг — лишь подсказка роботу, sitemap
// всё равно его догонит.

import { after } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { categories, cities, listings } from "@db/schema";
import { indexNowEnabled, pingIndexNow } from "@/lib/indexnow";
import { listingPath } from "@/lib/catalog/listing-path";
import { siteUrl } from "@/lib/site-config";

/** Абсолютные канонические адреса объявлений — в любом статусе. */
async function listingCanonicalUrls(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({
      citySlug: cities.slug,
      categorySlug: categories.slug,
      listingSlug: listings.slug,
      listingId: listings.id,
    })
    .from(listings)
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .where(inArray(listings.id, [...ids]));
  const base = siteUrl();
  return rows.map((r) => `${base}${listingPath(r.citySlug, r.categorySlug, r.listingSlug, r.listingId)}`);
}

/**
 * Адреса объявлений ДО записи — её зовут перед UPDATE, который может сменить
 * город или категорию, а с ними и канонический путь. Старый адрес тоже уходит в
 * пинг: робот перезапросит его и получит 308 на новый.
 */
export async function currentListingUrls(ids: readonly string[]): Promise<string[]> {
  if (!indexNowEnabled()) return [];
  try {
    return await listingCanonicalUrls(ids);
  } catch (e) {
    console.warn("[indexnow] listing urls failed:", (e as Error).message);
    return [];
  }
}

/**
 * Запланировать пинг по объявлениям: их адреса читаются уже после ответа, то
 * есть после записи. `previousUrls` — адреса до записи (currentListingUrls);
 * совпавшие с текущими отправляются один раз.
 */
export function scheduleIndexNow(listingIds: readonly string[], previousUrls: readonly string[] = []): void {
  if (!indexNowEnabled()) return;
  if (listingIds.length === 0 && previousUrls.length === 0) return;
  const ids = [...listingIds];
  const before = [...previousUrls];
  after(async () => {
    try {
      const now = await listingCanonicalUrls(ids);
      await pingIndexNow([...new Set([...before, ...now])]);
    } catch (e) {
      console.warn("[indexnow] schedule failed:", (e as Error).message);
    }
  });
}
