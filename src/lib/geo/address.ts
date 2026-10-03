// Адреса своего геокодера в поле адреса (форма объявления и «Где»): подписи,
// сверка хитов и порядок ответов при наборе (перенос генеричной части
// sravniprokat/src/lib/compare/address.ts). Чистые функции — общие для поля,
// actions и тестов. Сам поиск — src/lib/geocoder (сервер:
// src/server/geocoder.ts, браузер: мини-индекс в components/search).

import { content } from "@theme/content";
import type { Geocoder } from "@/lib/geocoder";
import type { AddressHit, HitSettlement } from "@/lib/geocoder/types";
import { normalize } from "@/lib/search/text";
import { haversineKm, type GeoPoint } from "./point";
import { listingPrecision, type GeoPrecision } from "./precision";

export type { AddressHit } from "@/lib/geocoder/types";

type LabelHit = Pick<AddressHit, "kind" | "title" | "parts" | "settlement">;

const clip = (s: string, max: number) => s.trim().slice(0, max).trim();

// Назван ли пункт в имени хита: «СНТ Кубаночка, 15», «Лазурный, 1-е отделение», сам «Яблоновский».
const namedIn = (name: string, settlement: string) => ` ${normalize(name)} `.includes(` ${normalize(settlement)} `);

/**
 * Пункт для подписи хита — из settlementOf (микрорайоны и округа там
 * пропущены, поэтому у «Юбилейного» это Краснодар, у «Меги» — Новая Адыгея).
 * У места и объекта пункты, уже названные в имени, пропускаются: сам СНТ или
 * посёлок в черте города подписывается пунктом над ним («СНТ Мечта,
 * Краснодар», «Лазурный, Краснодар»), пункт без пункта над ним — ничем. СНТ
 * называется вместе с пунктом над ним: одноимённых СНТ в регионе по нескольку
 * («улица Вишнёвая, СНТ Кубань, Берёзовый»). Хит без пунктов (не прошёл через
 * settlementOf) — пункт из частей адреса: у улицы и дома это «Краснодар» или
 * «Краснодар, Юбилейный» (берётся город), у объекта — то же; у места пункт
 * не известен (null).
 */
function settlementLabel(hit: LabelHit, name: string, area: boolean, cityName: string): string | null {
  const s = hit.settlement;
  if (s?.names.length) {
    let i = 0;
    while (area && i < s.names.length && namedIn(name, s.names[i])) i++;
    if (i === s.names.length) return null;
    const above = s.kinds?.[i] === "snt" ? s.names[i + 1] : undefined;
    return above ? `${s.names[i]}, ${above}` : s.names[i];
  }
  const place = hit.parts?.place?.split(",")[0].trim() || null;
  if (area && place && namedIn(name, place)) return null;
  if (hit.kind === "street" || hit.kind === "house") return place ?? cityName;
  return hit.kind === "poi" ? place : null;
}

/**
 * «{имя}, {пункт}». Подпись всегда называет свой пункт, а не город каталога
 * (docs/decisions/0021). Не влезает в `max` — режется имя, а не пункт.
 */
function withSettlement(name: string, settlement: string | null, max = Infinity): string {
  if (!settlement) return clip(name, max);
  const tail = `, ${settlement}`;
  if (tail.length >= max) return clip(settlement, max);
  return `${clip(name, max - tail.length)}${tail}`;
}

/** Имя хита без пункта: полное (может быть с домом) или публичное (без дома), и место ли это (пункт может быть в имени). */
function labelName(hit: LabelHit, full: boolean): { name: string; area: boolean } {
  if (hit.kind === "place" || hit.kind === "poi") return { name: hit.title, area: true };
  const street = hit.parts?.street ?? (hit.kind === "street" ? hit.title : null);
  // Дом без улицы (адрес по пункту: «СНТ Кубаночка, 15») — пункт уже в title,
  // публично — сам пункт.
  if (!street) return { name: full ? hit.title : hit.parts?.place ?? hit.title, area: true };
  // Номер есть только в title дома, улица — в parts. У улицы title и есть улица:
  // пункт ей пишется всегда, даже названный в ней («Яблоновский проезд, Яблоновский»).
  return { name: full ? hit.title : street, area: false };
}

function label(hit: LabelHit, cityName: string, full: boolean, max?: number): string {
  const { name, area } = labelName(hit, full);
  return withSettlement(name, settlementLabel(hit, name, area, cityName), max);
}

/**
 * Полная подпись хита — для поля и `listings.address`: «улица Базовская, 21к1,
 * Яблоновский», «улица Красная, 120, Краснодар», «Юбилейный, Краснодар»,
 * «Мега, Новая Адыгея». Может содержать номер дома. Пункт — свой
 * (settlementLabel); `cityName` нужен, только если пунктов у хита нет.
 */
export function hitLabel(hit: LabelHit, cityName: string): string {
  return label(hit, cityName, true);
}

/**
 * Публичная подпись адреса объявления (`listings.location`) — **без номера
 * дома**, со своим пунктом: улица — «улица Красная, Краснодар», «улица
 * Базовская, Яблоновский»; объект или микрорайон — «ЖК Панорама, Краснодар»,
 * «Мега, Новая Адыгея»; пункт или СНТ — с пунктом над ним, если он есть
 * («Лазурный, Краснодар», «СНТ Мечта, Южный», «Яблоновский»). OwnerCard
 * показывает её как есть, город каталога не дописывает.
 */
export function publicLabel(hit: LabelHit, cityName: string): string {
  return label(hit, cityName, false);
}

/**
 * Подпись точки геолокации по обратному геокодеру — **без номера дома**: она
 * уходит в адрес страницы (`la`), а с ним в «поделиться», историю и Метрику.
 * Дом — его улица, объект — название; улица и пункт без дома рядом — «рядом: …».
 */
export function reverseLabel(hit: LabelHit | null, cityName: string): string | null {
  if (!hit) return null;
  if (hit.kind === "house" || hit.kind === "poi") return publicLabel(hit, cityName);
  return content.address.near(publicLabel(hit, cityName));
}

/** Есть ли в запросе номер: дома знает только сервер, улицы и пункты — и мини-индекс браузера. */
export function hasHouseNumber(q: string): boolean {
  return /\d/.test(q);
}

/**
 * Нужен ли запрос к серверу: всегда, если мини-индекса ещё нет; с ним — только
 * когда в запросе есть номер дома (без номера ответ сервера совпадает с
 * мини-индексом).
 */
export function needsServer(q: string, clientReady: boolean): boolean {
  const t = q.trim();
  if (t.length < 2) return false;
  return !clientReady || hasHouseNumber(t);
}

/** Ответ сервера на подсказки: номер запроса по порядку и текст, на который он отвечает. */
export interface SuggestReply {
  seq: number;
  q: string;
  items: AddressHit[];
}

/**
 * Показывать ли пришедший ответ. Ответы приходят не по порядку: более старый,
 * чем уже показанный, — отбрасываем (список не откатывается назад); ответ на
 * текст, от которого человек уже ушёл (стёр или исправил), — тоже. Ответ на
 * начало набираемого текста показываем: он ближе к вводу, чем прошлый список,
 * а точный догонит.
 */
export function shouldApply(reply: Pick<SuggestReply, "seq" | "q">, shownSeq: number, current: string): boolean {
  if (reply.seq <= shownSeq) return false;
  const cur = current.trim().toLowerCase();
  const q = reply.q.trim().toLowerCase();
  return cur === q || cur.startsWith(q);
}

/** Ключ подсказки для сверки клиентских и серверных списков в UI (id у них разные). */
export function hitKey(hit: Pick<AddressHit, "kind" | "title" | "subtitle">): string {
  return `${hit.kind}|${hit.title}|${hit.subtitle}`;
}

/** Насколько присланная точка может отстоять от серверной у того же хита. */
export const SAME_HIT_KM = 0.05;

// Подзаголовок → части через запятую, нормализованные.
const subtitleParts = (s: string) => s.split(",").map(normalize).filter(Boolean);

/**
 * Подзаголовки одного адреса. Движок дописывает к подзаголовку район
 * («Краснодар» → «Краснодар, Авиагородок»), только когда в том же списке есть
 * одноимённая улица, — поэтому у мини-индекса и у сервера подзаголовок одного
 * и того же хита может отличаться хвостом. Совпадение — когда части одного
 * подзаголовка начинают другой.
 */
function sameSubtitle(a: string, b: string): boolean {
  const [x, y] = [subtitleParts(a), subtitleParts(b)].sort((p, q) => p.length - q.length);
  return x.every((part, i) => part === y[i]);
}

/**
 * Тот же ли это адрес: хит из браузера (мини-индекс или ответ сервера) и хит,
 * найденный сервером заново. id не сравниваем: у мини-индекса свои (`cs0`,
 * `cp3`), у сервера — `s:…`, `h:…`, и после переимпорта они меняются. Сверка —
 * вид, нормализованные title и subtitle (subtitle — с точностью до хвоста
 * района, см. sameSubtitle) и точка не дальше 50 м: подменённые координаты при
 * том же тексте не пройдут.
 */
export function sameHit(
  a: Pick<AddressHit, "kind" | "title" | "subtitle" | "lat" | "lon">,
  b: Pick<AddressHit, "kind" | "title" | "subtitle" | "lat" | "lon">,
): boolean {
  return a.kind === b.kind
    && normalize(a.title) === normalize(b.title)
    && sameSubtitle(a.subtitle, b.subtitle)
    && haversineKm(a, b) <= SAME_HIT_KM;
}

/**
 * Точка для подсказок адреса (`near`) — одно правило везде: выбранная точка,
 * иначе последнее место с этого устройства (того же региона), иначе центр
 * города. Без него движок ранжировал бы от самого крупного города региона, и
 * «Гагарина 1» на /yablonovskiy уходила бы в Краснодар.
 */
export function suggestNear(picked: GeoPoint | null, stored: GeoPoint | null, centre: GeoPoint): GeoPoint {
  return picked ?? stored ?? centre;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const extendsText = (prefix: string, text: string) => text.trim().toLowerCase().startsWith(prefix.trim().toLowerCase());

/**
 * Прошлый ответ ещё про этот ввод: текст дописан или стёрт с конца. Поле
 * очистили и набирают другое — прошлый список («Базовская, 21к1») под «кр» не
 * показываем, даже на миг.
 */
export function sameTyping(replyQ: string, current: string): boolean {
  return extendsText(replyQ, current) || extendsText(current, replyQ);
}

/**
 * Какие адреса показать под полем, пока человек печатает, — без мигания:
 *  - ответ сервера на этот самый текст — его;
 *  - есть мини-индекс — его подсказки (мгновенно), но если в запросе номер
 *    дома, а сервер уже ответил на начало текста («красная 1» при вводе
 *    «красная 12»), — дома сервера: не откатываемся к улицам на каждую цифру;
 *  - мини-индекса нет — прошлый ответ сервера, пока не пришёл новый (список не
 *    исчезает), если он про этот же ввод (`sameTyping`).
 */
export function visibleAddresses(
  q: string, server: Pick<SuggestReply, "q" | "items"> | null, clientHits: AddressHit[] | null,
): AddressHit[] {
  if (server && sameText(server.q, q)) return server.items;
  if (clientHits) {
    if (hasHouseNumber(q) && server && hasHouseNumber(server.q) && extendsText(server.q, q)) return server.items;
    return clientHits;
  }
  return server && sameTyping(server.q, q) ? server.items : [];
}

// ------------------------------------------------------------------ адрес объявления

/** Дальше этого от центра города адрес объявления не принимается, км. */
export const LISTING_MAX_FROM_CENTRE_KM = 40;

/** Длины колонок listings (drizzle/schema.ts): address — 200, location — 120. */
const ADDRESS_MAX = 200;
const LOCATION_MAX = 120;

/** Колонки адреса объявления для записи. */
export interface ListingAddressFields {
  address: string;
  location: string;
  lat: number | null;
  lon: number | null;
  geoPrecision: GeoPrecision;
}

/** Город сервиса, к которому может отойти адрес: активный город того же региона геоданных. */
export interface ListingCityCandidate {
  id: string;
  name: string;
  /** Предложный падеж («Яблоновском»): пункт в данных сверяется и с ним. */
  nameLocative?: string | null;
  centre: GeoPoint | null;
}

/**
 * Город объявления по его адресу — город определяет адрес, а не выбор
 * владельца. Пункт адреса или пункт над ним (СНТ → посёлок → город) с именем
 * города сервиса — этот город: микрорайон, ЖК и посёлок в черте Краснодара —
 * Краснодар. Иначе (Козет, Новая Адыгея, Энем, СНТ на отшибе) — ближайший
 * по центру город региона; расстояние — от центра верхнего пункта, а не от
 * самой точки, чтобы весь посёлок отходил к одному городу. Равные расстояния
 * решает имя, затем id: от порядка списка ответ не зависит. null — городов с
 * центром нет. Дальше 40 км адрес отвергает listingAddressOf.
 *
 * Общая для формы (подпись «В каталоге: …» до сохранения), сервера
 * (src/server/listing-address.ts — он и решает) и сида.
 */
export function listingCityOf<C extends ListingCityCandidate>(
  settlement: HitSettlement | null | undefined, point: GeoPoint, cities: readonly C[],
): C | null {
  const from = settlement ?? point;
  for (const name of settlement?.names ?? []) {
    const key = normalize(name);
    const named = cities.filter((c) => normalize(c.name) === key || (!!c.nameLocative && normalize(c.nameLocative) === key));
    if (named.length > 0) return nearestCity(named, from) ?? named[0];
  }
  return nearestCity(cities, from);
}

function nearestCity<C extends ListingCityCandidate>(cities: readonly C[], from: GeoPoint): C | null {
  let best: C | null = null;
  let bestKm = Infinity;
  for (const c of cities) {
    if (!c.centre) continue;
    const km = haversineKm(from, c.centre);
    const tie = best !== null && Math.abs(km - bestKm) < 1e-9;
    if (tie ? (c.name.localeCompare(best!.name, "ru") || c.id.localeCompare(best!.id)) < 0 : km < bestKm) {
      best = c;
      bestKm = km;
    }
  }
  return best;
}

/**
 * Обе подписи адреса объявления по хиту, в длину колонок: полная (`address`)
 * и публичная (`location`). Режется имя, пункт остаётся. Общая для формы
 * (listingAddressOf) и пересчёта подписей сида и базы (geo:backfill --relabel).
 */
export function listingLabelsOf(hit: LabelHit, cityName: string): Pick<ListingAddressFields, "address" | "location"> {
  return { address: label(hit, cityName, true, ADDRESS_MAX), location: label(hit, cityName, false, LOCATION_MAX) };
}

/**
 * Хит геокодера → колонки адреса объявления: полная подпись (может быть с
 * домом), публичная без дома, точка и её точность. Отказ: `coarse` — город или
 * округ целиком, `far` — дальше 40 км от центра города (другой край региона;
 * пункт внутри агломерации — нормально). Общая для формы (сервер,
 * src/server/listing-address.ts) и backfill сида (scripts/geo-backfill.ts).
 */
export function listingAddressOf(
  hit: Pick<AddressHit, "kind" | "title" | "subtitle" | "parts" | "settlement" | "precision" | "lat" | "lon">,
  city: { name: string; centre: GeoPoint | null },
): { ok: true; fields: ListingAddressFields } | { ok: false; reason: "coarse" | "far" } {
  const precision = listingPrecision(hit);
  if (!precision) return { ok: false, reason: "coarse" };
  if (city.centre && haversineKm(hit, city.centre) > LISTING_MAX_FROM_CENTRE_KM) return { ok: false, reason: "far" };
  return {
    ok: true,
    fields: {
      ...listingLabelsOf(hit, city.name),
      lat: hit.lat,
      lon: hit.lon,
      geoPrecision: precision,
    },
  };
}

/**
 * Хит уже сохранённого адреса — по подписи и точке, без id: подсказки на
 * подпись рядом с точкой, первая не дальше 50 м от неё, иначе обратный
 * геокодер точки. По нему сид сверяет город объявления с точкой
 * (scripts/seed-real.ts) — тем же путём, что и форма (settlementOf хита).
 */
export function storedAddressHit(
  g: Pick<Geocoder, "suggest" | "reverse">, address: string | null, point: GeoPoint,
): AddressHit | null {
  const near = address ? g.suggest(address, { near: point, limit: 10 }).find((h) => haversineKm(h, point) <= SAME_HIT_KM) : null;
  return near ?? g.reverse(point.lat, point.lon);
}

/** Свободный текст адреса (город без геоданных): точки нет, подпись — сам текст. */
export function textAddressOf(text: string): ListingAddressFields {
  const address = clip(text, ADDRESS_MAX);
  return { address, location: clip(address, LOCATION_MAX), lat: null, lon: null, geoPrecision: "city" };
}
