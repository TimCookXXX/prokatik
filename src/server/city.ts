// Какой город показывать там, где его нет в адресе: главная, поиск без ?city=,
// шапка, таб-бар, форма нового объявления.
//
// До этого модуля «город по умолчанию» считался в четырёх местах отдельно и
// везде означал «первый активный по алфавиту» — заведи Архангельск, и витрина
// переехала бы туда. Здесь он один, и у него есть предпочтение человека.
//
// Само правило приоритетов живёт чистой функцией в lib (pickCitySlug) и там же
// тестируется; этот модуль только собирает для неё входы.

import { cookies } from "next/headers";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cities, geoImports, users } from "@db/schema";
import { auth } from "@/lib/auth";
import { pickCitySlug } from "@/lib/catalog/current-city";
import { CITY_COOKIE } from "@/lib/catalog/city-cookie";
import type { CityGeoContext } from "@/lib/geo/context";
import { parseLocation } from "@/lib/geo/location";
import { singleCityScope, type CityScope } from "@/lib/catalog/city-scope";
import { getActiveCities, type City } from "@/server/catalog";
import { geoDataToken, isoSeconds } from "@/server/geocoder-index";

async function cookieCitySlug(): Promise<string | undefined> {
  return (await cookies()).get(CITY_COOKIE)?.value;
}

// Город из профиля. Отдельным запросом, а не через сессию: в сессии его нет, и
// тащить туда поле ради одной строки в шапке не стоит.
async function profileCitySlug(): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user?.id) return undefined;

  const rows = await getDb()
    .select({ slug: cities.slug })
    .from(users)
    .innerJoin(cities, eq(cities.id, users.cityId))
    .where(eq(users.id, session.user.id))
    .limit(1);
  return rows[0]?.slug;
}

function bySlug(active: City[], slug: string | undefined): City | null {
  return active.find((c) => c.slug === slug) ?? null;
}

/**
 * Город для просмотра: кука → мой город → первый активный.
 *
 * Кука вперёд профиля, потому что она отвечает на вопрос «где я сейчас смотрю»,
 * и это более свежее намерение, чем «где я живу».
 */
export async function resolveViewerCity(): Promise<City | null> {
  const active = await getActiveCities();
  if (active.length === 0) return null;

  // Короткое замыкание на куке: в типичном запросе профиль не нужен, и лишнего
  // auth() с походом в users не случается. Резолвер зовёт корневой layout, то
  // есть он в каждом рендере публичной страницы.
  const fromCookie = bySlug(active, await cookieCitySlug());
  if (fromCookie) return fromCookie;

  const slug = pickCitySlug([await profileCitySlug()], active.map((c) => c.slug));
  return bySlug(active, slug);
}

/**
 * Город для формы нового объявления: мой город → кука → первый активный.
 *
 * Порядок обратный: вещь лежит там, где человек живёт, а не там, где он сейчас
 * листает чужой город. В городе с геоданными это лишь регион поиска адреса —
 * город объявления определит сам адрес.
 */
export async function resolveOwnCity(): Promise<City | null> {
  const active = await getActiveCities();
  if (active.length === 0) return null;

  const slug = pickCitySlug(
    [await profileCitySlug(), await cookieCitySlug()],
    active.map((c) => c.slug),
  );
  return bySlug(active, slug);
}

// ------------------------------------------------------------------ геоданные

export const CITIES_GEO_TTL_MS = 60_000;

interface CitiesGeoCache {
  at: number;
  map: ReadonlyMap<string, CityGeoContext | null>;
}

// На globalThis, как кэши поиска и геокодера: шапка, роуты /api/geo/* и
// actions живут в разных бандлах, а кэш нужен один.
const G = globalThis as { __inrentaCitiesGeo?: CitiesGeoCache };

/**
 * Гео-контекст активных городов по слагу; null — у города геоданных нет
 * (geo_region пуст, импорта региона нет или не задан центр), и «Где» у него не
 * рисуется. Зовётся на каждой странице (шапка), поэтому движок геокодера не
 * загружает: метка берётся из geo_imports. Кэш — 60 с; правки городов в
 * админке сбрасывают его сразу.
 *
 * Ошибка чтения не роняет страницу: геоданные просто выключены до следующего
 * запроса (ошибка не кэшируется). `strict` — для /api/geo/*: там ошибка уходит
 * наверх, и роут отвечает некэшируемым 503, а не кэшируемым «адресов нет».
 */
export async function getCitiesGeo(
  opts: { strict?: boolean } = {},
): Promise<ReadonlyMap<string, CityGeoContext | null>> {
  const hit = G.__inrentaCitiesGeo;
  if (hit && Date.now() - hit.at < CITIES_GEO_TTL_MS) return hit.map;

  try {
    const db = getDb();
    const [rows, imports] = await Promise.all([
      db.select({ slug: cities.slug, lat: cities.lat, lon: cities.lon, geoRegion: cities.geoRegion })
        .from(cities)
        .where(eq(cities.isActive, true)),
      // Последний импорт каждого региона (строка на регион, но порядок по id
      // держит правило «последний» и без этого допущения).
      db.selectDistinctOn([geoImports.region], {
        region: geoImports.region, version: geoImports.version, builtAt: geoImports.builtAt,
      })
        .from(geoImports)
        .orderBy(asc(geoImports.region), desc(geoImports.id)),
    ]);

    const tokens = new Map(imports.map((i) => [
      i.region, geoDataToken(i.region, { version: i.version, builtAt: isoSeconds(i.builtAt) }),
    ]));
    const map = new Map<string, CityGeoContext | null>();
    for (const c of rows) {
      const token = c.geoRegion ? tokens.get(c.geoRegion) : undefined;
      map.set(c.slug, token && c.lat !== null && c.lon !== null
        ? { region: c.geoRegion!, centre: { lat: c.lat, lon: c.lon }, token }
        : null);
    }
    G.__inrentaCitiesGeo = { at: Date.now(), map };
    return map;
  } catch (e) {
    if (opts.strict) throw e;
    console.error("[geo] cities geo context failed:", (e as Error).message);
    return new Map();
  }
}

/** Сброс кэша гео-контекста: правка города в админке, тесты. */
export function invalidateCitiesGeo(): void {
  G.__inrentaCitiesGeo = undefined;
}

// ------------------------------------------------------------ города выдачи

/**
 * Активные города региона геоданных: точка «Где» снимает границу города, и
 * выдача идёт по всем им (Краснодар и Яблоновский — один регион). Берётся из
 * того же закэшированного на запрос списка, что и шапка: лишнего запроса нет.
 */
export async function getRegionCityIds(region: string): Promise<string[]> {
  return (await getActiveCities()).filter((c) => c.geoRegion === region).map((c) => c.id);
}

/**
 * Набор городов и точка «Где» для страницы города, раздела или /search. Город
 * при этом не меняется — ни в адресе, ни в куке: «Где» лишь расширяет выдачу
 * до региона. В городе без геоданных точка не действует вовсе: у объявлений
 * там нет точек, и «Где» на такой странице не рисуется.
 */
export async function getCityScope(
  city: Pick<City, "id" | "slug">,
  sp: { loc?: string; la?: string; src?: string; lp?: string },
): Promise<CityScope> {
  const geo = (await getCitiesGeo()).get(city.slug) ?? null;
  const near = geo ? parseLocation(sp) : null;
  if (!geo || !near) return singleCityScope(city.id, geo !== null);
  const cityIds = [city.id, ...(await getRegionCityIds(geo.region)).filter((id) => id !== city.id)];
  return { region: true, near, cityIds, nearby: cityIds.length > 1 };
}
