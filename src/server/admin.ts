// Read-слой админки. Доступ проверяют страницы (assertAdmin).

import { count, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import {
  bookingRequests, categories, cities, geoImports, listings, users,
} from "@db/schema";

export async function adminListListings(limit = 200) {
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
  return getDb()
    .select({
      city: cities,
      listingCount: sql<number>`(SELECT count(*)::int FROM ${listings} WHERE ${listings.cityId} = ${cities.id})`,
    })
    .from(cities)
    .orderBy(cities.name);
}

// Регионы геоданных, загруженные `pnpm geo:import`, — выбор в форме города.
export async function adminListGeoRegions(): Promise<string[]> {
  const rows = await getDb().selectDistinct({ region: geoImports.region })
    .from(geoImports)
    .orderBy(geoImports.region);
  return rows.map((r) => r.region);
}

export async function adminListCategories() {
  return getDb()
    .select({
      category: categories,
      listingCount: sql<number>`(SELECT count(*)::int FROM ${listings} WHERE ${listings.categoryId} = ${categories.id})`,
      childCount: sql<number>`(SELECT count(*)::int FROM ${categories} AS c2 WHERE c2.parent_id = ${categories.id})`,
    })
    .from(categories)
    .orderBy(categories.name);
}

export async function adminListRequests(limit = 100) {
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
  const db = getDb();
  return db
    .select({
      user: users,
      listingCount: sql<number>`(SELECT count(*)::int FROM ${listings} WHERE ${listings.ownerUserId} = ${users.id})`,
      requestCount: sql<number>`(SELECT count(*)::int FROM ${bookingRequests} WHERE ${bookingRequests.customerUserId} = ${users.id})`,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(limit);
}

export async function adminCounts() {
  const db = getDb();
  const [l, r, u] = await Promise.all([
    db.select({ c: count() }).from(listings),
    db.select({ c: count() }).from(bookingRequests),
    db.select({ c: count() }).from(users),
  ]);
  return {
    listings: Number(l[0].c),
    requests: Number(r[0].c),
    users: Number(u[0].c),
  };
}
