// Заголовки и описания публичных страниц каталога. Чистые функции: страница
// подаёт уже прочитанные имя раздела, город и цены, здесь только текст.
//
// Город — всегда headingCity: «в Краснодаре» из cities.name_locative, а без
// падежа — «· Казань». Падеж не выдумывается (см. city-locative.ts).
//
// Имя раздела стоит первым и регистра не теряет: «VR — аренда и прокат…».
// Родительного падежа у разделов нет — шаблоны собраны так, чтобы он не
// понадобился.
//
// Страницы каталога ставят эти заголовки как `title.absolute`, без хвоста
// « — inrenta» из шаблона корневого layout: город и цена и так доводят строку
// до предела, который выдача показывает целиком, а у витрины города хвост
// давал бы второе тире подряд («— от 150 ₽/сутки — inrenta»). Имя сайта
// поисковик показывает рядом с заголовком сам.

import { headingCity, type CityNames } from "@/lib/catalog/city-locative";
import {
  formatDeposit, formatPrice, listingsCountLabel, ownersCountLabel, type DepositType,
} from "@/lib/catalog/format";
import { content } from "@theme/content";
import {
  formatUnitPriceSlash, minDaysLabel, primaryPrice, type PriceSummary, type Tariff,
} from "@/lib/catalog/tariff";

/** Потолок заголовка карточки: длиннее выдача Яндекса и Google режет. */
export const LISTING_TITLE_MAX = 70;
/** Потолок описания: дальше сниппет всё равно обрезается. */
export const DESCRIPTION_MAX = 160;

/** «от 700 ₽/сутки» — нижняя цена раздела со своей единицей. */
const fromPrice = (p: PriceSummary) => `от ${formatUnitPriceSlash({ amount: p.min, unit: p.unit })}`;

/**
 * Строчная первая буква — для имени раздела внутри фразы. Аббревиатура (вторая
 * буква тоже заглавная) остаётся как есть: «VR», а не «vR».
 */
export function lowerFirst(s: string): string {
  const [first, second] = [s[0], s[1]];
  if (!first) return s;
  if (second && /\p{Lu}/u.test(second)) return s;
  return first.toLowerCase() + s.slice(1);
}

// Предлоги и союзы, на которых обрезанная фраза не кончается: «самокат, до…».
const DANGLING = new Set([
  "а", "без", "в", "во", "для", "до", "за", "и", "из", "или", "к", "ко", "на", "над",
  "о", "об", "от", "по", "под", "при", "с", "со", "у",
]);

/**
 * Обрезка по границе слова с «…», не длиннее max. Слово, которое одно длиннее
 * лимита, режется посимвольно. Хвостовые знаки препинания, предлоги и союзы
 * перед «…» убираются.
 */
export function truncateWords(text: string, max: number): string {
  // Неразрывные пробелы не схлопываются: ими formatPrice склеивает «1 500 ₽»,
  // и обрезка не должна ни разрывать цену, ни терять неразрывность.
  const s = text.replace(/[^\S  ]+/gu, " ").trim();
  if (s.length <= max) return s;
  const room = s.slice(0, max - 1);
  // Слово, которое кончается ровно на границе, целое — его не выбрасывать.
  const end = s[max - 1] === " " ? room.length : room.lastIndexOf(" ");
  if (end <= 0) return `${room}…`;
  const words = room.slice(0, end).split(" ");
  const clean = (w: string) => w.replace(/[,.;:!?—–-]+$/u, "");
  while (words.length > 1 && (DANGLING.has(clean(words.at(-1)!).toLowerCase()) || !clean(words.at(-1)!))) {
    words.pop();
  }
  return `${clean(words.join(" "))}…`;
}

/** H1 раздела: «Экшн-камеры — аренда и прокат в Краснодаре». */
export function catalogHeading(name: string, city: CityNames): string {
  return `${name} — аренда и прокат ${headingCity(city)}`;
}

/** Title раздела: H1 и цена «от», если в разделе есть объявления. */
/**
 * Потолок длины заголовка раздела: длиннее поисковики обрезают сниппет. Цена —
 * самая необязательная часть строки и уходит первой; что и где — остаются.
 */
export const CATALOG_TITLE_MAX = 70;

/**
 * Цена — суточная по сырой min(price_day); если суточных в разделе нет вовсе,
 * — главная цена со своей единицей («от 2 250 ₽/неделя»), а не приведённая к
 * суткам (priceSummary в lib/catalog/tariff.ts).
 */
export function catalogTitle(name: string, city: CityNames, price: PriceSummary | null): string {
  const head = catalogHeading(name, city);
  if (price == null) return head;
  const full = `${head}, ${fromPrice(price)}`;
  return full.length <= CATALOG_TITLE_MAX ? full : head;
}

export interface CatalogStats {
  listingCount: number;
  ownerCount: number;
  price: PriceSummary | null;
}

function priceRange(p: PriceSummary): string {
  const slash = content.tariff.slash[p.unit];
  return p.min === p.max
    ? `${formatPrice(p.min)}${slash}`
    : `от ${formatPrice(p.min)} до ${formatPrice(p.max)}${slash}`;
}

/**
 * Описание раздела из данных: «12 позиций, 5 продавцов: экшн-камеры напрокат в
 * Краснодаре, от 700 ₽ до 1 500 ₽/сутки. Залог, даты и заявка на бронь онлайн.»
 */
export function catalogDescription(name: string, city: CityNames, stats: CatalogStats): string {
  const where = `${lowerFirst(name)} напрокат ${headingCity(city)}`;
  const tail = "Залог, даты и заявка на бронь онлайн.";
  if (stats.listingCount === 0 || stats.price == null) {
    return truncateWords(`${name} напрокат ${headingCity(city)}: цены, залоги и календарь занятости. ${tail}`, DESCRIPTION_MAX);
  }
  const counts = `${listingsCountLabel(stats.listingCount)}, ${ownersCountLabel(stats.ownerCount)}`;
  return truncateWords(
    `${counts}: ${where}, ${priceRange(stats.price)}. ${tail}`,
    DESCRIPTION_MAX,
  );
}

/** Title витрины города: «Аренда и прокат вещей в Краснодаре — от 150 ₽/сутки». */
export function cityTitle(city: CityNames, price: PriceSummary | null): string {
  const head = `Аренда и прокат вещей ${headingCity(city)}`;
  return price == null ? head : `${head} — ${fromPrice(price)}`;
}

export function cityDescription(city: CityNames): string {
  return `Всё для аренды ${headingCity(city)}: инструмент, техника, спорт, одежда и другое. Каталог с ценами и заявкой на бронь онлайн.`;
}

/**
 * Главная цена вещи с единицей: «700 ₽/сутки», а у вещи без суточной —
 * «2 250 ₽/неделя». Приведённая к суткам цена в текст не идёт: у вещи, которую
 * меньше чем на неделю не сдают, «322 ₽/сутки» — выдумка.
 */
function listingPrice(tariff: Tariff): string | null {
  const p = primaryPrice(tariff);
  return p ? formatUnitPriceSlash(p) : null;
}

/** Полная фраза о вещи без обрезки — для «Поделиться». */
export function listingShareText(title: string, city: CityNames, tariff: Tariff): string {
  const price = listingPrice(tariff);
  return `${title} — аренда ${headingCity(city)}${price ? `, ${price}` : ""}`;
}

/**
 * Title карточки: «{title} — аренда в Краснодаре, 700 ₽/сутки» (или
 * «2 250 ₽/неделя» у вещи без суточной), не длиннее LISTING_TITLE_MAX.
 * Название — главное в сниппете: модель и вариант («Kugoo Kirin V3 Pro, АКБ
 * 28,6 Ач») ищут дословно. Поэтому сперва отказываемся от хвостов, если без них
 * название влезает целиком: без цены, затем без города, затем оба. Если не
 * влезает и так — название режется по слову под хвост с городом без цены;
 * очень длинное имя города уходит из хвоста тоже.
 */
export function listingTitle(title: string, city: CityNames, tariff: Tariff): string {
  const MIN_TITLE = 16;
  title = title.replace(/\s+/g, " ").trim();
  const price = listingPrice(tariff);
  const tail = price ? `, ${price}` : "";
  const inCity = headingCity(city);
  const ladder = [` — аренда ${inCity}${tail}`, ` — аренда ${inCity}`, ` — аренда${tail}`, " — аренда"];
  const whole = ladder.find((suffix) => title.length + suffix.length <= LISTING_TITLE_MAX);
  if (whole !== undefined) return `${title}${whole}`;
  // Целиком не влезает и так — режем название под хвост с городом, но без
  // цены: так от названия остаётся больше; совсем длинный город уходит тоже.
  let suffix = ladder[1]!;
  if (LISTING_TITLE_MAX - suffix.length < MIN_TITLE) suffix = ladder[3]!;
  return `${truncateWords(title, LISTING_TITLE_MAX - suffix.length)}${suffix}`;
}

export interface ListingFacts extends Tariff {
  title: string;
  description: string | null;
  minDays: number;
  depositType: DepositType;
  depositAmount: number | null;
  handoverPickup: boolean;
  handoverDelivery: boolean;
}

function handoverFact(pickup: boolean, delivery: boolean): string | null {
  if (pickup && delivery) return "самовывоз или доставка";
  if (pickup) return "самовывоз";
  if (delivery) return "доставка";
  return null;
}

/**
 * Описание карточки: сначала факты (цена, залог, получение), потом начало текста
 * владельца — всё вместе не длиннее DESCRIPTION_MAX. Сырой текст владельца
 * первым не ставится: в сниппете он съедал цену и город.
 */
export function listingDescription(listing: ListingFacts, city: CityNames): string {
  const deposit = listing.depositType === "money" && !listing.depositAmount
    ? null
    : formatDeposit(listing.depositType, listing.depositAmount);
  const facts = [
    listingPrice(listing),
    // Минимальный срок решает, подойдёт ли вещь вообще, — в сниппет он
    // нужнее залога.
    listing.minDays > 1 ? minDaysLabel(listing.minDays) : null,
    deposit,
    handoverFact(listing.handoverPickup, listing.handoverDelivery),
  ].filter(Boolean).join(", ");
  const head = `Аренда ${headingCity(city)}: ${facts}.`;
  const own = listing.description?.replace(/\s+/gu, " ").trim();
  return truncateWords(own ? `${head} ${own}` : head, DESCRIPTION_MAX);
}
