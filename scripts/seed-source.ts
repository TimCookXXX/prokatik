// Чтение исходников сида: три CSV и манифест фотографий. Общее для
// scripts/seed-photos.ts и scripts/seed-real.ts — оба разбирают одни и те же
// таблицы, и расхождение в разборе означало бы, что залито одно, а в базу
// поехало другое.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CsvError, parseCsv, type CsvRow } from "../src/lib/csv";
import { parseSeedData, type SeedCityOfPoint, type SeedData } from "../src/lib/seed/rows";
import {
  seedPhotoManifestSchema, type SeedPhotoManifest,
} from "../src/lib/seed/photos";

export const SRC_DIR = path.resolve("seed_real");
export const PHOTO_SRC_DIR = path.join(SRC_DIR, "Фото");
export const MANIFEST_FILE = path.join(SRC_DIR, "photos.json");

export function die(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readCsv(name: string): Promise<CsvRow[]> {
  const file = path.join(SRC_DIR, name);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return die(`Нет файла ${file}\nФормат таблиц описан в seed_real/README.md`);
  }
  try {
    return parseCsv(text);
  } catch (err) {
    if (err instanceof CsvError) return die(`${name}: ${err.message}`);
    throw err;
  }
}

/**
 * Разбирает таблицы целиком и печатает все ошибки разом, а не первую.
 * `cityOfPoint` — сверка города объявления с его точкой (scripts/seed-real.ts).
 */
export async function readSeedData(opts: { cityOfPoint?: SeedCityOfPoint } = {}): Promise<SeedData> {
  const [cities, users, listings] = await Promise.all([
    readCsv("cities.csv"), readCsv("users.csv"), readCsv("listings.csv"),
  ]);

  const parsed = parseSeedData({ cities, users, listings }, opts);
  if (!parsed.ok) {
    console.error(`Таблицы не прошли проверку (${parsed.issues.length}):\n`);
    for (const issue of parsed.issues) {
      console.error(`  ${issue.file}, строка ${issue.line}: ${issue.message}`);
    }
    console.error("\nНичего не изменено. Поправьте таблицы и запустите снова.");
    process.exit(1);
  }
  return parsed.data;
}

/** Источники фотографий в порядке первого появления — от него зависят ключи. */
export function photoSources(data: SeedData): string[] {
  return [...new Set(data.listings.flatMap((l) => l.photos))];
}

export async function readManifest(): Promise<SeedPhotoManifest> {
  const text = await readFile(MANIFEST_FILE, "utf8").catch(() => null);
  if (text === null) return {};

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return die(`${MANIFEST_FILE}: не разбирается как JSON`);
  }

  const parsed = seedPhotoManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return die(`${MANIFEST_FILE}: ${parsed.error.issues[0]?.message ?? "неверный формат"}`);
  }
  return parsed.data;
}

export async function writeManifest(manifest: SeedPhotoManifest): Promise<void> {
  // Ключи сортируются: манифест лежит в git, и порядок не должен зависеть от
  // того, в каком порядке скрипт обошёл файлы, — иначе каждый прогон давал бы
  // дифф на ровном месте.
  const sorted = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(MANIFEST_FILE, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}
