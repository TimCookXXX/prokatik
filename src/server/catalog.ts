// Data layer публичного каталога. Только чтение, только активные сущности.
// Все функции принимают уже разрезолвленные id (страницы резолвят слаги сами).

import { cache } from "react";

import {
  and, asc, desc, eq, getTableColumns, gte, ilike, inArray, lte, or, sql,
} from "drizzle-orm";
import { getDb } from "@/lib/db";
import { todayStr } from "@/lib/catalog/dates";
import {
  availability, bookingRequests, categories, cities, listings, users,
} from "@db/schema";

export type City = typeof cities.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Listing = typeof listings.$inferSelect;

// Публичная строка объявления — без полного адреса и точки. address может
// содержать номер дома, а по lat/lon дом находится и без номера; публично
// видна только подпись location (docs/decisions/0021). Колонки отрезаются в
// самом select, а не при рендере: что не выбрано, то не уедет ни в HTML, ни в
// RSC-payload клиентских компонентов. Полные колонки читают только кабинет
// владельца и actions.
const { address: _address, lat: _lat, lon: _lon, ...publicColumns } = getTableColumns(listings);
export const publicListingColumns = publicColumns;
export type PublicListing = Omit<Listing, "address" | "lat" | "lon">;

export interface ListingPhoto { url: string; width: number; height: number }

export function listingPhotos(listing: Pick<Listing, "photosJson">): ListingPhoto[] {
  return Array.isArray(listing.photosJson) ? (listing.photosJson as ListingPhoto[]) : [];
}

// cache(): справочник спрашивают по четыре раза за рендер публичной страницы —
// корневой layout (город для шапки), сама шапка, таб-бар и страница. Запрос
// одинаковый, в пределах одного запроса ответ тоже.
export const getActiveCities = cache(async (): Promise<City[]> => {
  return getDb().select().from(cities)
    .where(eq(cities.isActive, true))
    .orderBy(asc(cities.name));
});

// Только активный: неактивный город нигде не показывается, и выбрать его себе
// в профиль тоже нельзя.
export async function getCityById(id: string): Promise<City | null> {
  const rows = await getDb().select().from(cities)
    .where(and(eq(cities.id, id), eq(cities.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCityBySlug(slug: string): Promise<City | null> {
  const rows = await getDb().select().from(cities)
    .where(and(eq(cities.slug, slug), eq(cities.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

// Всё дерево категорий (строк мало — десятки). Сортировка по имени.
export async function getAllCategories(): Promise<Category[]> {
  return getDb().select().from(categories).orderBy(asc(categories.name));
}

// Активные позиции города, сгруппированные по category_id (прямому, без роллапа).
export async function getListingCountsByCategory(cityId: string): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({ categoryId: listings.categoryId, cnt: sql<number>`count(*)::int` })
    .from(listings)
    .where(and(eq(listings.cityId, cityId), eq(listings.status, "active")))
    .groupBy(listings.categoryId);
  return new Map(rows.map((r) => [r.categoryId, r.cnt]));
}

// Дерево категорий со счётчиками для навигации каталога. Корню достаётся
// роллап (свои позиции плюс детские), ребёнку — только его собственные.
//
// Пустые ветки отброшены: раздел без активных позиций ведёт на страницу, которая
// по правилам подкатегории отдаёт 404. Корень остаётся, если ненулевой роллап, —
// его страница показывает объединённую выдачу и живёт даже без детей.
//
// Дерево ровно два уровня: внуков не строим, потому что маршрут категории
// (/{city}/{seg}/{sub}) третьего сегмента под них не имеет.
export interface CategoryNode extends Category {
  count: number;
  children: Array<Category & { count: number }>;
}

export function buildCategoryTree(
  cats: Category[],
  direct: Map<string, number>,
): CategoryNode[] {
  const rolled = rollupToRoots(cats, direct);
  return cats
    .filter((c) => c.parentId === null)
    .map((root) => ({
      ...root,
      count: rolled.get(root.id) ?? 0,
      children: cats
        .filter((c) => c.parentId === root.id)
        .map((c) => ({ ...c, count: direct.get(c.id) ?? 0 }))
        .filter((c) => c.count > 0),
    }))
    .filter((root) => root.count > 0);
}

// Роллап прямых счётчиков на корневые категории по дереву.
export function rollupToRoots(cats: Category[], direct: Map<string, number>): Map<string, number> {
  const parentOf = new Map(cats.map((c) => [c.id, c.parentId]));
  const out = new Map<string, number>();
  for (const [catId, cnt] of direct) {
    const rootId = parentOf.get(catId) ?? catId;
    out.set(rootId, (out.get(rootId) ?? 0) + cnt);
  }
  return out;
}

// Сегмент после города — категория (слаг категории уникален глобально).
// Карточка товара живёт на 3-м сегменте и резолвится по id (getActiveListingById).
export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const rows = await getDb().select().from(categories).where(eq(categories.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export interface ListingFilters {
  priceMin?: number;
  priceMax?: number;
  deposit?: "money" | "document" | "none";
  /**
   * Способ получения. Условие включающее: `pickup` = «поддерживает самовывоз»,
   * и товар с обоими флагами попадает и в «Самовывоз», и в «Доставку».
   */
  handover?: "pickup" | "delivery";
  /** Только объявления продавцов с галочкой (users.is_verified). */
  verifiedOnly?: boolean;
  /** Диапазон дат: позиция должна быть свободна во ВСЕ дни включительно. */
  availableFrom?: string;
  availableTo?: string;
  /** Действующая сортировка (parseFilters). `relevance` работает только с ids из индекса поиска. */
  sort?: "relevance" | "price_asc" | "price_desc" | "new" | "free";
  page?: number;
  pageSize?: number;
}

// «Свободна во все дни диапазона»: ни одного дня, где занято всё количество.
// Отсутствие строки в availability = день полностью свободен, поэтому условие
// написано через NOT EXISTS, а не через подсчёт совпадений.
function freeInRange(from: string, to: string) {
  return sql`not exists (
    select 1 from ${availability}
    where ${availability.listingId} = ${listings.id}
      and ${availability.date} between ${from} and ${to}
      and ${availability.bookedQty} + ${availability.blockedQty} >= ${listings.quantity}
  )`;
}

// Условия фильтров, общие для выдачи категории и поиска. Возвращает массив,
// чтобы вызывающий дописал свои (город, статус, категории, текст запроса).
// verifiedOnly ссылается на users, поэтому join обязателен и в счётном запросе.
function filterConditions(f: ListingFilters) {
  const conds = [];
  if (f.priceMin !== undefined) conds.push(gte(listings.priceDay, f.priceMin));
  if (f.priceMax !== undefined) conds.push(lte(listings.priceDay, f.priceMax));
  if (f.deposit !== undefined) conds.push(eq(listings.depositType, f.deposit));
  if (f.handover === "pickup") conds.push(eq(listings.handoverPickup, true));
  if (f.handover === "delivery") conds.push(eq(listings.handoverDelivery, true));
  if (f.verifiedOnly) conds.push(eq(users.isVerified, true));
  if (f.availableFrom && f.availableTo) conds.push(freeInRange(f.availableFrom, f.availableTo));
  return conds;
}

// Порядок выдачи. «Сначала свободные» считает свободу по выбранному диапазону,
// а если его нет — по сегодняшнему дню: иначе сортировка спорила бы с фильтром.
//
// «Подходящие» — порядок id из индекса поиска. Массив уходит ОДНИМ параметром
// (`sql.param`): драйвер pg передаёт JS-массив как массив Postgres, а голый
// `${ids}` в шаблоне drizzle развернул бы его в `($1, $2, …)`. Без ids (поиск
// упал на ILIKE) релевантности нет — порядок как у новых.
function orderBy(f: ListingFilters, today: string, ids?: readonly string[]) {
  if (f.sort === "relevance" && ids) {
    return sql`array_position(${sql.param([...ids])}::text[], ${listings.id})`;
  }
  if (f.sort === "price_asc") return asc(listings.priceDay);
  if (f.sort === "price_desc") return desc(listings.priceDay);
  if (f.sort === "free") {
    const from = f.availableFrom ?? today;
    const to = f.availableTo ?? from;
    return desc(freeInRange(from, to));
  }
  return desc(listings.createdAt);
}

// Всё, что карточке в выдаче нужно показать, кроме занятости: её страница
// грузит отдельно, одним запросом на все карточки сразу.
export interface ListingWithOwner {
  listing: PublicListing;
  ownerName: string | null;
  ownerImage: string | null;
  /** Галочка «проверенный продавец» на плашке владельца. */
  ownerIsVerified: boolean;
  categorySlug: string;
  cityName: string;
}

// Поля продавца, города и категории одинаковы во всех выборках карточек —
// держим их одним объектом, чтобы новая колонка не появилась в трёх запросах
// из четырёх.
const CARD_COLUMNS = {
  listing: publicListingColumns,
  ownerName: users.name,
  ownerImage: users.image,
  ownerIsVerified: users.isVerified,
  categorySlug: categories.slug,
  cityName: cities.name,
} as const;

export const DEFAULT_PAGE_SIZE = 24;

// Недавно добавленные активные позиции по городу (для секции на главной).
export async function getRecentListings(cityId: string, limit = 12): Promise<ListingWithOwner[]> {
  return getDb()
    .select(CARD_COLUMNS)
    .from(listings)
    .innerJoin(users, eq(users.id, listings.ownerUserId))
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .where(and(eq(listings.cityId, cityId), eq(listings.status, "active")))
    .orderBy(desc(listings.createdAt), asc(listings.id))
    .limit(limit);
}

// Активные позиции города в наборе категорий, с продавцом для карточки.
export async function getListingsForCategories(
  cityId: string,
  categoryIds: string[],
  filters: ListingFilters = {},
): Promise<{ items: ListingWithOwner[]; total: number }> {
  if (categoryIds.length === 0) return { items: [], total: 0 };
  const db = getDb();
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);

  const where = and(
    eq(listings.cityId, cityId),
    eq(listings.status, "active"),
    inArray(listings.categoryId, categoryIds),
    ...filterConditions(filters),
  );

  const order = orderBy(filters, todayStr());

  const [items, totalRows] = await Promise.all([
    db.select(CARD_COLUMNS)
      .from(listings)
      .innerJoin(users, eq(users.id, listings.ownerUserId))
      .innerJoin(categories, eq(categories.id, listings.categoryId))
      .innerJoin(cities, eq(cities.id, listings.cityId))
      .where(where)
      .orderBy(order, asc(listings.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(listings)
      .innerJoin(users, eq(users.id, listings.ownerUserId))
      .where(where),
  ]);

  return { items, total: totalRows[0]?.cnt ?? 0 };
}

// Разбивка результатов поиска по категориям и границы цены — для панели
// фильтров на /search. Считается по запросу и прочим фильтрам, но БЕЗ фильтра
// по разделу: иначе у невыбранных разделов всегда стоял бы ноль и переключиться
// между ними было бы нельзя.
export interface SearchFacets {
  countsByCategory: Map<string, number>;
  minPriceDay: number | null;
  maxPriceDay: number | null;
}

/**
 * Чем запрос сужает выдачу /search.
 * - `ids` — совпадения из индекса поиска (src/server/search.ts) в порядке
 *   релевантности. Фильтры, даты, фасеты, счёт и страницы — по-прежнему в SQL,
 *   поверх этого набора.
 * - `text` — аварийный путь, когда индекс собрать не удалось: ILIKE по тексту.
 *   Пустой текст — без условия, весь город: /search без запроса — витрина.
 */
export type SearchMatch = { ids: readonly string[] } | { text: string };

// Условие текстового поиска — только для аварийного пути (SearchMatch.text):
// обычный поиск идёт по индексу. Пустой запрос условия не даёт вовсе.
//
// Спецсимволы ILIKE экранируются: без этого `%` в запросе означал «что угодно»,
// и `/search?q=%` отдавал весь город, выдавая это за результат поиска.
function textConditions(query: string) {
  if (query === "") return [];
  const like = `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  return [or(ilike(listings.title, like), ilike(listings.description, like))];
}

// `inArray`, а не `= ANY(${ids})`: шаблон drizzle развернул бы массив в список.
function matchConditions(match: SearchMatch) {
  return "ids" in match ? [inArray(listings.id, [...match.ids])] : textConditions(match.text.trim());
}

const noMatches = (match: SearchMatch) => "ids" in match && match.ids.length === 0;

export async function getSearchFacets(
  cityId: string,
  match: SearchMatch,
  filters: ListingFilters = {},
): Promise<SearchFacets> {
  if (noMatches(match)) return { countsByCategory: new Map(), minPriceDay: null, maxPriceDay: null };
  const base = [
    eq(listings.cityId, cityId),
    eq(listings.status, "active"),
    ...matchConditions(match),
  ];

  const db = getDb();
  const priceColumns = {
    minPrice: sql<number | null>`min(${listings.priceDay})::int`,
    maxPrice: sql<number | null>`max(${listings.priceDay})::int`,
  };

  const rowsPromise = db
    .select({ categoryId: listings.categoryId, cnt: sql<number>`count(*)::int`, ...priceColumns })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.ownerUserId))
    .where(and(...base, ...filterConditions(filters)))
    .groupBy(listings.categoryId);

  // Границы слайдера считаются БЕЗ ценового фильтра — по тому же правилу, по
  // которому счётчики разделов не учитывают выбранный раздел: фасет не сужает
  // сам себя. Иначе выбранные 100–500 ₽ схлопывали бы ручки в те же 100–500 и
  // расширить диапазон назад было бы нечем, а останься в выдаче одна цена —
  // секция цены исчезла бы вместе с фильтром.
  //
  // Отдельный запрос нужен только когда фильтр цены и правда стоит: без него
  // границы совпадают со счётчиками и берутся из того же прохода.
  const pricedFiltered = filters.priceMin !== undefined || filters.priceMax !== undefined;
  const boundsPromise = pricedFiltered
    ? db.select(priceColumns)
      .from(listings)
      .innerJoin(users, eq(users.id, listings.ownerUserId))
      .where(and(...base, ...filterConditions({
        ...filters, priceMin: undefined, priceMax: undefined,
      })))
    : null;

  const [rows, boundsRows] = await Promise.all([rowsPromise, boundsPromise]);

  // Без отдельного запроса границы собираются по группам категорий: min из
  // минимумов и max из максимумов дают то же, что один агрегат по всей выдаче.
  const prices = (boundsRows ?? rows)
    .flatMap((r) => [r.minPrice, r.maxPrice])
    .filter((v): v is number => v !== null);

  return {
    countsByCategory: new Map(rows.map((r) => [r.categoryId, r.cnt])),
    minPriceDay: prices.length ? Math.min(...prices) : null,
    maxPriceDay: prices.length ? Math.max(...prices) : null,
  };
}

// Выдача города с поиском. Пустой запрос — не пустой ответ, а весь город:
// /search без `q` работает витриной, а запрос лишь сужает её. Отличие от
// getListingsForCategories ровно в двух вещах: здесь есть условие запроса
// (SearchMatch), а раздел необязателен.
export async function searchListings(
  cityId: string,
  match: SearchMatch,
  filters: ListingFilters = {},
  /** Сужение по разделу. В каталоге раздел задаёт страница, здесь — фильтр. */
  categoryIds?: string[],
): Promise<{ items: ListingWithOwner[]; total: number }> {
  if (noMatches(match)) return { items: [], total: 0 };
  const db = getDb();
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);

  const where = and(
    eq(listings.cityId, cityId),
    eq(listings.status, "active"),
    ...matchConditions(match),
    ...(categoryIds && categoryIds.length > 0 ? [inArray(listings.categoryId, categoryIds)] : []),
    ...filterConditions(filters),
  );

  const order = orderBy(filters, todayStr(), "ids" in match ? match.ids : undefined);

  const [items, totalRows] = await Promise.all([
    db.select(CARD_COLUMNS)
      .from(listings)
      .innerJoin(users, eq(users.id, listings.ownerUserId))
      .innerJoin(categories, eq(categories.id, listings.categoryId))
      .innerJoin(cities, eq(cities.id, listings.cityId))
      .where(where)
      .orderBy(order, asc(listings.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(listings)
      .innerJoin(users, eq(users.id, listings.ownerUserId))
      .where(where),
  ]);

  return { items, total: totalRows[0]?.cnt ?? 0 };
}

export interface CategoryStats {
  listingCount: number;
  ownerCount: number;
  minPriceDay: number | null;
  maxPriceDay: number | null;
  avgDeposit: number | null;
}

// Статистика для вводного SEO-блока категории — только из данных, без шаблонных простыней.
export async function getCategoryStats(cityId: string, categoryIds: string[]): Promise<CategoryStats> {
  if (categoryIds.length === 0) {
    return { listingCount: 0, ownerCount: 0, minPriceDay: null, maxPriceDay: null, avgDeposit: null };
  }
  const rows = await getDb()
    .select({
      listingCount: sql<number>`count(*)::int`,
      ownerCount: sql<number>`count(distinct ${listings.ownerUserId})::int`,
      minPriceDay: sql<number | null>`min(${listings.priceDay})::int`,
      maxPriceDay: sql<number | null>`max(${listings.priceDay})::int`,
      avgDeposit: sql<number | null>`round(avg(${listings.depositAmount}))::int`,
    })
    .from(listings)
    .where(and(
      eq(listings.cityId, cityId),
      eq(listings.status, "active"),
      inArray(listings.categoryId, categoryIds),
    ));
  return rows[0];
}

// Активные товары продавца — для профиля /u/{id}.
export async function getActiveListingsByOwner(userId: string): Promise<PublicListing[]> {
  return getDb().select(publicListingColumns).from(listings)
    .where(and(eq(listings.ownerUserId, userId), eq(listings.status, "active")))
    .orderBy(desc(listings.createdAt));
}

// Карточка товара резолвится по id (из хвоста URL /{city}/{cat}/{slug}-{id}).
export async function getActiveListingById(id: string): Promise<PublicListing | null> {
  const rows = await getDb().select(publicListingColumns).from(listings)
    .where(and(eq(listings.id, id), eq(listings.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

export interface Seller {
  id: string;
  name: string | null;
  image: string | null;
  coverUrl: string | null;
  bio: string | null;
  isVerified: boolean;
  createdAt: Date;
  phone: string | null;
  /** Витрина забаненного продавца закрыта — страница отдаёт 404. */
  bannedAt: Date | null;
}

// Публичные поля продавца — для страницы товара и профиля /u/{id}.
export async function getSellerById(userId: string): Promise<Seller | null> {
  const rows = await getDb().select({
    id: users.id, name: users.name,
    image: users.image, coverUrl: users.coverUrl, bio: users.bio,
    isVerified: users.isVerified,
    createdAt: users.createdAt, phone: users.phone,
    bannedAt: users.bannedAt,
  }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

export interface SellerStats {
  /** Состоявшиеся аренды по обе стороны сделки. */
  deals: number;
  /** Свой город из профиля; без него — город активных объявлений, если он один. */
  cityName: string | null;
}

/* Подпись под именем на витрине продавца. Город берём тот, что человек указал
 * о себе, — это его город, а не место, где случайно лежит вещь. Не указал —
 * догадываемся по активным объявлениям, но только пока они все в одном городе:
 * у сдающего в разных сегмент честнее опустить, чем выбирать за него. */
export async function getSellerStats(userId: string): Promise<SellerStats> {
  const db = getDb();
  const [ownRows, dealRows, cityRows] = await Promise.all([
    // Отключённый город не показываем: его страниц нет, и в подписи он был бы
    // ссылкой в никуда.
    db
      .select({ name: cities.name })
      .from(users)
      .innerJoin(cities, and(eq(cities.id, users.cityId), eq(cities.isActive, true)))
      .where(eq(users.id, userId))
      .limit(1),
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(bookingRequests)
      .where(and(
        or(
          eq(bookingRequests.ownerUserId, userId),
          eq(bookingRequests.customerUserId, userId),
        ),
        eq(bookingRequests.status, "completed"),
      )),
    db
      .selectDistinct({ name: cities.name })
      .from(listings)
      .innerJoin(cities, eq(cities.id, listings.cityId))
      .where(and(eq(listings.ownerUserId, userId), eq(listings.status, "active")))
      .limit(2),
  ]);

  return {
    deals: dealRows[0]?.cnt ?? 0,
    cityName: ownRows[0]?.name ?? (cityRows.length === 1 ? cityRows[0]!.name : null),
  };
}

// Карточка товара с городом — товары продавца могут быть в разных городах,
// поэтому citySlug нужен на каждую карточку (для её href).
export interface OwnerCardListing extends ListingWithOwner {
  citySlug: string;
}

// Активные товары продавца в форме карточки — для профиля /u/{id}.
export async function getActiveListingCardsByOwner(userId: string): Promise<OwnerCardListing[]> {
  return getDb()
    .select({ ...CARD_COLUMNS, citySlug: cities.slug })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.ownerUserId))
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .where(and(eq(listings.ownerUserId, userId), eq(listings.status, "active")))
    .orderBy(desc(listings.createdAt));
}

export async function getCategoryById(id: string): Promise<Category | null> {
  const rows = await getDb().select().from(categories).where(eq(categories.id, id)).limit(1);
  return rows[0] ?? null;
}

// Все активные позиции с полным путём слагов — для sitemap.
// URL: /{citySlug}/{categorySlug}/{listingSlug}-{listingId}/.
export async function getAllActiveListingPaths(): Promise<
  Array<{ citySlug: string; categorySlug: string; listingSlug: string; listingId: string; updatedAt: Date }>
> {
  return getDb()
    .select({
      citySlug: cities.slug,
      categorySlug: categories.slug,
      listingSlug: listings.slug,
      listingId: listings.id,
      updatedAt: listings.updatedAt,
    })
    .from(listings)
    .innerJoin(cities, and(eq(cities.id, listings.cityId), eq(cities.isActive, true)))
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .where(eq(listings.status, "active"));
}

export interface AvailabilityRow {
  listingId: string;
  date: string;
  bookedQty: number;
  blockedQty: number;
}

/**
 * Какие из позиций свободны во все дни диапазона — тем же условием, что фильтр
 * дат в выдаче (freeInRange), одним запросом. Для подсказок «Что» при выбранных
 * датах: они не должны вести на карточку, где виджет сразу скажет «Занято».
 */
export async function getFreeListingIds(
  listingIds: readonly string[],
  dateFrom: string,
  dateTo: string,
): Promise<Set<string>> {
  if (listingIds.length === 0) return new Set();
  const rows = await getDb()
    .select({ id: listings.id })
    .from(listings)
    .where(and(inArray(listings.id, [...listingIds]), freeInRange(dateFrom, dateTo)));
  return new Set(rows.map((r) => r.id));
}

// Занятость набора позиций на диапазон дат (для мини-календарей листинга — одним запросом).
export async function getAvailabilityRows(
  listingIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<AvailabilityRow[]> {
  if (listingIds.length === 0) return [];
  return getDb()
    .select({
      listingId: availability.listingId,
      date: availability.date,
      bookedQty: availability.bookedQty,
      blockedQty: availability.blockedQty,
    })
    .from(availability)
    .where(and(
      inArray(availability.listingId, listingIds),
      gte(availability.date, dateFrom),
      lte(availability.date, dateTo),
    ));
}
