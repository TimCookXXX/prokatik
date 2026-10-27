// Read-слой админки. Роль проверяет каждое чтение само (assertAdmin): проверка
// в layout'е не гарантия — Next не перерисовывает его при переходах внутри
// сегмента (см. src/lib/auth/guard.ts).
//
// Таблицы в подзапросах полей — явными именами и псевдонимами: в полях select
// без join drizzle пишет колонки без таблицы, и ${users.id} внутри
// подзапроса по listings превратился бы в "id" самих listings — счётчик
// молча показывал бы ноль.

import { and, count, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { assertAdmin } from "@/lib/auth/assert-admin";
import {
  bookingLeads, bookingRequests, categories, cities, geoImports, listings, users,
} from "@db/schema";

export async function adminListListings(limit = 200) {
  await assertAdmin();
  return getDb()
    .select({
      listing: listings,
      ownerName: users.name,
      citySlug: cities.slug,
      categorySlug: categories.slug,
    })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.ownerUserId))
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .orderBy(desc(listings.createdAt))
    .limit(limit);
}

export async function adminListCities() {
  await assertAdmin();
  return getDb()
    .select({
      city: cities,
      listingCount: sql<number>`(SELECT count(*)::int FROM listings l WHERE l.city_id = cities.id)`,
    })
    .from(cities)
    .orderBy(cities.name);
}

// Регионы геоданных, загруженные `pnpm geo:import`, — выбор в форме города.
export async function adminListGeoRegions(): Promise<string[]> {
  await assertAdmin();
  const rows = await getDb().selectDistinct({ region: geoImports.region })
    .from(geoImports)
    .orderBy(geoImports.region);
  return rows.map((r) => r.region);
}

export async function adminListCategories() {
  await assertAdmin();
  return getDb()
    .select({
      category: categories,
      listingCount: sql<number>`(SELECT count(*)::int FROM listings l WHERE l.category_id = categories.id)`,
      childCount: sql<number>`(SELECT count(*)::int FROM categories c2 WHERE c2.parent_id = categories.id)`,
    })
    .from(categories)
    .orderBy(categories.name);
}

export async function adminListRequests(limit = 100) {
  await assertAdmin();
  const owner = alias(users, "owner");
  return getDb()
    .select({
      request: bookingRequests,
      listingTitle: listings.title,
      ownerName: owner.name,
      customerEmail: users.email,
    })
    .from(bookingRequests)
    .innerJoin(listings, eq(listings.id, bookingRequests.listingId))
    .innerJoin(owner, eq(owner.id, bookingRequests.ownerUserId))
    .innerJoin(users, eq(users.id, bookingRequests.customerUserId))
    .orderBy(desc(bookingRequests.createdAt))
    .limit(limit);
}

export async function adminListUsers(limit = 200) {
  await assertAdmin();
  const db = getDb();
  return db
    .select({
      user: users,
      listingCount: sql<number>`(SELECT count(*)::int FROM listings l WHERE l.owner_user_id = users.id)`,
      requestCount: sql<number>`(SELECT count(*)::int FROM booking_requests br WHERE br.customer_user_id = users.id)`,
      // Браузеры своей статистики, записанные за аккаунтом, — ссылка «Устройства».
      deviceCount: sql<number>`(SELECT count(*)::int FROM visitors v WHERE v.user_id = users.id)`,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(limit);
}

export async function adminCounts() {
  await assertAdmin();
  const db = getDb();
  const [l, r, u, p] = await Promise.all([
    db.select({ c: count() }).from(listings),
    db.select({ c: count() }).from(bookingRequests),
    db.select({ c: count() }).from(users),
    // Заявки без аккаунта, которые ещё не передали прокату (ADR 0028).
    db.select({ c: count() }).from(bookingLeads)
      .where(and(eq(bookingLeads.status, "sent"), eq(bookingLeads.internal, false))),
  ]);
  return {
    listings: Number(l[0].c),
    requests: Number(r[0].c),
    users: Number(u[0].c),
    leadsPending: Number(p[0].c),
  };
}
