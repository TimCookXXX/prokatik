// Адреса с точками для объявлений без них: своим геокодером по подписи адреса.
//
//   pnpm geo:backfill --csv seed_real/listings.csv   строки таблицы сида с пустым lat
//   pnpm geo:backfill --db                           строки базы с address IS NULL
//   pnpm geo:backfill --csv … --relabel | --db --relabel  пересчёт подписей у строк с точкой
//
// Геокодирование — geocodeDetailed(address || location) нестрого, от центра
// города объявления: «ул. Гагарина» без пункта — та, что ближе к нему (их в
// регионе десятки). Город или округ целиком и точка дальше 40 км от центра
// считаются ненайденными: расстояние до них было бы ложным числом.
//
// Город объявления определяет найденный адрес, как в форме (listingCityOf): ЖК
// Краснодара не останется в Яблоновском, а Козет или Новая Адыгея отойдут
// ближайшему городу региона. Сменившиеся города печатаются отдельным списком.
//
// --csv дописывает в таблицу address, location, lat, lon, precision (и city,
// если адрес в другом городе). Ненайденные
// печатаются списком, код выхода 1: человек правит ячейку address (её скрипт
// берёт первой) и запускает снова. Таблицу «метка → найдено → точность»
// просматривает человек перед коммитом CSV.
//
// --db — для строк прода, которых нет в CSV (к его запуску строки сида уже
// получили адрес из таблицы, docs/DEPLOY.md). Ненайденные получают адрес
// текстом без точки (precision = city), кабинет просит их уточнить; найденные
// в другом городе переезжают в него (city_id).
//
// --relabel пересчитывает address и location у строк, где точка уже есть, по
// текущему правилу подписей (listingLabelsOf: подпись называет свой пункт).
// Точку, точность и город не трогает: хит ищется по сохранённой подписи рядом
// с точкой (той же точности, не дальше 50 м). Печатает сменившиеся подписи;
// хиты, которых не нашлось, — списком, их строки остаются как были.
//
// Идемпотентен: обе выборки берут только строки без адреса, а пересчёт по
// своей же подписи находит тот же хит. Строит движок
// геокодера целиком в своём процессе (сотни МБ), поэтому на проде — только с
// машины разработчика через SSH-туннель к Postgres, как geo:import.

import { readFile, writeFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, isNotNull, isNull } from "drizzle-orm";
import { Pool } from "pg";
import { cities, listings } from "../drizzle/schema";
import { parseCsv, stringifyCsv, type CsvRow } from "../src/lib/csv";
import { LISTING_COLUMNS } from "../src/lib/seed/rows";
import { createGeocoder, type Geocoder } from "../src/lib/geocoder";
import type { AddressHit } from "../src/lib/geocoder/types";
import { haversineKm, type GeoPoint } from "../src/lib/geo/point";
import {
  listingAddressOf, listingCityOf, listingLabelsOf, SAME_HIT_KM, type ListingAddressFields, type ListingCityCandidate,
} from "../src/lib/geo/address";
import { GEO_PRECISIONS, listingPrecision, type PointPrecision } from "../src/lib/geo/precision";
import { loadGeoIndexFromDb } from "../src/server/geocoder-index";

/** Город объявления: имя для подписей, регион и центр для геокодера. */
export interface BackfillCity {
  /** Ключ города: слаг в --csv, id в --db. */
  id: string;
  name: string;
  nameLocative?: string | null;
  region: string | null;
  centre: GeoPoint | null;
}

/** Строка отчёта: что искали, что нашли, почему нет. */
export interface BackfillLine {
  city: string;
  label: string;
  fields: ListingAddressFields | null;
  /** Город по найденному адресу, если это не город строки: объявление переезжает туда. */
  moveTo: { id: string; name: string } | null;
  /** Что нашёл геокодер — «заголовок — подзаголовок» и км от центра города, для проверки глазами. */
  found: string | null;
  /** Почему не нашли — словами, с вариантами. */
  reason: string | null;
}

/** Города региона, к которым может отойти адрес: с центром (ключ — `id` BackfillCity). */
export function regionCandidates(cities: Iterable<BackfillCity>, region: string): ListingCityCandidate[] {
  return [...cities].flatMap((c) => (c.region === region && c.centre ? [{ ...c, centre: c.centre }] : []));
}

/**
 * Подпись → колонки адреса и город по адресу. null в `fields` — не найдено
 * (причина в `reason`). Чистая: геокодер передаётся готовым. Ищется от центра
 * города строки, а город — по найденному адресу среди `regionCities`.
 */
export function geocodeListingLabel(
  geocoder: Geocoder, label: string, city: BackfillCity, regionCities: readonly ListingCityCandidate[] = [],
): BackfillLine {
  const line = (
    fields: ListingAddressFields | null, reason: string | null, found: string | null = null,
    moveTo: BackfillLine["moveTo"] = null,
  ): BackfillLine => ({ city: city.name, label, fields, moveTo, found, reason });
  if (!label.trim()) return line(null, "подписи нет — заполните address");

  const res = geocoder.geocodeDetailed(label, { near: city.centre, strict: false });
  if (!res.hit) {
    const alts = res.alternatives.map((h) => `${h.title} — ${h.subtitle}`).join("; ");
    return line(null, alts ? `${res.message} (варианты: ${alts})` : res.message);
  }
  const hit = { ...res.hit, settlement: geocoder.settlementOf(res.hit) ?? undefined };
  const target = listingCityOf(hit.settlement, hit, regionCities) ?? city;
  const km = target.centre ? `, ${haversineKm(hit, target.centre).toFixed(1)} км от центра` : "";
  const what = `${hit.title} — ${hit.subtitle}${km}`;
  const out = listingAddressOf(hit, target);
  if (!out.ok) {
    return line(null, out.reason === "coarse"
      ? `нашёлся город или округ целиком (${what}) — уточните улицу, ЖК или микрорайон`
      : `нашлось дальше 40 км от центра (${what})`, what);
  }
  return line(out.fields, null, what, target.id === city.id ? null : { id: target.id, name: target.name });
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
    const line = geocodeListingLabel(geocoder, label, city, regionCandidates(citiesBySlug.values(), city.region));
    lines.push(label === location || !location ? line : { ...line, label: `${location} [${label}]` });
    if (!line.fields) return row;
    const f = line.fields;
    return {
      ...row,
      ...(line.moveTo ? { city: line.moveTo.id } : {}),
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
    const slug = r.slug.trim();
    return [slug, {
      id: slug,
      name: r.name.trim(),
      nameLocative: r.name_locative?.trim() || null,
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
  const moved = found.filter((l) => l.moveTo);
  if (moved.length > 0) {
    out.push("", `Город по адресу другой — объявление переезжает (${moved.length}):`, "");
    for (const l of moved) out.push(`  ${pad(l.label, w)} ${l.city} → ${l.moveTo!.name}`);
  }
  return out.join("\n");
}

// ------------------------------------------------------------------ --relabel

/** Подписи адреса объявления. */
export type ListingLabels = Pick<ListingAddressFields, "address" | "location">;

/** Строка пересчёта: подписи до и после; `after` null — хит по точке не нашёлся. */
export interface RelabelLine {
  /** id объявления (--db): ненайденные правятся по нему вручную. */
  id?: string;
  city: string;
  before: ListingLabels;
  after: ListingLabels | null;
}

/** Сохранённый адрес с точкой — то, по чему пересчитываются подписи. */
export interface StoredPoint {
  address: string | null;
  location: string | null;
  point: GeoPoint;
  precision: PointPrecision;
}

/**
 * Хит сохранённого адреса: подсказки на подпись (`address`, затем `location`)
 * рядом с точкой и обратный геокодер точки — первый не дальше 50 м и той же
 * точности. Точность обязана совпасть, иначе у ЖК (`place`) по точке нашёлся
 * бы дом рядом и подпись стала бы чужой.
 */
export function storedHitAt(geocoder: Geocoder, stored: StoredPoint): AddressHit | null {
  const { point } = stored;
  const candidates = [stored.address, stored.location].flatMap((q) => (q?.trim() ? geocoder.suggest(q, { near: point, limit: 10 }) : []));
  const back = geocoder.reverse(point.lat, point.lon);
  if (back) candidates.push(back);
  return candidates.find((h) => haversineKm(h, point) <= SAME_HIT_KM && listingPrecision(h) === stored.precision) ?? null;
}

/** Подписи сохранённого адреса по текущему правилу; null — хита не нашлось. Точку и город не трогает. */
export function relabelStored(geocoder: Geocoder, stored: StoredPoint, cityName: string): ListingLabels | null {
  const hit = storedHitAt(geocoder, stored);
  if (!hit) return null;
  return listingLabelsOf({ ...hit, settlement: geocoder.settlementOf(hit) ?? undefined }, cityName);
}

const pointPrecision = (v: string | undefined): PointPrecision | null => {
  const p = (v ?? "").trim();
  return p !== "city" && (GEO_PRECISIONS as readonly string[]).includes(p) ? (p as PointPrecision) : null;
};

/**
 * Строки таблицы сида → те же строки с подписями по текущему правилу там, где
 * точка есть. Строки без точки, города без геоданных и ненайденные хиты не
 * трогаются; в `lines` — только сменившиеся и ненайденные.
 */
export function relabelCsvRows(
  rows: CsvRow[],
  citiesBySlug: ReadonlyMap<string, BackfillCity>,
  geocoderFor: (region: string) => Geocoder | null,
): { rows: CsvRow[]; lines: RelabelLine[] } {
  const lines: RelabelLine[] = [];
  const out = rows.map((row) => {
    const precision = pointPrecision(row.precision);
    if (blank(row.lat) || blank(row.lon) || !precision) return row;
    const city = citiesBySlug.get((row.city ?? "").trim());
    const geocoder = city?.region ? geocoderFor(city.region) : null;
    if (!city || !geocoder) return row;

    const before = { address: (row.address ?? "").trim(), location: (row.location ?? "").trim() };
    const after = relabelStored(geocoder, {
      ...before, point: { lat: Number(row.lat), lon: Number(row.lon) }, precision,
    }, city.name);
    if (after && after.address === before.address && after.location === before.location) return row;
    lines.push({ city: city.name, before, after });
    return after ? { ...row, ...after } : row;
  });
  return { rows: out, lines };
}

/** Различные пары «было → стало» (публичная и полная подписи — одной строкой, если совпадают) и список ненайденных. */
export function formatRelabel(lines: RelabelLine[]): string {
  const changed = lines.filter((l) => l.after);
  const missed = lines.filter((l) => !l.after);
  const pairs = new Map<string, number>();
  const add = (key: string) => pairs.set(key, (pairs.get(key) ?? 0) + 1);
  for (const { before: b, after } of changed) {
    const a = after!;
    if (b.address === b.location && a.address === a.location) {
      add(`  «${b.location}» → «${a.location}»`);
      continue;
    }
    if (b.location !== a.location) add(`  публично «${b.location}» → «${a.location}»`);
    if (b.address !== a.address) add(`  адрес    «${b.address}» → «${a.address}»`);
  }
  const out = [`Подписи сменились у ${changed.length}:`, ""];
  for (const [key, n] of pairs) out.push(n > 1 ? `${key} ×${n}` : key);
  if (missed.length > 0) {
    out.push("", `Хит по точке не нашёлся — подписи не тронуты (${missed.length}):`, "");
    for (const l of missed) out.push(`  ${l.id ? `${l.id} ` : ""}${pad(l.city, 12)} «${l.before.location}» / «${l.before.address}»`);
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

/** Таблица сида, города рядом с ней и движки их регионов. */
async function loadCsv(pool: Pool, file: string) {
  const rows = parseCsv(await readFile(file, "utf8"));
  const citiesFile = file.replace(/listings\.csv$/, "cities.csv");
  if (citiesFile === file) die("Ожидается путь к listings.csv: cities.csv берётся рядом с ним");
  const citiesBySlug = citiesFromCsv(parseCsv(await readFile(citiesFile, "utf8")));
  const geo = engines(pool);
  await geo.load(new Set([...citiesBySlug.values()].flatMap((c) => (c.region ? [c.region] : []))));
  return { rows, citiesBySlug, geo };
}

async function runCsv(pool: Pool, file: string): Promise<number> {
  const { rows, citiesBySlug, geo } = await loadCsv(pool, file);
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
  const rows = await db.select({ id: listings.id, location: listings.location, cityId: listings.cityId })
    .from(listings)
    .where(isNull(listings.address));
  if (rows.length === 0) {
    console.log("Объявлений без адреса нет.");
    return 0;
  }
  // Все города, а не только активные: строка могла остаться в выключенном.
  // Переезжает объявление только в активный — как в форме.
  const cityRows = await db.select().from(cities);
  const byId = new Map(cityRows.map((c): [string, BackfillCity] => [c.id, {
    id: c.id, name: c.name, nameLocative: c.nameLocative, region: c.geoRegion,
    centre: c.lat !== null && c.lon !== null ? { lat: c.lat, lon: c.lon } : null,
  }]));
  const active = cityRows.filter((c) => c.isActive).map((c) => byId.get(c.id)!);

  const geo = engines(pool);
  await geo.load(new Set(rows.flatMap((r) => byId.get(r.cityId)?.region ?? [])));

  const lines: BackfillLine[] = [];
  for (const r of rows) {
    const city = byId.get(r.cityId)!;
    const geocoder = city.region ? geo.get(city.region) : null;
    const line = geocoder
      ? geocodeListingLabel(geocoder, r.location ?? "", city, regionCandidates(active, city.region!))
      : { city: city.name, label: r.location ?? "", fields: null, moveTo: null, found: null, reason: "у города нет геоданных" };
    lines.push(line);
    // Не нашли — адрес текстом без точки: объявление не гаснет, а кабинет
    // просит уточнить адрес (форма без выбора из подсказок не сохранится).
    // updatedAt не двигаем: содержание объявления не менялось.
    // Пустая строка — тоже «метки нет»: адрес обязателен и пустым не бывает.
    const label = r.location?.trim() || city.name;
    const fields = line.fields ?? {
      address: label, location: label,
      lat: null, lon: null, geoPrecision: "city" as const,
    };
    await db.update(listings)
      .set({ ...fields, ...(line.moveTo ? { cityId: line.moveTo.id } : {}) })
      .where(eq(listings.id, r.id));
  }
  console.log(formatReport(lines));
  return 0;
}

async function runRelabelCsv(pool: Pool, file: string): Promise<number> {
  const { rows, citiesBySlug, geo } = await loadCsv(pool, file);
  const { rows: next, lines } = relabelCsvRows(rows, citiesBySlug, geo.get);
  if (lines.length === 0) {
    console.log("Подписи строк с точкой уже по правилу — таблица не изменена.");
    return 0;
  }
  if (lines.some((l) => l.after)) await writeFile(file, stringifyCsv(next, csvColumns(rows)));
  console.log(formatRelabel(lines));
  if (!lines.some((l) => !l.after)) return 0;
  console.log(`\nУ ненайденных допишите пункт в ячейки address и location в ${file} вручную («{имя}, {пункт}»).`);
  return 1;
}

async function runRelabelDb(pool: Pool): Promise<number> {
  const db = drizzle(pool);
  const rows = await db.select({
    id: listings.id, address: listings.address, location: listings.location,
    lat: listings.lat, lon: listings.lon, precision: listings.geoPrecision,
    cityName: cities.name, region: cities.geoRegion,
  })
    .from(listings)
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .where(isNotNull(listings.lat));
  const geo = engines(pool);
  await geo.load(new Set(rows.flatMap((r) => r.region ?? [])));

  const lines: RelabelLine[] = [];
  for (const r of rows) {
    const geocoder = r.region ? geo.get(r.region) : null;
    if (!geocoder || r.lon === null || r.precision === "city") continue;
    const before = { address: r.address ?? "", location: r.location ?? "" };
    const after = relabelStored(geocoder, { ...before, point: { lat: r.lat!, lon: r.lon }, precision: r.precision }, r.cityName);
    if (after && after.address === before.address && after.location === before.location) continue;
    lines.push({ id: r.id, city: r.cityName, before, after });
    // updatedAt не двигаем: содержание объявления не менялось.
    if (after) await db.update(listings).set(after).where(eq(listings.id, r.id));
  }
  if (lines.length === 0) {
    console.log("Подписи объявлений с точкой уже по правилу.");
    return 0;
  }
  console.log(formatRelabel(lines));
  if (!lines.some((l) => !l.after)) return 0;
  console.log("\nУ ненайденных допишите пункт в address и location вручную («{имя}, {пункт}», docs/DEPLOY.md).");
  return 1;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) die("DATABASE_URL is required");
  const args = process.argv.slice(2);
  const csvAt = args.indexOf("--csv");
  const mode = csvAt >= 0 ? "csv" : args.includes("--db") ? "db" : null;
  const file = csvAt >= 0 ? args[csvAt + 1] : undefined;
  const relabel = args.includes("--relabel");
  if (!mode || (mode === "csv" && !file)) {
    die("Запуск: pnpm geo:backfill --csv seed_real/listings.csv | --db, с --relabel — пересчёт подписей");
  }

  const pool = new Pool({ connectionString: url });
  try {
    process.exitCode = mode === "csv"
      ? await (relabel ? runRelabelCsv(pool, file!) : runCsv(pool, file!))
      : await (relabel ? runRelabelDb(pool) : runDb(pool));
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
