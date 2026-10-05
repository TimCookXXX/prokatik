// «Где» покупателя в адресе страницы. Кодек тот же, что в sravniprokat, но
// только для точки — справочника районов и округов здесь нет:
//
//   loc=p:45.035,38.975   точка (адрес или геолокация)
//   la=<подпись>          что показать в поле «Где»
//   src=geo               точка из геолокации, а не из адреса
//   lp=s | t              точка до улицы | до места (ЖК, посёлок); нет — дом
//
// `d:`/`o:` и любой мусор — «без точки»: город целиком, расстояний нет.
// Точка пишется с тремя знаками (≈ 100 м, docs/decisions/0021): адрес страницы
// уезжает в «поделиться», историю и Метрику, и дом в нём не нужен.

import type { GeoPoint } from "./point";
import type { PointPrecision } from "./precision";

export interface UserPoint {
  point: GeoPoint;
  /** Подпись поля «Где»; null — подписи нет (старая ссылка). */
  label: string | null;
  source: "address" | "geo";
  /** `house` — точная точка; `street`/`place` — расстояния с «≈». */
  precision: PointPrecision;
}

/** Параметры «Где» в адресе — то, что пишет locationQuery. */
export interface LocationQuery {
  loc: string;
  la?: string;
  src?: "geo";
  lp?: "s" | "t";
}

/** Знаков после запятой у точки в адресе: 3 — около 100 м. */
export const LOCATION_DECIMALS = 3;
/** Длина подписи `la`: дальше обрезается, как поле адреса. */
export const LOCATION_LABEL_MAX = 120;
/**
 * Точность геолокации, после которой точка считается приблизительной (`lp=s`):
 * десктоп по Wi-Fi или IP промахивается на сотни метров, и «350 м» до вещи
 * было бы ложной точностью.
 */
export const GEOLOCATION_EXACT_M = 150;

const POINT_RE = /^(-?\d{1,2}\.\d{1,6}),(-?\d{1,3}\.\d{1,6})$/;

/** Значение параметра адреса: повторённый ключ Next отдаёт массивом. */
type RawParam = string | string[] | null | undefined;

/** Первое строковое значение параметра; всё остальное — пустая строка. */
function first(v: RawParam): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s.trim() : "";
}

/** Точка «Где» из параметров адреса; null — точки нет (пусто, мусор, `d:`/`o:`). */
export function parseLocation(
  raw: { loc?: RawParam; la?: RawParam; src?: RawParam; lp?: RawParam },
): UserPoint | null {
  const v = first(raw.loc);
  if (!v.startsWith("p:")) return null;
  const m = POINT_RE.exec(v.slice(2));
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  const lp = first(raw.lp);
  return {
    point: { lat, lon },
    label: first(raw.la).slice(0, LOCATION_LABEL_MAX) || null,
    source: first(raw.src) === "geo" ? "geo" : "address",
    // Старые ссылки без lp — дом, как в sravniprokat.
    precision: lp === "s" ? "street" : lp === "t" ? "place" : "house",
  };
}

/** Параметры адреса для точки «Где»: точка округляется до LOCATION_DECIMALS знаков. */
export function locationQuery(p: UserPoint): LocationQuery {
  const q: LocationQuery = {
    loc: `p:${p.point.lat.toFixed(LOCATION_DECIMALS)},${p.point.lon.toFixed(LOCATION_DECIMALS)}`,
  };
  const label = p.label?.trim().slice(0, LOCATION_LABEL_MAX);
  if (label) q.la = label;
  if (p.source === "geo") q.src = "geo";
  if (p.precision === "street") q.lp = "s";
  else if (p.precision === "place") q.lp = "t";
  return q;
}

/**
 * Точка из геолокации браузера. Подпись — от обратного геокодера, без номера
 * дома (её даёт вызывающий): в адресе страницы дом не нужен. Точность хуже
 * GEOLOCATION_EXACT_M — расстояния приблизительные (`lp=s`).
 */
export function geolocationPoint(
  coords: { latitude: number; longitude: number; accuracy?: number | null },
  label: string | null,
): UserPoint {
  const rough = coords.accuracy != null && coords.accuracy > GEOLOCATION_EXACT_M;
  return {
    point: { lat: coords.latitude, lon: coords.longitude },
    label,
    source: "geo",
    precision: rough ? "street" : "house",
  };
}
