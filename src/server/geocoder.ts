// Свой геокодер (адреса OSM + ГАР ФНС, без внешних сервисов): подсказки
// адресов, обратное геокодирование «Моё местоположение» и мини-индекс для
// браузера. Поиск — src/lib/geocoder (README там), данные —
// src/server/geocoder-index.ts.
//
// Движок — один на процесс и регион геоданных: Краснодар и Яблоновский
// спрашивают один и тот же. Строится лениво при первом запросе к /api/geo/*
// (≈ 0,4 с поверх чтения таблиц) и пересобирается, когда сменились данные.
// Рендер страниц его не трогает: странице хватает метки из geo_imports
// (getCitiesGeo). Функции принимают слаг города: регион и центр берутся из
// его гео-контекста. Город без геоданных — «не умею» ([] / null).

import { buildClientIndex, Engine, type Geocoder } from "@/lib/geocoder";
import { buildIndex } from "@/lib/geocoder/index-build";
import type { AddressHit, GeoIndexData } from "@/lib/geocoder/types";
import type { GeoPoint } from "@/lib/geo/point";
import type { CityGeoContext } from "@/lib/geo/context";
import { geoDataToken, getGeoIndexData } from "@/server/geocoder-index";
import { getCitiesGeo } from "@/server/city";

interface RegionEngine {
  geocoder: Geocoder;
  /** Метка данных для ETag и ссылки на мини-индекс — та же, что в getCitiesGeo. */
  token: string;
  /** Мини-индекс браузера (JSON, ≈ 0,9 МБ; gzip ≈ 0,25 МБ). */
  clientJson: string;
}

// Движки по объекту данных (getGeoIndexData отдаёт один объект, пока версия та
// же). На globalThis, как и кэш данных: в dev модуль перезагружается при
// правке, а кэш данных — нет, и движок должен найтись снова (дома из данных уже
// отпущены — второй раз его не собрать).
const G = globalThis as { __inrentaGeoEngines?: WeakMap<GeoIndexData, RegionEngine> };
const engines = (): WeakMap<GeoIndexData, RegionEngine> => (G.__inrentaGeoEngines ??= new WeakMap());

/** Движок региона: тот же объект, пока данные не сменились. null — импорта нет. */
export async function getRegionGeocoder(region: string): Promise<RegionEngine | null> {
  const data = await getGeoIndexData(region);
  if (!data) return null;
  const cur = engines().get(data);
  if (cur) return cur;
  // Сборка синхронная: параллельный запрос, дождавшийся тех же данных, увидит готовый движок.
  const ix = buildIndex(data);
  const engine: RegionEngine = {
    geocoder: new Engine(ix),
    token: geoDataToken(region, data),
    clientJson: JSON.stringify(buildClientIndex(data, ix)),
  };
  // Дома нужны только для сборки: движок держит их в своих массивах, мини-индекс —
  // без домов. Отпускаем объекты домов из кэша данных — это ≈ 120 МБ кучи из ≈ 175;
  // при новом импорте данные перечитываются целиком (новый объект — новый движок).
  data.houses = [];
  engines().set(data, engine);
  return engine;
}

/** Сброс движков (тесты). */
export function resetGeocoderEngines(): void {
  G.__inrentaGeoEngines = new WeakMap();
}

/**
 * Гео-контекст города; null — город неактивен или геоданных у него нет. Сбой
 * БД — исключение, а не null: роут ответит 503, а не закэшированной пустотой.
 */
async function cityGeo(citySlug: string): Promise<CityGeoContext | null> {
  return (await getCitiesGeo({ strict: true })).get(citySlug) ?? null;
}

// ------------------------------------------------------------------ подсказки и обратный геокодер

export const SUGGEST_LIMIT = 7;

/**
 * Подсказки адресов — сразу с координатами и точностью. Без `near` ранжирует от
 * центра города: иначе движок взял бы центр самого крупного пункта региона, и
 * в Яблоновском «Гагарина 1» уезжала бы в Краснодар.
 */
export async function suggestAddresses(
  q: string, citySlug: string, opts: { near?: GeoPoint | null; limit?: number } = {},
): Promise<AddressHit[]> {
  const text = q.trim();
  if (text.length < 2) return [];
  const geo = await cityGeo(citySlug);
  if (!geo) return [];
  const engine = await getRegionGeocoder(geo.region);
  if (!engine) return [];
  return engine.geocoder
    .suggest(text, { limit: opts.limit ?? SUGGEST_LIMIT, near: opts.near ?? geo.centre })
    .map(slimHit);
}

/** Точка → ближайший адрес: дом ≤ 60 м, иначе улица, иначе населённый пункт; далеко от всего — null. */
export async function reverseGeocode(p: GeoPoint, citySlug: string): Promise<AddressHit | null> {
  const geo = await cityGeo(citySlug);
  if (!geo) return null;
  const engine = await getRegionGeocoder(geo.region);
  const hit = engine?.geocoder.reverse(p.lat, p.lon) ?? null;
  return hit ? slimHit(hit) : null;
}

/** Мини-индекс браузера (улицы, пункты, объекты — без домов) и его метка; null — адресов нет. */
export async function clientIndexJson(citySlug: string): Promise<{ json: string; token: string } | null> {
  const geo = await cityGeo(citySlug);
  if (!geo) return null;
  const engine = await getRegionGeocoder(geo.region);
  return engine ? { json: engine.clientJson, token: engine.token } : null;
}

/** В ответ API — без внутренней оценки; координаты — до 6 знаков (≈ 0,1 м). */
function slimHit(h: AddressHit): AddressHit {
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return { ...h, lat: r6(h.lat), lon: r6(h.lon), score: Math.round(h.score * 10) / 10 };
}
