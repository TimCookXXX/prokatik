// Адрес получения объявления: что из присланного формой записать в
// listings.address / location / lat / lon / geo_precision (docs/decisions/0021).
// Зовётся из createListing и updateListing после проверки владельца.
//
// Браузеру не доверяем ни координаты, ни id подсказки: у мини-индекса свои id
// (`cs0`, `cp3`), у сервера — `s:…`, `h:…`, и после переимпорта они меняются.
// Сервер находит тот же адрес у себя — по виду, тексту и точке не дальше 50 м
// (sameHit) — и пишет всё из своего хита.
//
// Город объявления у выбранного адреса определяет сам адрес, а не форма:
// город формы для `pick` — только регион, где искать. ЖК в Краснодаре не
// попадёт в Яблоновский, а Козет или Новая Адыгея (не города сервиса) отойдут
// ближайшему городу региона (listingCityOf).

import { content } from "@theme/content";
import type { AddressHit } from "@/lib/geocoder/types";
import type { CityGeoContext } from "@/lib/geo/context";
import {
  listingAddressOf, listingCityOf, sameHit, textAddressOf, type ListingAddressFields,
} from "@/lib/geo/address";
import type { GeoPrecision } from "@/lib/geo/precision";
import type { ListingAddressInput, PickedAddress } from "@/lib/owner/validation";
import { getActiveCities, getCityById, type City } from "@/server/catalog";
import { getCitiesGeo } from "@/server/city";
import { getRegionGeocoder } from "@/server/geocoder";

const T = content.address.listing;

/** Кандидатов из подсказок сервера: выбранный хит обязан найтись среди них. */
const CANDIDATES = 10;

/** Что уже записано у объявления — для `keep`. */
export interface StoredAddress {
  cityId: string;
  address: string | null;
  geoPrecision: GeoPrecision;
}

/**
 * `fields: null` — адрес не трогать вовсе (`keep`): ни одна из пяти колонок не
 * пишется, и сохранённая точка переживает и правку цены, и переимпорт
 * геоданных, и недоступность геокодера. `cityId` — город объявления для
 * записи: у `pick` — город адреса, у `keep` и `text` — город формы.
 */
export type AddressResolution =
  | { ok: true; fields: ListingAddressFields | null; cityId: string }
  | { ok: false; error: string };

const fail = (error: string): AddressResolution => ({ ok: false, error });

/**
 * Адрес объявления из формы → колонки для записи или отказ словами.
 *
 * - `keep`: только у строки, где адрес уже есть, и без смены города. Строка
 *   без точки (`city`) в городе с геоданными «оставить» не может — это legacy
 *   или ненайденный при backfill адрес, кабинет просит его уточнить.
 * - `text`: только в городе без геоданных; точки нет.
 * - `pick`: в городе с геоданными; всё — из хита, найденного сервером заново,
 *   и город тоже: присланный `cityId` задаёт лишь регион поиска.
 */
export async function resolveListingAddress(
  input: ListingAddressInput,
  ctx: { cityId: string; current: StoredAddress | null },
): Promise<AddressResolution> {
  if (input.mode === "keep") return keep(ctx.cityId, ctx.current);

  const city = await getCityById(ctx.cityId);
  if (!city) return fail("Выберите город");

  // Сбой чтения — отказ, а не «у города геоданных нет»: иначе упавший запрос
  // молча пропустил бы адрес текстом без точки.
  let citiesGeo: ReadonlyMap<string, CityGeoContext | null>;
  try {
    citiesGeo = await getCitiesGeo({ strict: true });
  } catch (e) {
    console.error("[listing-address] cities geo failed:", (e as Error).message);
    return fail(T.unavailable);
  }
  const geo = citiesGeo.get(city.slug) ?? null;

  if (input.mode === "text") {
    // В городе с геоданными адрес — только из подсказок: текст без точки
    // лишил бы покупателей расстояния до вещи.
    if (geo) return fail(T.pickFromList);
    return { ok: true, fields: textAddressOf(input.text), cityId: city.id };
  }

  // Подсказка из города, у которого геоданных нет (выключены аварийно, пока
  // форма была открыта, или импорт ещё не прошёл), — проверить её нечем.
  if (!geo) return fail(T.unavailable);
  return pick(input, geo, citiesGeo);
}

async function keep(cityId: string, current: StoredAddress | null): Promise<AddressResolution> {
  if (!current || current.address === null || current.cityId !== cityId) return fail(T.required);
  const kept: AddressResolution = { ok: true, fields: null, cityId };
  if (current.geoPrecision !== "city") return kept;

  // Точки нет: уточнять есть смысл, только если у города есть геоданные. Сбой
  // чтения правку не блокирует (getCitiesGeo без strict вернёт пустоту) —
  // keep колонок адреса всё равно не трогает.
  const city = await getCityById(cityId);
  const geo = city ? (await getCitiesGeo()).get(city.slug) ?? null : null;
  return geo ? fail(T.required) : kept;
}

/**
 * Города, к которым может отойти адрес региона: активные, с геоданными этого
 * региона (у них есть центр). Город формы среди них всегда — он и задал регион.
 */
async function regionCities(region: string, citiesGeo: ReadonlyMap<string, CityGeoContext | null>) {
  return (await getActiveCities()).flatMap((c: City) => {
    const geo = citiesGeo.get(c.slug);
    return geo?.region === region ? [{ id: c.id, name: c.name, nameLocative: c.nameLocative, centre: geo.centre }] : [];
  });
}

async function pick(
  input: PickedAddress, geo: CityGeoContext, citiesGeo: ReadonlyMap<string, CityGeoContext | null>,
): Promise<AddressResolution> {
  let engine: Awaited<ReturnType<typeof getRegionGeocoder>>;
  try {
    engine = await getRegionGeocoder(geo.region);
  } catch (e) {
    console.error("[listing-address] geocoder failed:", (e as Error).message);
    return fail(T.unavailable);
  }
  if (!engine) return fail(T.unavailable);

  // Кандидаты — подсказки рядом с присланной точкой на полный текст и на один
  // заголовок, плюс обратный геокодер этой точки: так находится и хит
  // мини-индекса (улица, пункт, объект), и дом из ответа сервера. Один
  // заголовок нужен объекту: его подзаголовок — адрес («улица Первомайская,
  // 4ак7»), и по полному тексту дома той улицы вытесняют сам ЖК из десятки.
  const near = { lat: input.lat, lon: input.lon };
  const g = engine.geocoder;
  const candidates: AddressHit[] = [
    ...g.suggest(`${input.title} ${input.subtitle}`, { near, limit: CANDIDATES }),
    ...g.suggest(input.title, { near, limit: CANDIDATES }),
  ];
  const back = g.reverse(input.lat, input.lon);
  if (back) candidates.push(back);

  const found = candidates.find((h) => sameHit(input, h));
  if (!found) return fail(T.pickFromList);

  // Город — по пункту адреса из данных сервера, а не по городу формы.
  const hit = { ...found, settlement: g.settlementOf(found) ?? undefined };
  const city = listingCityOf(hit.settlement, hit, await regionCities(geo.region, citiesGeo));
  if (!city) return fail(T.unavailable);

  const res = listingAddressOf(hit, city);
  if (!res.ok) return fail(res.reason === "coarse" ? content.address.tooCoarse : T.tooFar);
  return { ok: true, fields: res.fields, cityId: city.id };
}
