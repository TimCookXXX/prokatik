// Контракт своего геокодера (адреса агломерации из OSM + ГАР ФНС, без внешних сервисов).
// Импорт (`pnpm geo:import`) пишет таблицы geo_places / geo_streets / geo_houses / geo_pois; сервер собирает из
// них GeoIndexData и держит поисковый индекс в памяти (src/lib/geocoder). Ответ подсказок — сразу с координатами.

/** Насколько точна точка адреса. */
export type AddrPrecision =
  | "house"         // точка дома: здание или адресный узел OSM
  | "interpolated"  // дом есть в ГАР, точка вычислена по соседним номерам той же чётности (в СНТ — подряд);
                    // у каждого номера своя точка на отрезке между соседями
  | "street"        // «≈» по улице: дом есть в ГАР, но соседей для интерполяции нет — своя точка по дальним
                    // соседям (корпус соседнего номера, вдоль линии улицы; медиана ~20–25 м), номер комплекса
                    // («8/39» из сотни «8/…») или представительная точка улицы
  | "place";        // только населённый пункт / микрорайон / СНТ

export type AddrSource = "osm" | "gar" | "osm+gar" | "manual";

export type PlaceKind = "city" | "town" | "village" | "hamlet" | "microdistrict" | "snt" | "district" | "okrug";

export interface IndexPlace {
  id: string;
  name: string;          // «Яблоновский», «Юбилейный», «СНТ Кубаночка»
  kind: PlaceKind;
  /** Как ещё пишут: «пгт Яблоновский», «ЮМР», «Юбилейка». */
  aliases: string[];
  /** Родитель: микрорайон → округ → город; посёлок, хутор или СНТ в черте города (Лазурный) → город. */
  parentId: string | null;
  lat: number;
  lon: number;
}

export interface IndexStreet {
  id: string;
  placeId: string | null;
  /** Каноническое название, как на табличке: «улица Красная», «Рождественская набережная». */
  name: string;
  /** Тип: улица, проспект, переулок, проезд, набережная, шоссе, бульвар, площадь, тупик, аллея, … */
  type: string;
  aliases: string[];
  lat: number;
  lon: number;
  /** Домов на улице — для ранжирования (крупные улицы выше при прочих равных). */
  houses: number;
  /**
   * Линия улицы — для обратного геокодирования («ближайшая улица» к точке, когда дома рядом нет): куски
   * [[lon, lat], …] из OSM, склеены и упрощены до ~3 м. Нет — у улицы нет линии в OSM (только дома / ГАР).
   */
  line?: [number, number][][];
}

export interface IndexHouse {
  streetId: string | null;  // null — адрес по населённому пункту (addr:place), без улицы
  placeId: string | null;
  /** Номер как пишут в адресе: «21к1», «7Б», «21/1», «12 стр. 2». */
  number: string;
  lat: number;
  lon: number;
  precision: AddrPrecision;
  source: AddrSource;
  postcode?: string | null;
}

export interface IndexPoi {
  id: string;
  /** «ТЦ Красная Площадь», «ЖК Панорама», «Кубанский государственный университет». */
  name: string;
  kind: string;
  aliases: string[];
  placeId: string | null;
  lat: number;
  lon: number;
  /** Адрес объекта, если известен: «улица Дзержинского, 100». */
  address?: string | null;
}

export interface GeoIndexData {
  version: string;       // например, дата выгрузок OSM и ГАР
  /** Ключ данных: в inrenta — регион геоданных (`cities.geo_region`), а не слаг города. Имя поля — из формата файла. */
  citySlug: string;
  builtAt: string;
  places: IndexPlace[];
  streets: IndexStreet[];
  houses: IndexHouse[];
  pois?: IndexPoi[];
}

/** Одна подсказка / результат геокодирования. */
export interface AddressHit {
  id: string;
  kind: "house" | "street" | "place" | "poi";
  /** Главная строка: «улица Базовская, 21к1». */
  title: string;
  /** Уточнение: «пгт Яблоновский» / «Краснодар, Юбилейный». */
  subtitle: string;
  lat: number;
  lon: number;
  precision: AddrPrecision;
  score: number;
  /** Части адреса (для CSV-импорта и замера): пункт, улица, номер дома. Номера нет — дом не найден точно. */
  parts?: { place: string | null; street: string | null; house: string | null };
  /**
   * Населённые пункты адреса (Geocoder.settlementOf): по нему адрес объявления относится к городу сервиса. Есть
   * у подсказок, прошедших через сервер и мини-индекс браузера; сам движок его не дописывает.
   */
  settlement?: HitSettlement;
}

/**
 * Населённые пункты адреса — от своего к верхнему: «СНТ Кубаночка» → «Краснодар», посёлок в черте города →
 * город. Микрорайоны и округа не входят: их пункт — город. Точка — центр верхнего пункта.
 */
export interface HitSettlement {
  names: string[];
  /** Виды пунктов `names`, по одному на имя: СНТ в подписи адреса называется вместе с пунктом над ним. */
  kinds: PlaceKind[];
  lat: number;
  lon: number;
}

export interface SuggestOptions {
  limit?: number;
  /** Точка, рядом с которой пользователь (или центр города) — при прочих равных ближе выше. */
  near?: { lat: number; lon: number } | null;
}
