// Импорт геоданных региона для своего геокодера: JSON GeoIndexData
// (src/lib/geocoder/types.ts) → таблицы geo_places, geo_streets, geo_houses,
// geo_pois и строка geo_imports.
//
// Запуск: pnpm geo:import <файл> [--region krasnodar]
// Регион по умолчанию — ключ из самого файла (поле citySlug, имя из формата
// выгрузки). Тот же регион пишется городам в cities.geo_region.
//
// Одна транзакция: удалить строки региона → вставить новые пачками → записать
// geo_imports с версией и временем сборки из файла. Пока транзакция идёт,
// сервер видит прежние данные; оборвётся — прежние и останутся. Повторный
// запуск того же файла даёт то же состояние.
//
// Строит сотни МБ в Node, поэтому на проде запускается только с машины
// разработчика через SSH-туннель к Postgres, а после него — restart app
// (docs/DEPLOY.md).

import { readFile } from "node:fs/promises";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { geoHouses, geoImports, geoPlaces, geoPois, geoStreets } from "../drizzle/schema";
import type {
  AddrPrecision, AddrSource, GeoIndexData, PlaceKind,
} from "../src/lib/geocoder/types";
import { newId } from "../src/lib/id";

type PlaceInsert = typeof geoPlaces.$inferInsert;
type StreetInsert = typeof geoStreets.$inferInsert;
type HouseInsert = typeof geoHouses.$inferInsert;
type PoiInsert = typeof geoPois.$inferInsert;

export interface GeoImportRows {
  places: PlaceInsert[];
  streets: StreetInsert[];
  houses: HouseInsert[];
  pois: PoiInsert[];
}

/** Лимит параметров одного запроса Postgres (16 бит в протоколе). */
export const MAX_PARAMS = 65535;

/** Строк в пачке: каждая колонка строки — один параметр запроса. */
export function batchSize(columns: number): number {
  return Math.floor(MAX_PARAMS / columns);
}

export const REGION_RE = /^[a-z][a-z0-9-]{1,39}$/;

const PLACE_KINDS = new Set<PlaceKind>([
  "city", "town", "village", "hamlet", "microdistrict", "snt", "district", "okrug",
]);
const PRECISIONS = new Set<AddrPrecision>(["house", "interpolated", "street", "place"]);
const SOURCES = new Set<AddrSource>(["osm", "gar", "osm+gar", "manual"]);

/**
 * Файл → строки таблиц. Чистая функция: без БД и файловой системы.
 *
 * Каждая строка несёт все колонки, в том числе пустые как null: число колонок
 * у строк одной таблицы одинаково, и размер пачки по нему считается честно.
 * Порядок домов — порядок файла: identity-ключ geo_houses его сохраняет, и
 * загрузчик читает дома так же, как их отдал бы JSON.
 */
export function geoIndexToRows(data: GeoIndexData, region: string): GeoImportRows {
  if (!REGION_RE.test(region)) {
    throw new Error(`регион «${region}» — ожидается латиница строчными, 2–40 символов`);
  }
  assertShape(data);

  const places = data.places.map((p, i): PlaceInsert => {
    if (!PLACE_KINDS.has(p.kind)) throw new Error(`places[${i}]: неизвестный вид места «${p.kind}»`);
    return {
      id: p.id, region, kind: p.kind, name: p.name, aliases: p.aliases ?? [],
      parentId: p.parentId ?? null, lat: p.lat, lon: p.lon,
    };
  });

  const streets = data.streets.map((s): StreetInsert => ({
    id: s.id, region, placeId: s.placeId ?? null, name: s.name, type: s.type ?? "",
    aliases: s.aliases ?? [], lat: s.lat, lon: s.lon, houses: s.houses,
    line: s.line && s.line.length > 0 ? s.line : null,
  }));

  const houses = data.houses.map((h, i): HouseInsert => {
    if (!PRECISIONS.has(h.precision)) throw new Error(`houses[${i}]: неизвестная точность «${h.precision}»`);
    if (!SOURCES.has(h.source)) throw new Error(`houses[${i}]: неизвестный источник «${h.source}»`);
    return {
      region, streetId: h.streetId ?? null, placeId: h.placeId ?? null, number: h.number,
      lat: h.lat, lon: h.lon, precision: h.precision, source: h.source, postcode: h.postcode ?? null,
    };
  });

  const pois = (data.pois ?? []).map((o): PoiInsert => ({
    id: o.id, region, name: o.name, kind: o.kind, aliases: o.aliases ?? [],
    placeId: o.placeId ?? null, lat: o.lat, lon: o.lon, address: o.address ?? null,
  }));

  return { places, streets, houses, pois };
}

function assertShape(data: GeoIndexData): void {
  if (!data || typeof data !== "object") throw new Error("файл не похож на GeoIndexData");
  if (typeof data.version !== "string" || data.version.length === 0 || data.version.length > 64) {
    throw new Error("version — ожидается непустая строка до 64 символов");
  }
  if (typeof data.builtAt !== "string" || Number.isNaN(Date.parse(data.builtAt))) {
    throw new Error("builtAt — ожидается момент времени ISO 8601");
  }
  for (const key of ["places", "streets", "houses"] as const) {
    if (!Array.isArray(data[key])) throw new Error(`${key} — ожидается массив`);
  }
  if (data.pois !== undefined && !Array.isArray(data.pois)) throw new Error("pois — ожидается массив");
}

// ------------------------------------------------------------------ запись

type Db = NodePgDatabase;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function insertBatches<T extends Record<string, unknown>>(
  tx: Tx, table: PgTable, rows: T[],
): Promise<void> {
  if (rows.length === 0) return;
  const size = batchSize(Object.keys(rows[0]).length);
  for (let i = 0; i < rows.length; i += size) {
    await tx.insert(table).values(rows.slice(i, i + size) as never);
  }
}

export async function importRegion(db: Db, data: GeoIndexData, region: string): Promise<Record<string, number>> {
  const rows = geoIndexToRows(data, region);
  const counts = {
    places: rows.places.length, streets: rows.streets.length,
    houses: rows.houses.length, pois: rows.pois.length,
  };
  await db.transaction(async (tx) => {
    for (const table of [geoHouses, geoPois, geoStreets, geoPlaces, geoImports]) {
      await tx.delete(table).where(eq(table.region, region));
    }
    await insertBatches(tx, geoPlaces, rows.places);
    await insertBatches(tx, geoStreets, rows.streets);
    await insertBatches(tx, geoHouses, rows.houses);
    await insertBatches(tx, geoPois, rows.pois);
    await tx.insert(geoImports).values({
      id: newId(), region, version: data.version, builtAt: new Date(data.builtAt), counts,
    });
  });
  return counts;
}

function parseArgs(argv: string[]): { file: string; region: string | null } {
  let file: string | null = null;
  let region: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--region") region = argv[++i] ?? "";
    else if (argv[i].startsWith("--region=")) region = argv[i].slice("--region=".length);
    else if (!file) file = argv[i];
  }
  if (!file) {
    console.error("Использование: pnpm geo:import <index.<регион>.json> [--region <регион>]");
    process.exit(1);
  }
  return { file, region };
}

async function main() {
  const { file, region: regionArg } = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const t0 = Date.now();
  const data = JSON.parse(await readFile(file, "utf8")) as GeoIndexData;
  const region = regionArg ?? data.citySlug;

  const pool = new Pool({ connectionString: url });
  try {
    const counts = await importRegion(drizzle(pool), data, region);
    const rssMb = Math.round(process.resourceUsage().maxRSS / 1024);
    console.log(
      `Geo import ${region}: version ${data.version}, built ${data.builtAt}; ` +
      `places ${counts.places}, streets ${counts.streets}, houses ${counts.houses}, pois ${counts.pois} ` +
      `(${((Date.now() - t0) / 1000).toFixed(1)} s, peak RSS ${rssMb} MB)`,
    );
    console.log("На проде после импорта: docker compose restart app");
  } finally {
    await pool.end();
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
