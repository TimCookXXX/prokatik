// Приведение ячеек CSV к значениям колонок БД. Чистая часть сида: без Postgres
// и без файловой системы, поэтому проверяется тестами напрямую.
//
// Ошибки копятся, а не бросаются на первой: человек правит таблицу в Numbers, и
// список «строка 14: цена не число, строка 31: нет такой категории» экономит ему
// десять прогонов. Скрипт печатает список целиком и не пишет в базу ничего.
//
// Русские подписи принимаются наравне с кодами («Деньги» = money): seed_real
// заполняет человек, а не программа, и заставлять его печатать латиницей там,
// где вся остальная таблица на русском, — лишний повод ошибиться.

import { z } from "zod";
import type { CsvRow } from "@/lib/csv";
import { COVER_PRESETS } from "@/lib/covers";
import type { GeoPrecision } from "@/lib/geo/precision";
import { slugify } from "@/lib/slugify";
import { allCategoryPaths, hasCategoryPath, parseCategoryPath } from "./categories";

export type SeedDepositType = "money" | "document" | "none";
export type SeedStatus = "active" | "hidden" | "archived";

export interface SeedCityRow {
  slug: string;
  name: string;
  nameLocative: string;
  region: string | null;
  lat: number | null;
  lon: number | null;
  /** Регион геоданных (cities.geo_region): ключ импорта `pnpm geo:import`. */
  geoRegion: string | null;
}

export interface SeedUserRow {
  key: string;
  email: string;
  name: string;
  phone: string | null;
  citySlug: string | null;
  bio: string | null;
  coverUrl: string | null;
  isVerified: boolean;
}

export interface SeedListingRow {
  owner: string;
  city: string;
  categoryRoot: string;
  categoryChild: string;
  title: string;
  slug: string;
  description: string | null;
  /** Публичная подпись адреса — без номера дома (listings.location). */
  location: string | null;
  /** Полный адрес, видит только владелец; пусто — город без геоданных. */
  address: string | null;
  /** Точка — парой; пусто — точки нет, и тогда precision = city. */
  lat: number | null;
  lon: number | null;
  precision: GeoPrecision;
  priceDay: number;
  depositType: SeedDepositType;
  depositAmount: number | null;
  quantity: number;
  handoverPickup: boolean;
  handoverDelivery: boolean;
  status: SeedStatus;
  photos: string[];
}

export interface SeedData {
  cities: SeedCityRow[];
  users: SeedUserRow[];
  listings: SeedListingRow[];
}

export interface SeedIssue {
  file: string;
  /** Номер строки в файле: шапка — первая, поэтому данные начинаются со второй. */
  line: number;
  message: string;
}

export const CITY_COLUMNS = ["slug", "name", "name_locative", "region", "lat", "lon", "geo_region"];
export const USER_COLUMNS = ["key", "email", "name", "phone", "city_slug", "bio", "cover", "is_verified"];
// address, lat, lon и precision заполняет pnpm geo:backfill --csv: точки
// руками никто не ищет, человек правит только ячейку address, если адрес не
// нашёлся.
export const LISTING_COLUMNS = [
  "owner", "city", "category", "title", "description", "location",
  "address", "lat", "lon", "precision", "price_day",
  "deposit_type", "deposit_amount", "quantity", "handover", "status", "photos",
];

/** Держится синхронно с формой объявления — src/lib/owner/validation.ts. */
const MAX_PHOTOS = 10;

// ---------------------------------------------------------------- скаляры

const blank = (v: string | undefined) => (v ?? "").trim() === "";
const orNull = (v: string | undefined) => (blank(v) ? null : (v as string).trim());

const DEPOSIT: Record<string, SeedDepositType> = {
  money: "money", document: "document", none: "none",
  "деньги": "money", "документ": "document", "нет": "none",
};

const STATUS: Record<string, SeedStatus> = {
  active: "active", hidden: "hidden", archived: "archived",
  "активно": "active", "скрыто": "hidden", "архив": "archived", "в архиве": "archived",
};

const PRECISION: Record<string, GeoPrecision> = {
  house: "house", street: "street", place: "place", city: "city",
  "дом": "house", "улица": "street", "пункт": "place", "город": "city",
};

const TRUE = new Set(["yes", "да", "true", "1", "+"]);
const FALSE = new Set(["", "no", "нет", "false", "0", "-"]);

function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  return null;
}

/** `pickup;delivery`, `Самовывоз, Доставка` — разделитель любой из `;` и `,`. */
export function parseHandover(raw: string): { pickup: boolean; delivery: boolean } | null {
  const parts = raw.toLowerCase().split(/[;,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  let pickup = false;
  let delivery = false;
  for (const part of parts) {
    if (part === "pickup" || part === "самовывоз") pickup = true;
    else if (part === "delivery" || part === "доставка") delivery = true;
    else return null;
  }
  return pickup || delivery ? { pickup, delivery } : null;
}

/** Имена файлов через `;`. Первое станет обложкой. */
export function parsePhotos(raw: string): string[] {
  return raw.split(";").map((p) => p.trim()).filter(Boolean);
}

function parseIntCell(raw: string): number | null {
  if (!/^-?\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

function parseFloatCell(raw: string): number | null {
  const v = raw.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}

function coverUrlFor(slug: string): string | null | undefined {
  if (blank(slug)) return null;
  return COVER_PRESETS.find((p) => p.slug === slug.trim())?.url;
}

// ------------------------------------------------------------------ zod
// zod держит длины и обязательность — то же, что колонки в drizzle/schema.ts.
// Всё, что сложнее (перечисления с русскими синонимами, пути категорий), —
// ниже руками: сообщение «нет такой категории, вот список» полезнее, чем
// сгенерированный enum на тридцать значений.

const cityShape = z.object({
  slug: z.string().min(1, "slug пустой").max(80, "slug длиннее 80 символов"),
  name: z.string().min(1, "name пустой").max(100, "name длиннее 100 символов"),
  name_locative: z.string().min(1, "name_locative пустой — без него заголовок каталога соберётся без предлога")
    .max(100, "name_locative длиннее 100 символов"),
  region: z.string().max(100, "region длиннее 100 символов"),
  // Формат — как у ключа импорта (scripts/geo-import.ts, REGION_RE).
  geo_region: z.string().regex(/^([a-z][a-z0-9-]{1,39})?$/,
    "geo_region — ключ региона геоданных латиницей строчными, как в pnpm geo:import --region"),
});

const userShape = z.object({
  key: z.string().min(1, "key пустой"),
  email: z.string().email("email не похож на почту").max(255, "email длиннее 255 символов"),
  name: z.string().min(1, "name пустой").max(100, "name длиннее 100 символов"),
  phone: z.string().max(20, "phone длиннее 20 символов"),
});

const listingShape = z.object({
  title: z.string().min(1, "title пустой").max(200, "title длиннее 200 символов"),
  // Те же длины, что у колонок и формы объявления.
  location: z.string().max(120, "location длиннее 120 символов"),
  address: z.string().max(200, "address длиннее 200 символов"),
});

// ----------------------------------------------------------------- строки

function firstZodMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? "не прошло проверку";
}

function parseCityRow(row: CsvRow, push: (m: string) => void): SeedCityRow | null {
  const shape = cityShape.safeParse({
    slug: row.slug ?? "", name: row.name ?? "",
    name_locative: row.name_locative ?? "", region: row.region ?? "",
    geo_region: (row.geo_region ?? "").trim(),
  });
  if (!shape.success) { push(firstZodMessage(shape.error)); return null; }

  const slug = shape.data.slug;
  if (slugify(slug) !== slug) {
    push(`slug «${slug}» не годится для адреса — ожидается латиница строчными через дефис`);
    return null;
  }

  let lat: number | null = null;
  let lon: number | null = null;
  if (!blank(row.lat)) {
    lat = parseFloatCell(row.lat);
    if (lat === null) { push("lat не число"); return null; }
  }
  if (!blank(row.lon)) {
    lon = parseFloatCell(row.lon);
    if (lon === null) { push("lon не число"); return null; }
  }
  // Центр города — точка, а не половина точки.
  if ((lat === null) !== (lon === null)) { push("lat и lon заполняются парой"); return null; }
  if (lat !== null && Math.abs(lat) > 90) { push("lat вне диапазона −90…90"); return null; }
  if (lon !== null && Math.abs(lon) > 180) { push("lon вне диапазона −180…180"); return null; }

  const geoRegion = orNull(shape.data.geo_region);
  // От центра ранжируются подсказки адресов: без него в пригороде они уезжали
  // бы к самому крупному городу региона.
  if (geoRegion && lat === null) {
    push("geo_region без lat/lon — у города с геоданными нужен центр");
    return null;
  }

  return {
    slug, name: shape.data.name, nameLocative: shape.data.name_locative,
    region: orNull(row.region), lat, lon, geoRegion,
  };
}

function parseUserRow(row: CsvRow, push: (m: string) => void): SeedUserRow | null {
  const shape = userShape.safeParse({
    key: row.key ?? "", email: row.email ?? "",
    name: row.name ?? "", phone: row.phone ?? "",
  });
  if (!shape.success) { push(firstZodMessage(shape.error)); return null; }

  const isVerified = parseBool(row.is_verified ?? "");
  if (isVerified === null) {
    push(`is_verified «${row.is_verified}» — ожидается yes или пусто`);
    return null;
  }

  const coverUrl = coverUrlFor(row.cover ?? "");
  if (coverUrl === undefined) {
    push(`cover «${row.cover}» — нет такого пресета. Доступные: ${COVER_PRESETS.map((p) => p.slug).join(", ")}`);
    return null;
  }

  return {
    key: shape.data.key,
    email: shape.data.email.toLowerCase(),
    name: shape.data.name,
    phone: orNull(row.phone),
    citySlug: orNull(row.city_slug),
    bio: orNull(row.bio),
    coverUrl,
    isVerified,
  };
}

/**
 * Точка адреса и её точность. Точка — парой, в диапазоне; точность у точки
 * есть всегда и не `city`, а без точки — только `city` (или пусто).
 */
function parseListingPoint(
  row: CsvRow, push: (m: string) => void,
): Pick<SeedListingRow, "lat" | "lon" | "precision"> | null {
  let lat: number | null = null;
  let lon: number | null = null;
  if (!blank(row.lat)) {
    lat = parseFloatCell(row.lat);
    if (lat === null) { push("lat не число"); return null; }
  }
  if (!blank(row.lon)) {
    lon = parseFloatCell(row.lon);
    if (lon === null) { push("lon не число"); return null; }
  }
  if ((lat === null) !== (lon === null)) { push("lat и lon заполняются парой"); return null; }
  if (lat !== null && Math.abs(lat) > 90) { push("lat вне диапазона −90…90"); return null; }
  if (lon !== null && Math.abs(lon) > 180) { push("lon вне диапазона −180…180"); return null; }

  const rawPrecision = (row.precision ?? "").trim().toLowerCase();
  const precision = rawPrecision === "" ? null : PRECISION[rawPrecision];
  if (precision === undefined) {
    push(`precision «${row.precision}» — ожидается house, street, place или city`);
    return null;
  }
  if (lat === null) {
    if (precision !== null && precision !== "city") {
      push(`precision = ${precision}, а lat/lon пусты — точности без точки не бывает`);
      return null;
    }
    return { lat: null, lon: null, precision: "city" };
  }
  if (precision === null || precision === "city") {
    push("у точки lat/lon нужна precision: house, street или place");
    return null;
  }
  if (blank(row.address)) { push("lat/lon заполнены, а address пуст"); return null; }
  return { lat, lon, precision };
}

function parseListingRow(row: CsvRow, push: (m: string) => void): SeedListingRow | null {
  const shape = listingShape.safeParse({
    title: row.title ?? "", location: row.location ?? "", address: row.address ?? "",
  });
  if (!shape.success) { push(firstZodMessage(shape.error)); return null; }

  const title = shape.data.title;
  const slug = slugify(title);
  if (slug === "") {
    push(`из title «${title}» не собирается слаг для адреса`);
    return null;
  }

  const category = (row.category ?? "").trim();
  if (!hasCategoryPath(category)) {
    const parsed = parseCategoryPath(category);
    push(parsed
      ? `нет категории «${category}». Список путей — в seed_real/README.md`
      : `category «${category}» — ожидается путь вида «Инструменты / Электроинструменты» (${allCategoryPaths().length} вариантов)`);
    return null;
  }
  const path = parseCategoryPath(category)!;

  const priceDay = parseIntCell(row.price_day ?? "");
  if (priceDay === null || priceDay < 1) { push("price_day — ожидается целое число от 1"); return null; }

  const quantity = parseIntCell(row.quantity ?? "");
  if (quantity === null || quantity < 1) { push("quantity — ожидается целое число от 1"); return null; }

  const depositType = DEPOSIT[(row.deposit_type ?? "").trim().toLowerCase()];
  if (!depositType) {
    push(`deposit_type «${row.deposit_type}» — ожидается money, document или none`);
    return null;
  }

  let depositAmount: number | null = null;
  if (depositType === "money") {
    depositAmount = parseIntCell(row.deposit_amount ?? "");
    if (depositAmount === null || depositAmount < 1) {
      push("deposit_amount обязателен при deposit_type = money");
      return null;
    }
  } else if (!blank(row.deposit_amount)) {
    push(`deposit_amount заполнен, а deposit_type = ${depositType} — залога нет, суммы быть не должно`);
    return null;
  }

  const handover = parseHandover(row.handover ?? "");
  if (!handover) {
    push(`handover «${row.handover}» — ожидается pickup, delivery или pickup;delivery`);
    return null;
  }

  const status = STATUS[(row.status ?? "").trim().toLowerCase()];
  if (!status) {
    push(`status «${row.status}» — ожидается active, hidden или archived`);
    return null;
  }

  const point = parseListingPoint(row, push);
  if (!point) return null;

  const photos = parsePhotos(row.photos ?? "");
  // Тот же потолок, что у формы объявления (lib/owner/validation.ts). Сид,
  // положивший одиннадцатое фото, сделал бы объявление несохраняемым в
  // кабинете: форма отвергла бы его собственные текущие данные.
  if (photos.length > MAX_PHOTOS) {
    push(`photos: ${photos.length} штук, а больше ${MAX_PHOTOS} на объявление не берём`);
    return null;
  }
  const badName = photos.find((p) => /[/\\]/.test(p) || p.startsWith("."));
  if (badName) {
    push(`photos: «${badName}» — ожидается имя файла из папки Фото/, без пути`);
    return null;
  }

  return {
    owner: (row.owner ?? "").trim(),
    city: (row.city ?? "").trim(),
    categoryRoot: path.root,
    categoryChild: path.child,
    title, slug,
    description: orNull(row.description),
    location: orNull(row.location),
    address: orNull(row.address),
    ...point,
    priceDay, depositType, depositAmount, quantity,
    handoverPickup: handover.pickup,
    handoverDelivery: handover.delivery,
    status,
    photos,
  };
}

// ------------------------------------------------------------------ вход

function missingColumns(rows: CsvRow[], expected: string[]): string[] {
  if (rows.length === 0) return [];
  const present = new Set(Object.keys(rows[0]));
  return expected.filter((c) => !present.has(c));
}

export type SeedParseResult =
  | { ok: true; data: SeedData }
  | { ok: false; issues: SeedIssue[] };

export function parseSeedData(input: {
  cities: CsvRow[];
  users: CsvRow[];
  listings: CsvRow[];
}): SeedParseResult {
  const issues: SeedIssue[] = [];
  const add = (file: string, line: number, message: string) => issues.push({ file, line, message });

  for (const [file, rows, columns] of [
    ["cities.csv", input.cities, CITY_COLUMNS],
    ["users.csv", input.users, USER_COLUMNS],
    ["listings.csv", input.listings, LISTING_COLUMNS],
  ] as const) {
    if (rows.length === 0) add(file, 1, "файл пуст — нет ни одной строки данных");
    const missing = missingColumns(rows, columns);
    if (missing.length > 0) add(file, 1, `в шапке нет колонок: ${missing.join(", ")}`);
  }
  if (issues.length > 0) return { ok: false, issues };

  // Номер исходной строки едет вместе с разобранной: восстанавливать его из
  // позиции в отфильтрованном массиве нельзя — одна отбракованная строка
  // сдвинула бы все последующие, и проверки ниже указывали бы на соседей.
  const cities: Array<{ row: SeedCityRow; line: number }> = [];
  input.cities.forEach((row, i) => {
    const line = i + 2;
    const parsed = parseCityRow(row, (m) => add("cities.csv", line, m));
    if (parsed) cities.push({ row: parsed, line });
  });
  const citiesBroken = issues.length > 0;

  const users: Array<{ row: SeedUserRow; line: number }> = [];
  const usersFrom = issues.length;
  input.users.forEach((row, i) => {
    const line = i + 2;
    const parsed = parseUserRow(row, (m) => add("users.csv", line, m));
    if (parsed) users.push({ row: parsed, line });
  });
  const usersBroken = issues.length > usersFrom;

  const listings: Array<{ row: SeedListingRow; line: number }> = [];
  input.listings.forEach((row, i) => {
    const line = i + 2;
    const parsed = parseListingRow(row, (m) => add("listings.csv", line, m));
    if (parsed) listings.push({ row: parsed, line });
  });

  // --- связки между файлами.
  //
  // Сверяются только после того, как сами таблицы разобрались: пока в
  // cities.csv есть ошибка, неизвестно, каким слаг должен был быть, и «нет
  // такого города» прилетело бы каждому объявлению и каждому владельцу. Список
  // указывал бы куда угодно, кроме единственной строки, которую надо чинить.
  const declaredCities = new Set(
    input.cities.map((r) => (r.slug ?? "").trim()).filter(Boolean));
  const declaredUsers = new Set(
    input.users.map((r) => (r.key ?? "").trim()).filter(Boolean));

  const citySlugs = new Set<string>();
  for (const { row: c, line } of cities) {
    if (citySlugs.has(c.slug)) add("cities.csv", line, `slug «${c.slug}» встречается дважды`);
    citySlugs.add(c.slug);
  }

  const userKeys = new Set<string>();
  const emails = new Set<string>();
  for (const { row: u, line } of users) {
    if (userKeys.has(u.key)) add("users.csv", line, `key «${u.key}» встречается дважды`);
    userKeys.add(u.key);
    if (emails.has(u.email)) add("users.csv", line, `email «${u.email}» встречается дважды`);
    emails.add(u.email);
    if (!citiesBroken && u.citySlug && !declaredCities.has(u.citySlug)) {
      add("users.csv", line, `city_slug «${u.citySlug}» — нет такого города в cities.csv`);
    }
  }

  // Пара (владелец, заголовок) — ключ идемпотентности: по ней сид находит, что
  // обновить. Два одинаковых заголовка у одного владельца сделали бы её
  // неоднозначной, и второй прогон переписывал бы одну и ту же строку дважды.
  // Город с геоданными без точек у объявлений — почти наверняка таблица, где
  // geo:backfill ещё не прогнан. Сид записал бы строки без точек, а повторный
  // прогон стёр бы точки, найденные с тех пор.
  const geoCities = new Set(cities.filter((c) => c.row.geoRegion).map((c) => c.row.slug));

  const pairs = new Set<string>();
  for (const { row: l, line } of listings) {
    if (!citiesBroken && geoCities.has(l.city) && l.lat === null) {
      add("listings.csv", line,
        `у города «${l.city}» есть геоданные, а lat пуст — запустите pnpm geo:backfill --csv seed_real/listings.csv`);
    }
    if (!usersBroken && !declaredUsers.has(l.owner)) {
      add("listings.csv", line, `owner «${l.owner}» — нет такого key в users.csv`);
    }
    if (!citiesBroken && !declaredCities.has(l.city)) {
      add("listings.csv", line, `city «${l.city}» — нет такого slug в cities.csv`);
    }
    const pair = `${l.owner} ${l.title.toLowerCase()}`;
    if (pairs.has(pair)) {
      add("listings.csv", line, `у владельца «${l.owner}» уже есть объявление «${l.title}» — заголовки должны различаться`);
    }
    pairs.add(pair);
  }

  if (issues.length > 0) {
    issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    return { ok: false, issues };
  }
  return {
    ok: true,
    data: {
      cities: cities.map((c) => c.row),
      users: users.map((u) => u.row),
      listings: listings.map((l) => l.row),
    },
  };
}
