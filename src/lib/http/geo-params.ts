// Общие параметры /api/geo/*: город и точка. Мусор — null: роут отвечает 400.

import type { GeoPoint } from "@/lib/geo/point";

/** Слаг города из запроса (формат slugify); нет или мусор — null. */
export function parseCity(raw: string | null): string | null {
  return raw && /^[a-z0-9-]{1,80}$/.test(raw) ? raw : null;
}

function coord(lat: number, lon: number): GeoPoint | null {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon }
    : null;
}

/** «45.03,38.97» → точка; нет или мусор — null. */
export function parseNear(raw: string | null): GeoPoint | null {
  const m = raw ? /^(-?\d{1,2}(?:\.\d{1,7})?),(-?\d{1,3}(?:\.\d{1,7})?)$/.exec(raw) : null;
  return m ? coord(Number(m[1]), Number(m[2])) : null;
}

/** lat и lon отдельными параметрами. */
export function parsePoint(lat: string | null, lon: string | null): GeoPoint | null {
  const re = /^-?\d{1,3}(?:\.\d{1,8})?$/;
  return lat && lon && re.test(lat) && re.test(lon) ? coord(Number(lat), Number(lon)) : null;
}
