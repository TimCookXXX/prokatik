// Адреса своего геокодера в поле адреса (форма объявления и «Где»): подписи,
// сверка хитов и порядок ответов при наборе (перенос генеричной части
// sravniprokat/src/lib/compare/address.ts). Чистые функции — общие для поля,
// actions и тестов. Сам поиск — src/lib/geocoder (сервер:
// src/server/geocoder.ts, браузер: мини-индекс в components/search).

import { content } from "@theme/content";
import type { AddressHit } from "@/lib/geocoder/types";
import { normalize } from "@/lib/search/text";
import { haversineKm, type GeoPoint } from "./point";
import { listingPrecision, type GeoPrecision } from "./precision";

export type { AddressHit } from "@/lib/geocoder/types";

/**
 * Полная подпись хита — для поля и `listings.address`: «улица Базовская, 21к1,
 * Яблоновский»; в городе `cityName` — без города («улица Красная, 120»), у
 * пункта и объекта — его название. Может содержать номер дома. Дом без
 * улицы (адрес по пункту: «СНТ Кубаночка, 1») пункт уже несёт в title.
 */
export function hitLabel(hit: Pick<AddressHit, "kind" | "title" | "parts">, cityName: string): string {
  const place = hit.parts?.place ?? null;
  if (hit.kind === "place" || hit.kind === "poi" || !place || place === cityName) return hit.title;
  if (hit.kind === "house" && !hit.parts?.street) return hit.title;
  return `${hit.title}, ${place}`;
}

/**
 * Публичная подпись адреса объявления (`listings.location`) — **без номера
 * дома**: дом и улица — «улица Красная», с пунктом, если он не город
 * объявления («улица Базовская, Яблоновский»; город OwnerCard допишет сам);
 * объект — его название («ЖК Панорама»), пункт — название пункта.
 */
export function publicLabel(hit: Pick<AddressHit, "kind" | "title" | "parts">, cityName: string): string {
  if (hit.kind === "poi" || hit.kind === "place") return hit.title;
  const place = hit.parts?.place ?? null;
  // Номер есть только в title дома, улица — в parts. У улицы title и есть
  // улица. Дом без улицы (адрес по пункту: «СНТ Кубаночка, 15») — пункт.
  const street = hit.parts?.street ?? (hit.kind === "street" ? hit.title : null);
  if (!street) return place ?? cityName;
  return place && place !== cityName ? `${street}, ${place}` : street;
}

/** Подпись точки геолокации по обратному геокодеру: дом и объект — адрес; улица и пункт — «рядом: …». */
export function reverseLabel(hit: Pick<AddressHit, "kind" | "title" | "parts"> | null, cityName: string): string | null {
  if (!hit) return null;
  if (hit.kind === "house" || hit.kind === "poi") return hitLabel(hit, cityName);
  return content.address.near(hitLabel(hit, cityName));
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

const clip = (s: string, max: number) => s.trim().slice(0, max).trim();

/**
 * Хит геокодера → колонки адреса объявления: полная подпись (может быть с
 * домом), публичная без дома, точка и её точность. Отказ: `coarse` — город или
 * округ целиком, `far` — дальше 40 км от центра города (другой край региона;
 * пункт внутри агломерации — нормально). Общая для формы (сервер,
 * src/server/listing-address.ts) и backfill сида (scripts/geo-backfill.ts).
 */
export function listingAddressOf(
  hit: Pick<AddressHit, "kind" | "title" | "subtitle" | "parts" | "precision" | "lat" | "lon">,
  city: { name: string; centre: GeoPoint | null },
): { ok: true; fields: ListingAddressFields } | { ok: false; reason: "coarse" | "far" } {
  const precision = listingPrecision(hit);
  if (!precision) return { ok: false, reason: "coarse" };
  if (city.centre && haversineKm(hit, city.centre) > LISTING_MAX_FROM_CENTRE_KM) return { ok: false, reason: "far" };
  return {
    ok: true,
    fields: {
      address: clip(hitLabel(hit, city.name), ADDRESS_MAX),
      location: clip(publicLabel(hit, city.name), LOCATION_MAX),
      lat: hit.lat,
      lon: hit.lon,
      geoPrecision: precision,
    },
  };
}

/** Свободный текст адреса (город без геоданных): точки нет, подпись — сам текст. */
export function textAddressOf(text: string): ListingAddressFields {
  const address = clip(text, ADDRESS_MAX);
  return { address, location: clip(address, LOCATION_MAX), lat: null, lon: null, geoPrecision: "city" };
}
