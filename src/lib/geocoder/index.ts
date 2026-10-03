// Свой геокодер агломерации: поиск адреса в памяти по GeoIndexData (OSM + ГАР), без внешних сервисов.
// Подробности — README.md рядом.

export {
  createGeocoder, Engine, RANK, GEOCODE_MESSAGES,
  type Geocoder, type GeocodeOptions, type GeocodeResult, type GeocodeFailure, type ReverseOptions,
} from "./engine";
export { houseKey, displayHouse } from "./house-number";
export { tokenize } from "./query";
export type * from "./types";
export { buildClientIndex, createClientGeocoder, type ClientIndex, type ClientGeocoder } from "./client-index";
