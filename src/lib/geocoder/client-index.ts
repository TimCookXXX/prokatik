// Клиентский мини-индекс: улицы, пункты и объекты (без домов) — чтобы подсказки «Где» появлялись в браузере
// мгновенно, без запроса к серверу. Дома догружаются с сервера (/api/geo/suggest).
//
// Сервер:  buildClientIndex(data) → компактный JSON (≈ 250 КБ gzip, 0,8 МБ без сжатия на агломерацию), отдаётся со своим ETag
//          по версии данных (ClientIndex.version).
// Браузер: createClientGeocoder(json).suggest(q, { near }) — тот же движок (engine.ts), та же нормализация
//          (text.ts, query.ts) и те же веса, что на сервере; разница только в том, что домов нет:
//          «Красная 12» на клиенте — подсказка «улица Красная» (точка улицы), дом приходит с сервера.
//
// Ранжирование совпадает с серверным, потому что вместе с названиями приходят посчитанные по домам величины:
// число домов улицы, пункт большинства её домов, радиус застройки и число домов пунктов (index-build.ts, Precomputed).

import { Engine, type Geocoder } from "./engine";
import { buildIndex, type SearchIndex } from "./index-build";
import type { AddressHit, GeoIndexData, IndexPlace, IndexPoi, IndexStreet, PlaceKind, SuggestOptions } from "./types";

/**
 * Условия данных мини-индекса. Это выборка из адресной базы, производной от OSM (OSM сведён с ГАР в одном
 * слое), и её публичная раздача — распространение производной базы: ODbL 4.3–4.4 требуют ту же лицензию
 * и уведомление прямо в данных. Страница /sources — то же для людей.
 */
export const CLIENT_INDEX_LICENSE = "ODbL-1.0 (https://opendatacommons.org/licenses/odbl/1-0/)";
export const CLIENT_INDEX_ATTRIBUTION =
  "© участники OpenStreetMap (https://www.openstreetmap.org/copyright); адреса: ГАР ФНС России, открытые данные (https://fias.nalog.ru/)";

/** Формат мини-индекса. Координаты — 5 знаков (≈ 1 м). Пустые псевдонимы не пишутся. */
export interface ClientIndex {
  v: 1;
  /** Лицензия выборки (ODbL) и источники — обязательны при публичной раздаче. */
  license: string;
  attribution: string;
  version: string;
  citySlug: string;
  /** Словарь типов улиц и видов объектов — в записях номер. */
  types: string[];
  poiKinds: string[];
  /** [название, вид, родитель | −1, lat, lon, радиус застройки км, домов, псевдонимы?] */
  places: [string, PlaceKind, number, number, number, number, number, string[]?][];
  /** [название, тип (номер в types), пункт | −1, lat, lon, домов, пункт большинства домов | −1, псевдонимы?] */
  streets: [string, number, number, number, number, number, number, string[]?][];
  /** [название, вид (номер в poiKinds), пункт | −1, lat, lon, адрес | null, псевдонимы?] */
  pois: [string, number, number, number, number, string | null, string[]?][];
}

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Мини-индекс из полных данных (или уже собранного поискового индекса — чтобы не собирать дважды). */
export function buildClientIndex(data: GeoIndexData, built?: SearchIndex): ClientIndex {
  const ix = built ?? buildIndex(data);
  const types: string[] = [];
  const typeId = new Map<string, number>();
  const tid = (t: string, list: string[], map: Map<string, number>) => {
    let id = map.get(t);
    if (id === undefined) {
      id = list.length;
      list.push(t);
      map.set(t, id);
    }
    return id;
  };
  const poiKinds: string[] = [];
  const poiKindId = new Map<string, number>();
  const withAliases = <T extends unknown[]>(row: T, aliases: string[]): T | [...T, string[]] => (aliases.length ? [...row, aliases] : row);
  return {
    v: 1,
    license: CLIENT_INDEX_LICENSE,
    attribution: CLIENT_INDEX_ATTRIBUTION,
    version: data.version,
    citySlug: data.citySlug,
    types,
    poiKinds,
    places: data.places.map((p, i) => withAliases(
      [p.name, p.kind, ix.places[i].parent, r5(p.lat), r5(p.lon), r2(ix.places[i].radiusKm), ix.places[i].houses] as [string, PlaceKind, number, number, number, number, number],
      p.aliases,
    )) as ClientIndex["places"],
    streets: data.streets.map((s, i) => withAliases(
      [s.name, tid(s.type, types, typeId), ix.streets[i].place, r5(s.lat), r5(s.lon), ix.streets[i].houses, ix.streets[i].area] as [string, number, number, number, number, number, number],
      s.aliases,
    )) as ClientIndex["streets"],
    pois: (data.pois ?? []).map((p, i) => withAliases(
      [p.name, tid(p.kind, poiKinds, poiKindId), ix.pois[i].place, r5(p.lat), r5(p.lon), p.address ?? null] as [string, number, number, number, number, string | null],
      p.aliases,
    )) as ClientIndex["pois"],
  };
}

/** Подсказки в браузере по мини-индексу: улицы, пункты, объекты. */
export interface ClientGeocoder {
  suggest(q: string, opts?: SuggestOptions): AddressHit[];
  readonly version: string;
}

/** Мини-индекс → движок (тот же, что на сервере). Сборка ≈ 190 мс на M-серии, на телефоне до секунды — в браузере только в Web Worker (geo-worker.ts). */
export function createClientGeocoder(ci: ClientIndex): ClientGeocoder {
  const places: IndexPlace[] = ci.places.map(([name, kind, parent, lat, lon, , , aliases], i) => ({
    id: `p${i}`, name, kind, aliases: aliases ?? [], parentId: parent >= 0 ? `p${parent}` : null, lat, lon,
  }));
  const streets: IndexStreet[] = ci.streets.map(([name, type, place, lat, lon, houses, , aliases], i) => ({
    id: `s${i}`, placeId: place >= 0 ? `p${place}` : null, name, type: ci.types[type] ?? "", aliases: aliases ?? [], lat, lon, houses,
  }));
  const pois: IndexPoi[] = ci.pois.map(([name, kind, place, lat, lon, address, aliases], i) => ({
    id: `o${i}`, name, kind: ci.poiKinds[kind] ?? "", aliases: aliases ?? [], placeId: place >= 0 ? `p${place}` : null, lat, lon, address,
  }));
  const data: GeoIndexData = { version: ci.version, citySlug: ci.citySlug, builtAt: "", places, streets, houses: [], pois };
  const ix = buildIndex(data, {
    streetHouses: ci.streets.map((s) => s[5]),
    streetArea: ci.streets.map((s) => s[6]),
    placeRadiusKm: ci.places.map((p) => p[5]),
    placeHouses: ci.places.map((p) => p[6]),
  });
  const engine = new Engine(ix);
  return {
    version: ci.version,
    // id с «c» — подсказка из мини-индекса (у сервера свои id); сверять с серверными — по title и subtitle.
    // Пункты — по своему id, до префикса: по ним форма объявления показывает город, к которому отойдёт адрес.
    suggest: (q, opts) => engine.suggest(q, opts).map((h) => withSettlement(engine, { ...h, id: `c${h.id}` }, h.id)),
  };
}

/** Подсказка с населёнными пунктами (Geocoder.settlementOf); `id` — id этого движка, если у подсказки уже другой. */
export function withSettlement(g: Pick<Geocoder, "settlementOf">, hit: AddressHit, id = hit.id): AddressHit {
  const settlement = g.settlementOf({ id, lat: hit.lat, lon: hit.lon });
  return settlement ? { ...hit, settlement } : hit;
}
