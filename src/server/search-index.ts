// Индекс поиска «Что» в памяти процесса app (docs/decisions/0022): объявления и
// разделы города. Сам индекс и скоринг — чистая часть в lib/search; здесь —
// сборка из БД, кэш и его свежесть.
//
// Кэш на globalThis, а не в переменной модуля: роут подсказок, страницы и
// server actions могут оказаться в разных бандлах со своей копией модуля, и
// правка в кабинете должна сбросить тот же кэш, из которого отвечает роут.
//
// Свежесть держится двумя контурами:
// 1. invalidateSearchIndex() из мутаций, меняющих состав или тексты индекса
//    (объявления, баны, разделы, города). Владелец видит свою правку сразу.
// 2. Версия набора — `count(*)` и `max(updated_at)` активных строк, сверка не
//    чаще раза в VERSION_TTL_MS. Ловит сиды и правки из других процессов.

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { categories, cities, listings, users } from "@db/schema";
import {
  buildListingIndex, type IndexCategory, type IndexListing, type ListingIndex,
} from "@/lib/search/listing-index";

export const VERSION_TTL_MS = 30_000;

/** Строка индекса: поля для скоринга и для ответа подсказок. */
export interface SearchRow extends IndexListing {
  slug: string;
  cityId: string;
  priceDay: number;
  photoUrl: string | null;
}

export interface SearchIndex {
  ix: ListingIndex<SearchRow>;
  /** Разделы по id — для пути карточки и подписи раздела в подсказке. */
  categories: ReadonlyMap<string, IndexCategory>;
  /** Слаги городов набора по id — для пути карточки. */
  citySlugs: ReadonlyMap<string, string>;
}

interface Entry {
  index: SearchIndex;
  version: string;
  checkedAt: number;
}

interface State {
  entries: Map<string, Entry>;
  pending: Map<string, Promise<Entry>>;
  /** Растёт на каждой инвалидации: сборка, начатая до неё, в кэш не попадает. */
  generation: number;
}

const G = globalThis as { __inrentaSearchIndex?: State };
const state = (): State =>
  (G.__inrentaSearchIndex ??= { entries: new Map(), pending: new Map(), generation: 0 });

/** Сбросить индексы всех городов: следующий запрос соберёт их заново. */
export function invalidateSearchIndex(): void {
  const s = state();
  s.entries.clear();
  s.pending.clear();
  s.generation += 1;
}

// Ключ — набор городов, а не один город: выдача с точкой «Где» будет идти по
// всем городам региона, и подмножества запроса и порядок должны считаться по
// всему набору сразу. Один город — ключ из одного id.
const keyOf = (cityIds: readonly string[]) => [...new Set(cityIds)].sort().join(",");

async function readVersion(cityIds: string[]): Promise<string> {
  const [row] = await getDb()
    .select({
      n: sql<number>`count(*)::int`,
      // Текстом: Date из драйвера теряет микросекунды, и две правки в одну
      // миллисекунду дали бы одну версию.
      last: sql<string | null>`max(${listings.updatedAt})::text`,
    })
    .from(listings)
    .where(and(inArray(listings.cityId, cityIds), eq(listings.status, "active")));
  return `${row?.n ?? 0}|${row?.last ?? ""}`;
}

async function build(cityIds: string[]): Promise<Entry> {
  const db = getDb();
  // Версия читается ДО строк: правка между двумя чтениями даст новую версию
  // при следующей сверке и пересборку, а не устаревший индекс со свежей меткой.
  const version = await readVersion(cityIds);
  const [rows, cats, activeCities] = await Promise.all([
    // Скрытые, архивные, забаненные и отключённые города в индекс не попадают
    // вовсе: подсказка не должна вести на карточку, которая отдаст 404.
    db.select({
      id: listings.id,
      slug: listings.slug,
      title: listings.title,
      description: listings.description,
      categoryId: listings.categoryId,
      cityId: listings.cityId,
      createdAt: listings.createdAt,
      priceDay: listings.priceDay,
      photoUrl: sql<string | null>`${listings.photosJson}->0->>'url'`,
    })
      .from(listings)
      .innerJoin(users, and(eq(users.id, listings.ownerUserId), isNull(users.bannedAt)))
      .innerJoin(cities, and(eq(cities.id, listings.cityId), eq(cities.isActive, true)))
      .where(and(inArray(listings.cityId, cityIds), eq(listings.status, "active"))),
    // Порядок по имени — как у дерева каталога: при равной оценке разделы
    // в подсказках идут в том же порядке.
    db.select({
      id: categories.id, parentId: categories.parentId, name: categories.name, slug: categories.slug,
    }).from(categories).orderBy(asc(categories.name)),
    // Названия активных городов — стоп-слова, снимаются в момент сборки:
    // переименованный или новый город становится стоп-словом после инвалидации.
    db.select({ id: cities.id, slug: cities.slug, name: cities.name, nameLocative: cities.nameLocative })
      .from(cities).where(eq(cities.isActive, true)),
  ]);

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.categoryId, (counts.get(r.categoryId) ?? 0) + 1);

  const ix = buildListingIndex<SearchRow>(
    rows, cats, counts, activeCities.flatMap((c) => [c.name, c.nameLocative]),
  );
  // Слова описания уже в словаре индекса, сам текст дальше не нужен — а это
  // самая тяжёлая часть строки.
  for (const r of rows) r.description = null;

  return {
    index: {
      ix,
      categories: new Map(cats.map((c) => [c.id, c])),
      citySlugs: new Map(activeCities.map((c) => [c.id, c.slug])),
    },
    version,
    checkedAt: Date.now(),
  };
}

async function refresh(key: string, cityIds: string[], prev: Entry | undefined): Promise<Entry> {
  const s = state();
  const generation = s.generation;
  if (prev) {
    const version = await readVersion(cityIds);
    if (version === prev.version) {
      prev.checkedAt = Date.now();
      return prev;
    }
  }
  const entry = await build(cityIds);
  if (s.generation === generation) s.entries.set(key, entry);
  return entry;
}

/**
 * Индекс набора городов. Свежий отдаётся из памяти; раз в VERSION_TTL_MS
 * сверяется версия, при расхождении индекс пересобирается. Параллельные
 * запросы ждут одну сборку.
 */
export async function getSearchIndex(cityIds: readonly string[]): Promise<SearchIndex> {
  const key = keyOf(cityIds);
  const s = state();
  const entry = s.entries.get(key);
  if (entry && Date.now() - entry.checkedAt < VERSION_TTL_MS) return entry.index;

  let pending = s.pending.get(key);
  if (!pending) {
    const p = refresh(key, key.split(","), entry);
    pending = p;
    s.pending.set(key, p);
    // Снимаем только своё обещание: после инвалидации на этом ключе может
    // ждать уже новая сборка.
    p.finally(() => { if (s.pending.get(key) === p) s.pending.delete(key); }).catch(() => {});
  }
  return (await pending).index;
}
