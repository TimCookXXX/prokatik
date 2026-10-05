// Гео-контекст города: по нему клиент и сервер понимают, есть ли у города
// адреса и где его центр. Собирает src/server/city.ts (getCitiesGeo) без
// загрузки движка геокодера.

import type { GeoPoint } from "./point";

export interface CityGeoContext {
  /** Регион геоданных (cities.geo_region): у города и его пригородов один. */
  region: string;
  /** Центр города (cities.lat/lon) — `near` подсказок адресов по умолчанию. */
  centre: GeoPoint;
  /** Метка версии данных региона — для ссылки на мини-индекс (?v=). */
  token: string;
}
