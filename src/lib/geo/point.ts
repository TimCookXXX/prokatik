// Точка на карте и расстояние по прямой. Общие для геокодера, «Где» и
// расстояния в выдаче: SQL-выражение `distanceKm` считает ту же формулу.

export interface GeoPoint {
  lat: number;
  lon: number;
}

const EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

/** Расстояние по прямой (гаверсинус), км. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}
