// Сид из seed_real/: три CSV (города, владельцы, объявления) и манифест
// фотографий. Наполняет базу так, чтобы сервис выглядел живым — настоящие
// тексты, цены и снимки, а не «Тестовый товар из сидов».
//
// Запуск: pnpm db:seed:real (нужен DATABASE_URL в .env, миграции применены).
// Флаги (src/lib/seed/scope.ts):
//   --dry-run          вся запись в транзакции, потом откат; отчёт — что было бы
//                      создано и обновлено, по строкам и с именами полей;
//   --owners k1,k2     только эти владельцы из users.csv и их объявления; города
//                      не пишутся, разделы заводятся лишь нужные этим объявлениям,
//                      dev-паролей нет даже вне прода.
// На живом проде — сначала --owners … --dry-run, потом то же без --dry-run
// (docs/DEPLOY.md, «Новые владельцы на живом проде»).
// Ни исходников фотографий, ни доступа к бакету не требует: адреса и размеры
// берутся из seed_real/photos.json, который пишет pnpm seed:photos. Поэтому
// скрипт одинаково работает и локально, и на сервере — кроме сверки города
// объявления с его точкой: она строит движок геокодера и идёт только вне
// прода (cityOfPointCheck).
//
// Демо-сид scripts/seed.ts ему не нужен и не мешает: дерево категорий оба
// заводят через scripts/seed-categories.ts, и каждый поднимается в одиночку.
//
// Идемпотентен: города по slug, владельцы по email, объявления по паре
// (владелец, заголовок). Повторный прогон обновляет, а не плодит копии. Слаг
// объявления при обновлении сохраняется — по нему собран адрес позиции, и
// правка заголовка не должна ломать ссылку. Объявления, исчезнувшие из CSV, не
// удаляются и не архивируются: на них могут висеть заявки и переписки.

import { drizzle } from "drizzle-orm/node-postgres";
import { TransactionRollbackError, and, eq, inArray, isNull } from "drizzle-orm";
import { Pool } from "pg";
import { users, cities, listings } from "../drizzle/schema";
import type { SeedCityOfPoint, SeedData } from "../src/lib/seed/rows";
import {
  changedFields, emptyEntityReport, formatSeedReport, parseSeedArgs, scopeSeedData, type SeedReport,
} from "../src/lib/seed/scope";
import { createGeocoder, type Geocoder } from "../src/lib/geocoder";
import { listingCityOf, storedAddressHit } from "../src/lib/geo/address";
import { loadGeoIndexFromDb } from "../src/server/geocoder-index";
import { categoryPath } from "../src/lib/seed/categories";
import { missingFromManifest, type SeedPhotoManifest } from "../src/lib/seed/photos";
import { newId } from "../src/lib/id";
import { buildPublicUrl } from "../src/lib/storage/upload";
import { DEV_SEED_PASSWORD, devSeedPassword } from "../src/lib/auth/password";
import { ensureCategories, type SeedDb } from "./seed-categories";
import { die, photoSources, readManifest, readSeedData } from "./seed-source";

interface Photo { url: string; width: number; height: number }

// -------------------------------------------------------------------- фото

/**
 * Собирает записи photos_json из манифеста. Сами файлы не читаются и не
 * трогаются: их обработали и залили в бакет отдельным шагом.
 */
function resolvePhotos(data: SeedData, manifest: SeedPhotoManifest): Map<string, Photo> {
  const sources = photoSources(data);
  if (sources.length === 0) return new Map();

  const missing = missingFromManifest(sources, manifest);
  if (missing.length > 0) {
    console.error(`В манифесте нет ${missing.length} фотографий из listings.csv:\n`);
    for (const source of missing) console.error(`  ${source}`);
    console.error("\nЗапустите pnpm seed:photos — он обработает исходники и зальёт их в бакет.");
    console.error("В базу не записано ничего.");
    process.exit(1);
  }

  if (!process.env.STORAGE_PUBLIC_BASE) {
    die("Не задан STORAGE_PUBLIC_BASE — без него не собрать адреса фотографий.\nСм. docs/environment.md");
  }
  const photos = new Map<string, Photo>();
  for (const source of sources) {
    const entry = manifest[source];
    photos.set(source, {
      url: buildPublicUrl(entry.key),
      width: entry.width,
      height: entry.height,
    });
  }
  return photos;
}

// ------------------------------------------------------------------ запись

interface WriteOptions {
  /** Режим --owners: города только читаются, разделы — лишь нужные объявлениям. */
  ownersOnly: boolean;
}

/*
 * Пишутся только поля, которые отличаются от базы (changedFields). Не ради
 * экономии запросов, а ради честной идемпотентности: без сверки updatedAt у
 * всех объявлений двигался бы при каждом прогоне, а это lastmod в sitemap —
 * поисковикам сообщалось бы, что обновилось разом вообще всё. Те же имена
 * полей уходят в отчёт: dry-run на живой базе показывает, что именно
 * поменяется, а не одно число.
 */
async function writeAll(
  db: SeedDb, data: SeedData, photos: Map<string, Photo>, opts: WriteOptions,
): Promise<Omit<SeedReport, "dryRun" | "devPasswords">> {
  const report: Omit<SeedReport, "dryRun" | "devPasswords"> = {
    ownersOnly: opts.ownersOnly,
    categories: [],
    cities: emptyEntityReport(),
    users: emptyEntityReport(),
    listings: emptyEntityReport(),
    photos: 0,
  };

  const categoryIds = await ensureCategories(db, {
    only: opts.ownersOnly
      ? new Set(data.listings.map((l) => categoryPath(l.categoryRoot, l.categoryChild)))
      : undefined,
    onCreate: (path) => report.categories.push(path),
  });

  const cityIds = new Map<string, string>();
  if (opts.ownersOnly) {
    // Города не пишутся вовсе: на живой базе их правят в админке, и прогон
    // ради одного проката не должен возвращать им значения из таблицы. Нужен
    // лишь id — и город обязан уже быть.
    const needed = new Set([
      ...data.users.flatMap((u) => (u.citySlug ? [u.citySlug] : [])),
      ...data.listings.map((l) => l.city),
    ]);
    for (const slug of needed) {
      const found = await db.select({ id: cities.id }).from(cities).where(eq(cities.slug, slug)).limit(1);
      if (found.length === 0) {
        throw new SeedAbort(`Города «${slug}» нет в базе. С --owners города не заводятся — заведите его в админке или прогоните сид без --owners.`);
      }
      cityIds.set(slug, found[0].id);
    }
  } else {
    for (const city of data.cities) {
      // lat/lon и geo_region пишутся только заполненными: пустая ячейка означает
      // «не знаю», а не «обнули». Иначе координаты и регион, проставленные в
      // админке, стирались бы каждым прогоном. Обратная сторона: регион,
      // выключенный в админке аварийно, заполненная ячейка вернёт. isActive не
      // трогаем вовсе — отключение города решение админа.
      const values = {
        name: city.name, nameLocative: city.nameLocative, region: city.region,
        ...(city.lat === null ? {} : { lat: city.lat }),
        ...(city.lon === null ? {} : { lon: city.lon }),
        ...(city.geoRegion === null ? {} : { geoRegion: city.geoRegion }),
      };
      const found = await db.select().from(cities).where(eq(cities.slug, city.slug)).limit(1);
      if (found.length > 0) {
        const fields = changedFields(found[0], values);
        if (fields.length > 0) {
          await db.update(cities).set(values).where(eq(cities.id, found[0].id));
          report.cities.updated.push({ key: city.slug, fields });
        } else report.cities.unchanged += 1;
        cityIds.set(city.slug, found[0].id);
      } else {
        const id = newId();
        await db.insert(cities).values({ id, slug: city.slug, ...values });
        cityIds.set(city.slug, id);
        report.cities.created.push(city.slug);
      }
    }
  }

  const userIds = new Map<string, string>();
  for (const user of data.users) {
    // role и passwordHash не трогаем: первую мог поменять админ, второй
    // раздаётся ниже отдельно и только тем, у кого его ещё нет.
    const values = {
      name: user.name, phone: user.phone, bio: user.bio,
      coverUrl: user.coverUrl,
      cityId: user.citySlug ? cityIds.get(user.citySlug)! : null,
      isVerified: user.isVerified,
    };
    const label = `${user.key} <${user.email}>`;
    const found = await db.select().from(users).where(eq(users.email, user.email)).limit(1);
    if (found.length > 0) {
      const current = found[0];
      // verifiedAt — штамп «проверен с такого-то числа», а не «когда прогнали
      // сид». Ставится только на переходе, иначе ехал бы вперёд каждый раз.
      const verifiedAt = user.isVerified
        ? (current.isVerified ? current.verifiedAt : new Date())
        : null;
      const next = { ...values, verifiedAt };
      const fields = changedFields(current, next);
      if (fields.length > 0) {
        await db.update(users).set(next).where(eq(users.id, current.id));
        report.users.updated.push({ key: label, fields });
      } else report.users.unchanged += 1;
      userIds.set(user.key, current.id);
    } else {
      const id = newId();
      await db.insert(users).values({
        id, email: user.email, ...values,
        verifiedAt: user.isVerified ? new Date() : null,
      });
      userIds.set(user.key, id);
      report.users.created.push(label);
    }
  }

  const cityNames = new Map(data.cities.map((c) => [c.slug, c.name]));

  for (const listing of data.listings) {
    const ownerUserId = userIds.get(listing.owner)!;
    const photosJson = listing.photos.map((source) => photos.get(source)!);
    report.photos += photosJson.length;

    const values = {
      cityId: cityIds.get(listing.city)!,
      categoryId: categoryIds.get(categoryPath(listing.categoryRoot, listing.categoryChild))!,
      title: listing.title,
      description: listing.description,
      // Адрес и точку ищет pnpm geo:backfill --csv, сид их только переносит —
      // и сравнивает наравне с прочими полями. Пустой адрес бывает лишь в
      // городе без геоданных: тогда он — подпись или сам город, как у формы,
      // где адрес такого города вводится текстом.
      location: listing.location,
      address: listing.address ?? listing.location ?? cityNames.get(listing.city)!,
      lat: listing.lat,
      lon: listing.lon,
      geoPrecision: listing.precision,
      priceDay: listing.priceDay,
      priceWeek: listing.priceWeek,
      priceMonth: listing.priceMonth,
      minDays: listing.minDays,
      depositAmount: listing.depositAmount,
      depositType: listing.depositType,
      quantity: listing.quantity,
      handoverPickup: listing.handoverPickup,
      handoverDelivery: listing.handoverDelivery,
      photosJson,
      status: listing.status,
    };
    const label = `${listing.owner} «${listing.title}»`;

    const found = await db.select().from(listings)
      .where(and(eq(listings.ownerUserId, ownerUserId), eq(listings.title, listing.title)))
      .limit(1);

    if (found.length === 0) {
      await db.insert(listings).values({ id: newId(), ownerUserId, slug: listing.slug, ...values });
      report.listings.created.push(label);
      continue;
    }

    // Объявление, погашенное баном владельца, статус из таблицы не поднимает:
    // иначе рутинный прогон сида отменял бы решение модерации, и вещь снова
    // висела бы в выдаче. Разбан вернёт её сам — на то и hidden_by_ban.
    const current = found[0];
    const next = current.hiddenByBan ? { ...values, status: current.status } : values;

    const fields = changedFields(current, next);
    if (fields.length === 0) { report.listings.unchanged += 1; continue; }
    await db.update(listings).set({ ...next, updatedAt: new Date() })
      .where(eq(listings.id, current.id));
    report.listings.updated.push({ key: label, fields });
  }

  return report;
}

/** Отказ с понятным текстом: печатается без стека, база не тронута. */
class SeedAbort extends Error {}

/**
 * Пароль владельцам — тот же механизм, что у демо-сида: вне прода и только тем,
 * у кого пароля ещё нет. Домен @seed.local сюда не зашит: ограничиваемся ровно
 * теми адресами, что перечислены в users.csv.
 */
async function grantDevPasswords(db: SeedDb, data: SeedData): Promise<number> {
  const hash = await devSeedPassword(process.env.NODE_ENV);
  if (!hash || data.users.length === 0) return 0;

  const updated = await db.update(users)
    .set({ passwordHash: hash, emailVerified: new Date() })
    .where(and(
      inArray(users.email, data.users.map((u) => u.email)),
      isNull(users.passwordHash),
    ))
    .returning({ id: users.id });
  return updated.length;
}

// ------------------------------------------------------- город по точке

/**
 * Сверка города объявления с точкой: город определяет адрес, как в форме
 * (listingCityOf по пунктам адреса из геокодера). Движок региона строится в
 * этом процессе — сотни МБ, поэтому на проде (NODE_ENV=production, сервер с
 * живым app) сверки нет: таблица приходит туда уже проверенной сидом на машине
 * разработчика. Нет импорта региона — сверять нечем, строки не трогаются.
 */
async function cityOfPointCheck(pool: Pool): Promise<SeedCityOfPoint | undefined> {
  if (process.env.NODE_ENV === "production") {
    console.log("Сверка города с точкой пропущена на проде — её делает сид на машине разработчика.");
    return undefined;
  }
  const { rows } = await pool.query<{ region: string }>("select distinct region from geo_imports");
  const engines = new Map<string, Geocoder>();
  for (const { region } of rows) {
    const data = await loadGeoIndexFromDb(pool, region);
    if (data) engines.set(region, createGeocoder(data));
  }
  return (listing, cities) => {
    const region = cities.find((c) => c.slug === listing.city)?.geoRegion;
    const g = region ? engines.get(region) : undefined;
    if (!g || listing.lat === null || listing.lon === null) return null;
    const point = { lat: listing.lat, lon: listing.lon };
    const hit = storedAddressHit(g, listing.address, point);
    const candidates = cities.flatMap((c) => (c.geoRegion === region && c.lat !== null && c.lon !== null
      ? [{ id: c.slug, name: c.name, nameLocative: c.nameLocative, centre: { lat: c.lat, lon: c.lon } }]
      : []));
    return listingCityOf(hit ? g.settlementOf(hit) : null, point, candidates)?.id ?? null;
  };
}

// -------------------------------------------------------------------- main

async function main() {
  const parsedArgs = parseSeedArgs(process.argv.slice(2));
  if (!parsedArgs.ok) die(parsedArgs.error);
  const { dryRun, owners } = parsedArgs.args;

  const url = process.env.DATABASE_URL;
  if (!url) die("DATABASE_URL is required");

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  try {
    // Таблицы проверяются целиком и с --owners: ошибка в чужой строке —
    // всё равно ошибка таблицы, которую потом прогонят без флага.
    const all = await readSeedData({ cityOfPoint: await cityOfPointCheck(pool) });
    const scoped = scopeSeedData(all, owners);
    if (!scoped.ok) die(scoped.error);
    const data = scoped.data;
    const photos = resolvePhotos(data, await readManifest());

    // Одна транзакция на всё: падение на тридцатом объявлении не должно
    // оставлять базу наполовину заполненной. Dry-run проходит её целиком — с
    // теми же запросами, ограничениями и триггерами, — и откатывает.
    let report: SeedReport | null = null;
    try {
      await db.transaction(async (tx) => {
        const written = await writeAll(tx, data, photos, { ownersOnly: owners !== null });
        // С --owners пароли не раздаются вовсе, даже вне прода: этот режим —
        // для живой базы, и забытый NODE_ENV=production не должен оставить
        // новым аккаунтам публичный dev-пароль.
        const devPasswords = owners === null ? await grantDevPasswords(tx, data) : 0;
        report = { ...written, dryRun, devPasswords };
        if (dryRun) tx.rollback();
      });
    } catch (err) {
      if (!(dryRun && err instanceof TransactionRollbackError)) throw err;
    }
    const done = report as SeedReport | null;
    if (!done) throw new Error("seed: транзакция завершилась без отчёта");

    for (const line of formatSeedReport(done)) console.log(line);
    if (done.devPasswords > 0) {
      console.log(dryRun
        ? `Владельцы получили бы dev-пароль (${done.devPasswords}): ${DEV_SEED_PASSWORD}`
        : `Владельцы получили dev-пароль (${done.devPasswords}): ${DEV_SEED_PASSWORD}`);
    }
    if (!dryRun) {
      console.log(
        `Seeded from seed_real: ${owners ? "cities untouched" : `${data.cities.length} cities`}, ` +
        `${data.users.length} owners, ${done.photos} photos; listings created ${done.listings.created.length}, ` +
        `updated ${done.listings.updated.length}, unchanged ${done.listings.unchanged}`,
      );
    }

    const withoutPhotos = data.listings.filter((l) => l.photos.length === 0).length;
    if (withoutPhotos > 0) {
      console.log(`Объявлений без фотографий: ${withoutPhotos} — колонка photos у них пустая`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  if (err instanceof SeedAbort) {
    console.error(err.message);
    console.error("В базу не записано ничего.");
  } else console.error(err);
  process.exit(1);
});
