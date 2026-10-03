// Dev/staging seeds: тестовый город, 7 категорий, 5 юзеров-владельцев и 20 товаров.
// Идемпотентен: если город уже есть — выходит.
// Запуск: pnpm db:seed (нужен DATABASE_URL в .env, миграции применены).

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Pool } from "pg";
import {
  users, cities, categories, listings, availability,
} from "../drizzle/schema";
import { newId } from "../src/lib/id";
import { slugify } from "../src/lib/slugify";
import { addDaysStr, todayStr } from "../src/lib/catalog/dates";
import { DEV_SEED_PASSWORD, devSeedPassword } from "../src/lib/auth/password";
import { COVER_PRESETS } from "../src/lib/covers";
import { categoryPath } from "../src/lib/seed/categories";
import { ensureCategories } from "./seed-categories";

// Владельцы именно этого сида. Все выборки ниже ограничены ровно этими
// адресами, а не маской `%@seed.local`: домен делят и владельцы из seed_real
// (scripts/seed-real.ts), а они приезжают с собственными способами получения из
// таблицы. По маске демо-сид переставлял бы им флаги по формуле `i % 3` при
// каждом запуске — и «только доставка» у вещи, которую возят, молча
// превращалась бы в самовывоз.
const DEMO_OWNER_EMAILS = [1, 2, 3, 4, 5].map((i) => `owner${i}@seed.local`);

// Способ получения демо-товара по его порядковому номеру. Разнообразие тут не
// украшение: будь самовывоз у всех, чип «Самовывоз» отбирал бы вообще всё и
// выглядел бы сломанным — ровно та болезнь, из-за которой фильтр когда-то и
// отключили. Смещение на единицу разводит доставку с занятыми датами (те
// считаются от `i % 3 === 0` ниже): иначе всё с доставкой было бы ещё и занято.
// Каждый шестой остаётся без самовывоза — чтобы вариант «только доставка»
// встречался на живых страницах. Обоих флагов снятыми не бывает: i % 6 === 1
// целиком лежит внутри i % 3 === 1.
const seedHasDelivery = (i: number) => i % 3 === 1;
const seedHasPickup = (i: number) => i % 6 !== 1;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  // Пароли раздаются до проверки идемпотентности: на уже засеянной базе seed
  // выходит раньше, и владельцы остались бы без входа по паролю.
  const seedHash = await devSeedPassword(process.env.NODE_ENV);
  if (seedHash) {
    const updated = await db.update(users)
      .set({ passwordHash: seedHash, emailVerified: new Date() })
      .where(and(inArray(users.email, DEMO_OWNER_EMAILS), isNull(users.passwordHash)))
      .returning({ id: users.id });
    if (updated.length > 0) {
      console.log(`Seed owners got a dev password (${updated.length}): ${DEV_SEED_PASSWORD}`);
    }
  }

  // Способ получения — тоже до проверки идемпотентности, по той же причине:
  // колонки появились позже сидов, и на уже засеянной базе выход ниже до
  // вставки товаров не дойдёт, а фильтр «Как забрать» остался бы без данных.
  // Правило то же, что при вставке, и трогает только товары сидовых владельцев:
  // чужие объявления в dev-базе — не наше дело. NB: значения именно
  // проставляются, а не дополняются, — если владелец сида снимал доставку
  // руками, следующий запуск сида её вернёт.
  const seededListings = await db.select({ id: listings.id })
    .from(listings)
    .innerJoin(users, eq(listings.ownerUserId, users.id))
    .where(inArray(users.email, DEMO_OWNER_EMAILS))
    .orderBy(listings.createdAt, listings.id);
  for (const [pickup, delivery] of [[true, false], [true, true], [false, true]] as const) {
    const ids = seededListings
      .filter((_, i) => seedHasPickup(i) === pickup && seedHasDelivery(i) === delivery)
      .map((r) => r.id);
    if (ids.length > 0) {
      await db.update(listings)
        .set({ handoverPickup: pickup, handoverDelivery: delivery })
        .where(inArray(listings.id, ids));
    }
  }

  // Падеж доливаем до раннего выхода: на уже засеянной базе всё, что ниже, не
  // выполняется, и «в Казани» никогда бы не появилось.
  await db.update(cities)
    .set({ nameLocative: "Казани" })
    .where(and(eq(cities.slug, "kazan"), isNull(cities.nameLocative)));

  const existing = await db.select({ id: cities.id }).from(cities).where(eq(cities.slug, "kazan")).limit(1);
  if (existing.length > 0) {
    console.log("Seeds already applied (city 'kazan' exists), nothing to do");
    await pool.end();
    return;
  }

  // --- Город ---
  const cityId = newId();
  await db.insert(cities).values({
    id: cityId,
    name: "Казань",
    nameLocative: "Казани",
    slug: "kazan",
    region: "Республика Татарстан",
    lat: 55.7963,
    lon: 49.1088,
  });

  // --- Категории ---
  // Дерево общее с реальным сидом и заводится идемпотентно: оба сида могут
  // отработать на одной базе в любом порядке. См. scripts/seed-categories.ts.
  const categoryIds = await ensureCategories(db);
  const cat = (root: string, child: string) => {
    const id = categoryIds.get(categoryPath(root, child));
    if (!id) throw new Error(`Нет категории «${categoryPath(root, child)}»`);
    return id;
  };

  const powerToolsId = cat("Инструменты", "Электроинструменты");
  const gardenId = cat("Инструменты", "Садовая техника");
  const eveningId = cat("Одежда", "Вечерняя одежда");
  const weddingId = cat("Одежда", "Свадебная одежда");
  const bikesId = cat("Транспорт", "Велосипеды");
  const scootersId = cat("Транспорт", "Электросамокаты");
  const waterSportId = cat("Спорт", "Водный спорт");

  // --- Юзеры-владельцы (телефон = контакт продавца) ---
  const ownerDefs = [
    { name: "Артём", phone: "+7 900 111-22-33" },
    { name: "Роман", phone: "+7 900 222-33-44" },
    { name: "Дмитрий", phone: "+7 900 333-44-55" },
    { name: "Игорь", phone: "+7 900 444-55-66" },
    { name: "Марина", phone: "+7 900 555-66-77" },
  ];

  const ownerIds: string[] = [];
  for (let i = 0; i < ownerDefs.length; i++) {
    const def = ownerDefs[i];
    const userId = newId();
    await db.insert(users).values({
      id: userId,
      email: `owner${i + 1}@seed.local`,
      name: def.name,
      phone: def.phone,
      isVerified: i < 2, // пара «проверенных» для демо значка
      verifiedAt: i < 2 ? new Date() : null,
      // Разные обложки по кругу — витрины сидов выглядят живыми, а не пятью
      // копиями дефолта.
      coverUrl: COVER_PRESETS[i % COVER_PRESETS.length]!.url,
    });
    ownerIds.push(userId);
  }

  // --- Товары: [владелец, категория, название, цена/день, залог(₽|null), тип залога, кол-во] ---
  const listingDefs: Array<[number, string, string, number, number | null, "money" | "document" | "none", number]> = [
    [0, powerToolsId, "Перфоратор Bosch GBH 2-26", 500, 3000, "money", 3],
    [0, powerToolsId, "Шуруповёрт Makita DF333", 300, 2000, "money", 5],
    [0, powerToolsId, "Болгарка DeWalt 125 мм", 350, 2500, "money", 2],
    [0, gardenId, "Газонокосилка бензиновая Husqvarna", 900, 5000, "money", 2],
    [0, gardenId, "Триммер электрический", 400, 2000, "money", 3],
    [1, powerToolsId, "Отбойный молоток Hilti TE 500", 1200, 8000, "money", 1],
    [1, powerToolsId, "Сварочный аппарат Ресанта 190А", 600, 4000, "money", 2],
    [1, gardenId, "Мотобур со шнеками 150/200 мм", 1000, 5000, "money", 1],
    [1, powerToolsId, "Строительный пылесос Karcher", 500, 3000, "money", 2],
    [2, bikesId, "Горный велосипед Trek Marlin 7", 700, null, "document", 6],
    [2, bikesId, "Городской велосипед Forward", 450, null, "document", 8],
    [2, bikesId, "Детский велосипед 20\"", 300, null, "document", 4],
    [2, scootersId, "Электросамокат Ninebot Max", 900, 5000, "money", 5],
    [3, waterSportId, "Сапборд Aztron Mercury 10'10\"", 800, 3000, "money", 10],
    [3, waterSportId, "Сапборд двухместный 15'", 1400, 5000, "money", 2],
    [3, waterSportId, "Гидрокостюм 3 мм", 300, null, "document", 8],
    [4, eveningId, "Вечернее платье Zara, р. 42-44", 1500, 5000, "money", 1],
    [4, eveningId, "Коктейльное платье, р. 46", 1200, 4000, "money", 1],
    [4, weddingId, "Свадебное платье А-силуэт", 5000, 15000, "money", 1],
    [4, eveningId, "Платье для фотосессии со шлейфом", 2000, 6000, "money", 1],
  ];

  const listingIds: string[] = [];
  for (const [oIdx, categoryId, title, priceDay, depositAmount, depositType, quantity] of listingDefs) {
    const id = newId();
    // Демо-фото: 3 локальные картинки из public/demo/ (циклом), без внешних хостов.
    const base = listingIds.length % 6;
    const photos = [0, 1, 2].map((k) => `/demo/${((base + k) % 6) + 1}.webp`);
    const handoverDelivery = seedHasDelivery(listingIds.length);
    const handoverPickup = seedHasPickup(listingIds.length);
    listingIds.push(id);
    await db.insert(listings).values({
      id,
      ownerUserId: ownerIds[oIdx],
      cityId,
      categoryId,
      title,
      slug: slugify(title),
      description: `${title}. Тестовый товар из сидов.`,
      // У Казани геоданных нет: адрес — сам город, точки нет.
      address: "Казань",
      geoPrecision: "city",
      priceDay,
      depositAmount,
      depositType,
      quantity,
      handoverPickup,
      handoverDelivery,
      photosJson: photos.map((url) => ({ url, width: 800, height: 600 })),
      status: "active",
    });
  }

  // Демо-занятость: у каждого третьего товара заняты ближайшие дни,
  // у каждого пятого — ручное закрытие. Календари в UI сразу «живые».
  const today = todayStr();
  let availRows = 0;
  for (let i = 0; i < listingIds.length; i++) {
    const quantity = listingDefs[i][6];
    if (i % 3 === 0) {
      for (let d = 1; d <= 3; d++) {
        await db.insert(availability).values({
          listingId: listingIds[i],
          date: addDaysStr(today, d),
          bookedQty: Math.min(quantity, i % 2 === 0 ? quantity : 1), // часть — полностью занята
        });
        availRows++;
      }
    }
    if (i % 5 === 0) {
      for (let d = 7; d <= 8; d++) {
        await db.insert(availability).values({
          listingId: listingIds[i],
          date: addDaysStr(today, d),
          blockedQty: quantity, // «в ремонте» / «сдал по телефону»
        });
        availRows++;
      }
    }
  }

  // Счётчик — последний запрос, пул закрываем строго после него.
  const catCount = (await db.select({ c: sql<number>`count(*)::int` }).from(categories))[0].c;
  console.log(`Seeded: 1 city, ${catCount} categories, ${ownerDefs.length} owners, ${listingDefs.length} listings, ${availRows} availability rows`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
