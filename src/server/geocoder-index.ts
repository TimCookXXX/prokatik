// Данные своего геокодера из БД: geo_places / geo_streets / geo_houses /
// geo_pois региона → GeoIndexData (контракт — src/lib/geocoder/types.ts).
// Таблицы пишет `pnpm geo:import` (scripts/geo-import.ts). Поисковый движок
// строится поверх этих данных в src/server/geocoder.ts, здесь только загрузка.
//
// Ключ — регион геоданных (cities.geo_region), а не город: Краснодар и
// Яблоновский читают одни и те же строки.
//
// Кэш — на globalThis: роуты /api/geo/*, страницы и server actions в
// production-сборке живут в разных бандлах, и у каждого был бы свой экземпляр
// модуля — то есть своя копия на 80 МБ. Версия (строка geo_imports региона)
// сверяется не чаще раза в VERSION_CHECK_MS; при смене данные перечитываются,
// а пока читаются — отдаются прежние.

import { createHash } from "node:crypto";
import type { ClientBase, Pool } from "pg";
import { getPool } from "@/lib/db";
import type {
  AddrPrecision, AddrSource, GeoIndexData, IndexHouse, IndexPlace, IndexPoi, IndexStreet, PlaceKind,
} from "@/lib/geocoder/types";

export const VERSION_CHECK_MS = 60_000;

/** Пул или отдельное соединение — для запросов версии и загрузки. */
type Queryable = Pick<ClientBase, "query">;

export interface GeoImportVersion {
  version: string;
  /** ISO 8601 без миллисекунд, как в файле выгрузки: «2026-09-29T23:28:19Z». */
  builtAt: string;
}

/** Время сборки из built_at (timestamptz) — в виде, в каком его пишет выгрузка. */
export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Метка данных региона: уходит в ссылку на мини-индекс (?v=) и в его ETag,
 * поэтому меняется с любым импортом. Одной версии мало: версия — даты
 * выгрузок OSM и ГАР, и пересборка из тех же выгрузок её не меняет, а
 * мини-индекс по старой ссылке кэшируется навсегда. Регион — префиксом, чтобы
 * метки разных регионов не совпали.
 */
export function geoDataToken(region: string, v: GeoImportVersion): string {
  const hash = createHash("sha1").update(`${v.version}|${v.builtAt}`).digest("base64url").slice(0, 12);
  return `${region}:${hash}`;
}

/** Последний импорт региона: версия данных и время сборки; null — импорта нет. */
export async function getGeoImportVersion(db: Queryable, region: string): Promise<GeoImportVersion | null> {
  const r = await db.query<{ version: string; built_at: Date }>(
    "select version, built_at from geo_imports where region = $1 order by id desc limit 1",
    [region],
  );
  const row = r.rows[0];
  return row ? { version: row.version, builtAt: isoSeconds(row.built_at) } : null;
}

/** Строки таблиц в порядке полей запросов loadGeoIndexWith (rowMode: array). */
export type PlaceRow = [string, string, string, string[] | null, string | null, number, number];
export type StreetRow = [
  string, string | null, string, string, string[] | null, number, number, number,
  ([number, number][][] | null)?,      // line — линия улицы
];
export type HouseRow = [string | null, string | null, string, number, number, string, string, string | null];
export type PoiRow = [string, string, string, string[] | null, string | null, number, number, string | null];

/** Строки таблиц → GeoIndexData. Чистая функция: порядок полей — как в запросах загрузки. */
export function rowsToGeoIndex(
  meta: { version: string; region: string; builtAt: string },
  places: PlaceRow[], streets: StreetRow[], houses: HouseRow[], pois: PoiRow[],
): GeoIndexData {
  return {
    version: meta.version,
    citySlug: meta.region,
    builtAt: meta.builtAt,
    places: places.map(([id, kind, name, aliases, parentId, lat, lon]): IndexPlace => ({
      id, kind: kind as PlaceKind, name, aliases: aliases ?? [], parentId, lat, lon,
    })),
    streets: streets.map(([id, placeId, name, type, aliases, lat, lon, houseCount, line]): IndexStreet => {
      const s: IndexStreet = { id, placeId, name, type, aliases: aliases ?? [], lat, lon, houses: houseCount };
      if (line && line.length) s.line = line;
      return s;
    }),
    houses: houses.map(([streetId, placeId, number, lat, lon, precision, source, postcode]): IndexHouse => {
      const h: IndexHouse = {
        streetId, placeId, number, lat, lon,
        precision: precision as AddrPrecision, source: source as AddrSource,
      };
      if (postcode) h.postcode = postcode;
      return h;
    }),
    pois: pois.map(([id, name, kind, aliases, placeId, lat, lon, address]): IndexPoi => ({
      id, name, kind, aliases: aliases ?? [], placeId, lat, lon, address,
    })),
  };
}

/**
 * Читает данные региона из таблиц; null — импорта для региона нет.
 *
 * Отдельное соединение, закрываемое сразу после загрузки: pg держит результат
 * последнего запроса соединения, пока оно живо. Через общий пул соединение с
 * домами держало бы ≈ 470 тыс. массивов строк, пока не простоит 10 с, — под
 * постоянным трафиком это +135 МБ кучи навсегда (замер SP, README движка).
 */
export async function loadGeoIndexFromDb(pool: Pool, region: string): Promise<GeoIndexData | null> {
  const client = await pool.connect();
  try {
    return await loadGeoIndexWith(client, region);
  } finally {
    client.release(true);            // true — закрыть соединение, а не вернуть в пул
  }
}

async function loadGeoIndexWith(db: Queryable, region: string): Promise<GeoIndexData | null> {
  const ver = await getGeoImportVersion(db, region);
  if (!ver) return null;
  // По одному: соединение одно, запросы всё равно идут друг за другом.
  const q = async <R>(text: string): Promise<R[]> =>
    (await db.query({ text, values: [region], rowMode: "array" })).rows as unknown as R[];
  const places = await q<PlaceRow>(
    "select id, kind, name, aliases, parent_id, lat, lon from geo_places where region = $1 order by id");
  const streets = await q<StreetRow>(
    "select id, place_id, name, type, aliases, lat, lon, houses, line from geo_streets where region = $1 order by id");
  // id домов — identity в порядке файла: так движок получает дома в том же
  // порядке, что и из JSON.
  const houses = await q<HouseRow>(
    `select street_id, place_id, number, lat, lon, precision, source, postcode
     from geo_houses where region = $1 order by id`);
  const pois = await q<PoiRow>(
    "select id, name, kind, aliases, place_id, lat, lon, address from geo_pois where region = $1 order by id");
  return rowsToGeoIndex({ version: ver.version, region, builtAt: ver.builtAt }, places, streets, houses, pois);
}

// ------------------------------------------------------------------ кэш

interface CacheEntry {
  data: GeoIndexData;
  checkedAt: number;
}

interface GeoIndexCache {
  entries: Map<string, CacheEntry>;
  loading: Map<string, Promise<GeoIndexData | null>>;
}

const G = globalThis as { __inrentaGeoIndex?: GeoIndexCache };
const store = (): GeoIndexCache => (G.__inrentaGeoIndex ??= { entries: new Map(), loading: new Map() });

/**
 * Данные геокодера региона из кэша процесса. Первая загрузка ждёт БД; дальше
 * версия сверяется раз в минуту и при смене данные перечитываются. null —
 * импорта для региона нет.
 */
export async function getGeoIndexData(region: string): Promise<GeoIndexData | null> {
  const { entries, loading } = store();
  const now = Date.now();
  const hit = entries.get(region);
  if (hit && now - hit.checkedAt < VERSION_CHECK_MS) return hit.data;

  const pending = loading.get(region);
  if (pending) return hit ? hit.data : pending;

  const task = (async () => {
    try {
      if (hit) {
        const ver = await getGeoImportVersion(getPool(), region);
        if (ver && ver.version === hit.data.version && ver.builtAt === hit.data.builtAt) {
          hit.checkedAt = Date.now();
          return hit.data;
        }
      }
      const fresh = await loadGeoIndexFromDb(getPool(), region);
      if (fresh) entries.set(region, { data: fresh, checkedAt: Date.now() });
      else entries.delete(region);
      return fresh;
    } catch (e) {
      // БД недоступна: отдаём прежние данные, если были, и пробуем снова через VERSION_CHECK_MS.
      if (hit) {
        hit.checkedAt = Date.now();
        return hit.data;
      }
      throw e;
    } finally {
      loading.delete(region);
    }
  })();
  loading.set(region, task);
  return hit ? hit.data : task;
}

/** Сброс кэша (тесты). */
export function resetGeoIndexCache(): void {
  G.__inrentaGeoIndex = { entries: new Map(), loading: new Map() };
}
