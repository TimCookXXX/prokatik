// Адреса с точками для объявлений без них: своим геокодером по подписи адреса.
//
//   pnpm geo:backfill --csv seed_real/listings.csv   строки таблицы сида с пустым lat
//   pnpm geo:backfill --db                           строки базы с address IS NULL
//
// Геокодирование — geocodeDetailed(address || location) нестрого, от центра
// города объявления: «ул. Гагарина» без пункта — та, что ближе к нему (их в
// регионе десятки). Город или округ целиком и точка дальше 40 км от центра
// считаются ненайденными: расстояние до них было бы ложным числом.
//
// --csv дописывает в таблицу address, location, lat, lon, precision. Ненайденные
// печатаются списком, код выхода 1: человек правит ячейку address (её скрипт
// берёт первой) и запускает снова. Таблицу «метка → найдено → точность»
// просматривает человек перед коммитом CSV.
//
// --db — для строк прода, которых нет в CSV (к его запуску строки сида уже
// получили адрес из таблицы, docs/DEPLOY.md). Ненайденные получают адрес
// текстом без точки (precision = city), кабинет просит их уточнить.
//
// Идемпотентен: обе выборки берут только строки без адреса. Строит движок
// геокодера целиком в своём процессе (сотни МБ), поэтому на проде — только с
// машины разработчика через SSH-туннель к Postgres, как geo:import.

import { readFile, writeFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, isNull } from "drizzle-orm";
import { Pool } from "pg";
import { cities, listings } from "../drizzle/schema";
import { parseCsv, stringifyCsv, type CsvRow } from "../src/lib/csv";
import { LISTING_COLUMNS } from "../src/lib/seed/rows";
import { createGeocoder, type Geocoder } from "../src/lib/geocoder";
import { haversineKm, type GeoPoint } from "../src/lib/geo/point";
import { listingAddressOf, type ListingAddressFields } from "../src/lib/geo/address";
import { loadGeoIndexFromDb } from "../src/server/geocoder-index";

/** Город объявления: имя для подписей, регион и центр для геокодера. */
export interface BackfillCity {
  name: string;
  region: string | null;
  centre: GeoPoint | null;
}

/** Строка отчёта: что искали, что нашли, почему нет. */
export interface BackfillLine {
  city: string;
  label: string;
  fields: ListingAddressFields | null;
  /** Что нашёл геокодер — «заголовок — подзаголовок» и км от центра города, для проверки глазами. */
  found: string | null;
  /** Почему не нашли — словами, с вариантами. */
  reason: string | null;
}

/**
 * Подпись → колонки адреса. null в `fields` — не найдено (причина в `reason`).
 * Чистая: геокодер передаётся готовым.
 */
export function geocodeListingLabel(geocoder: Geocoder, label: string, city: BackfillCity): BackfillLine {
  const line = (fields: ListingAddressFields | null, reason: string | null, found: string | null = null): BackfillLine =>
    ({ city: city.name, label, fields, found, reason });
  if (!label.trim()) return line(null, "подписи нет — заполните address");

  const res = geocoder.geocodeDetailed(label, { near: city.centre, strict: false });
  if (!res.hit) {
    const alts = res.alternatives.map((h) => `${h.title} — ${h.subtitle}`).join("; ");
    return line(null, alts ? `${res.message} (варианты: ${alts})` : res.message);
  }
  const km = city.centre ? `, ${haversineKm(res.hit, city.centre).toFixed(1)} км от центра` : "";
  const what = `${res.hit.title} — ${res.hit.subtitle}${km}`;
  const out = listingAddressOf(res.hit, city);
  if (!out.ok) {
    return line(null, out.reason === "coarse"
      ? `нашёлся город или округ целиком (${what}) — уточните улицу, ЖК или микрорайон`
      : `нашлось дальше 40 км от центра (${what})`, what);
  }
  return line(out.fields, null, what);
}

// ------------------------------------------------------------------ --csv

const blank = (v: string | undefined) => (v ?? "").trim() === "";
const coord = (x: number) => String(Math.round(x * 1e6) / 1e6);

/** Колонки таблицы на запись: порядок сида, а незнакомые — в конце, как были. */
export function csvColumns(rows: CsvRow[]): string[] {
  const present = rows.length > 0 ? Object.keys(rows[0]) : [];
  return [...LISTING_COLUMNS, ...present.filter((c) => !LISTING_COLUMNS.includes(c))];
}

/**
 * Строки таблицы сида → те же строки с адресами там, где lat пуст и у города
 * есть геоданные. Строки с точкой и города без геоданных не трогаются.
 * `geocoderFor` — движок региона; null — данных нет (строка не трогается).
 */
export function backfillCsvRows(
  rows: CsvRow[],
  citiesBySlug: ReadonlyMap<string, BackfillCity>,
  geocoderFor: (region: string) => Geocoder | null,
): { rows: CsvRow[]; lines: BackfillLine[] } {
  const lines: BackfillLine[] = [];
  const out = rows.map((row) => {
    if (!blank(row.lat)) return row;
    const city = citiesBySlug.get((row.city ?? "").trim());
    if (!city?.region) return row;
    const geocoder = geocoderFor(city.region);
    if (!geocoder) return row;

    // Ячейку address правит человек, когда подпись не находится: она главнее.
    // В отчёте видны обе — что было в location и чем его уточнили.
    const location = (row.location ?? "").trim();
    const label = blank(row.address) ? location : row.address.trim();
    const line = geocodeListingLabel(geocoder, label, city);
    lines.push(label === location || !location ? line : { ...line, label: `${location} [${label}]` });
    if (!line.fields) return row;
    const f = line.fields;
    return {
      ...row,
      address: f.address, location: f.location,
      lat: coord(f.lat!), lon: coord(f.lon!), precision: f.geoPrecision,
    };
  });
  return { rows: out, lines };
}

function citiesFromCsv(rows: CsvRow[]): Map<string, BackfillCity> {
  const num = (v: string | undefined) => (blank(v) ? null : Number(v!.replace(",", ".")));
  return new Map(rows.map((r) => {
    const lat = num(r.lat);
    const lon = num(r.lon);
    return [r.slug.trim(), {
      name: r.name.trim(),
      region: blank(r.geo_region) ? null : r.geo_region.trim(),
      centre: lat !== null && lon !== null ? { lat, lon } : null,
    }];
  }));
}

// ------------------------------------------------------------------ печать

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

/** Таблица «метка → найдено → точность» и список ненайденных. */
export function formatReport(lines: BackfillLine[]): string {
  const found = lines.filter((l) => l.fields);
  const missed = lines.filter((l) => !l.fields);
  const w = Math.min(40, Math.max(5, ...lines.map((l) => l.label.length)));
  const out = [`Найдено ${found.length} из ${lines.length}:`, ""];
  for (const l of found) {
    const f = l.fields!;
    const pub = f.location === f.address ? "" : `; публично «${f.location}»`;
    out.push(`  ${pad(l.city, 12)} ${pad(l.label, w)} → ${l.found}${pub} → ${f.geoPrecision}`);
  }
  if (missed.length > 0) {
    out.push("", `Не найдено ${missed.length}:`, "");
    for (const l of missed) out.push(`  ${pad(l.city, 12)} ${pad(l.label || "—", w)} → ${l.reason}`);
  }
  return out.join("\n");
}

// ------------------------------------------------------------------ main

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Движки по региону: строятся по разу, данные — из таблиц geo_*. */
function engines(pool: Pool) {
  const cache = new Map<string, Geocoder | null>();
  return {
    async load(regions: Iterable<string>): Promise<void> {
      for (const region of regions) {
        if (cache.has(region)) continue;
        const data = await loadGeoIndexFromDb(pool, region);
        if (!data) console.error(`Геоданных региона «${region}» нет — pnpm geo:import`);
        cache.set(region, data ? createGeocoder(data) : null);
      }
    },
    get: (region: string) => cache.get(region) ?? null,
  };
}

async function runCsv(pool: Pool, file: string): Promise<number> {
  const rows = parseCsv(await readFile(file, "utf8"));
  const citiesFile = file.replace(/listings\.csv$/, "cities.csv");
  if (citiesFile === file) die("Ожидается путь к listings.csv: cities.csv берётся рядом с ним");
  const citiesBySlug = citiesFromCsv(parseCsv(await readFile(citiesFile, "utf8")));

  const geo = engines(pool);
  await geo.load(new Set([...citiesBySlug.values()].flatMap((c) => (c.region ? [c.region] : []))));
  const { rows: next, lines } = backfillCsvRows(rows, citiesBySlug, geo.get);

  if (lines.length === 0) {
    console.log("Строк без точки в городах с геоданными нет — таблица не изменена.");
    return 0;
  }
  if (lines.some((l) => l.fields)) await writeFile(file, stringifyCsv(next, csvColumns(rows)));
  console.log(formatReport(lines));
  const missed = lines.filter((l) => !l.fields).length;
  if (missed > 0) {
    console.log(`\nПоправьте ячейку address у ненайденных в ${file} и запустите снова.`);
    return 1;
  }
  console.log(`\nЗаписано в ${file}. Просмотрите таблицу выше перед коммитом.`);
  return 0;
}

async function runDb(pool: Pool): Promise<number> {
  const db = drizzle(pool);
  const rows = await db.select({
    id: listings.id, location: listings.location,
    cityName: cities.name, region: cities.geoRegion, lat: cities.lat, lon: cities.lon,
  })
    .from(listings)
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .where(isNull(listings.address));
  if (rows.length === 0) {
    console.log("Объявлений без адреса нет.");
    return 0;
  }

  const geo = engines(pool);
  await geo.load(new Set(rows.flatMap((r) => (r.region ? [r.region] : []))));

  const lines: BackfillLine[] = [];
  for (const r of rows) {
    const city: BackfillCity = {
      name: r.cityName, region: r.region,
      centre: r.lat !== null && r.lon !== null ? { lat: r.lat, lon: r.lon } : null,
    };
    const geocoder = r.region ? geo.get(r.region) : null;
    const line = geocoder
      ? geocodeListingLabel(geocoder, r.location ?? "", city)
      : { city: r.cityName, label: r.location ?? "", fields: null, found: null, reason: "у города нет геоданных" };
    lines.push(line);
    // Не нашли — адрес текстом без точки: объявление не гаснет, а кабинет
    // просит уточнить адрес (форма без выбора из подсказок не сохранится).
    // updatedAt не двигаем: содержание объявления не менялось.
    // Пустая строка — тоже «метки нет»: адрес обязателен и пустым не бывает.
    const label = r.location?.trim() || r.cityName;
    const fields = line.fields ?? {
      address: label, location: label,
      lat: null, lon: null, geoPrecision: "city" as const,
    };
    await db.update(listings).set(fields).where(eq(listings.id, r.id));
  }
  console.log(formatReport(lines));
  return 0;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) die("DATABASE_URL is required");
  const args = process.argv.slice(2);
  const csvAt = args.indexOf("--csv");
  const mode = csvAt >= 0 ? "csv" : args.includes("--db") ? "db" : null;
  const file = csvAt >= 0 ? args[csvAt + 1] : undefined;
  if (!mode || (mode === "csv" && !file)) {
    die("Запуск: pnpm geo:backfill --csv seed_real/listings.csv | --db");
  }

  const pool = new Pool({ connectionString: url });
  try {
    process.exitCode = mode === "csv" ? await runCsv(pool, file!) : await runDb(pool);
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
