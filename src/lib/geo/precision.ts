// Точность точки: у адреса объявления (listings.geo_precision) и у точки
// «Где» покупателя одна шкала. Из неё — «≈» у расстояния и подпись под полем
// адреса. Таблица соответствия подсказок — docs/decisions/0021.

import { content } from "@theme/content";
import type { AddressHit } from "@/lib/geocoder/types";

/** Значения enum listing_geo_precision — тот же порядок от точного к грубому. */
export const GEO_PRECISIONS = ["house", "street", "place", "city"] as const;

/**
 * `house` — точка дома; `street` — до улицы («≈»); `place` — микрорайон,
 * посёлок, СНТ или объект вроде ЖК («≈»); `city` — точки нет (город без
 * геоданных или адрес не нашёлся), расстояния не считаются.
 */
export type GeoPrecision = (typeof GEO_PRECISIONS)[number];

/** Точность, с которой у объявления (или «Где») вообще есть точка. */
export type PointPrecision = Exclude<GeoPrecision, "city">;

// Подписи вида пункта из движка (KIND_LABEL в lib/geocoder/engine.ts): у
// хита-пункта подзаголовок начинается с вида — «город», «округ, Краснодар».
// Вида в самом хите нет, а мини-индекс и сервер подписывают одинаково.
const COARSE_KINDS = ["город", "округ", "район"];

/**
 * Город или округ целиком: площадь в десятки км. Расстояние до её центра —
 * ложное число среди настоящих, поэтому адресом объявления такой хит не
 * принимается, а в «Где» означает «весь город» без точки. Район (district)
 * — той же природы, хотя в данных Краснодара его нет.
 */
export function isCoarsePlace(hit: Pick<AddressHit, "kind" | "subtitle">): boolean {
  if (hit.kind !== "place") return false;
  const kind = hit.subtitle.split(",")[0].trim().toLowerCase();
  return COARSE_KINDS.includes(kind);
}

/**
 * Точность выбранной подсказки; null — город или округ, не принимается.
 *
 * Отличие от sravniprokat: объект (ЖК, ТЦ) там считался точным, здесь он
 * `place` — ЖК занимает квартал, и «до дома» про него было бы неправдой.
 */
export function listingPrecision(
  hit: Pick<AddressHit, "kind" | "precision" | "subtitle">,
): PointPrecision | null {
  if (isCoarsePlace(hit)) return null;
  if (hit.kind === "poi" || hit.kind === "place" || hit.precision === "place") return "place";
  if (hit.kind === "street" || hit.precision === "street") return "street";
  return "house";
}

/** Расстояние с «≈»: точка не дома. Точки нет вовсе (`city`) — тоже приблизительно. */
export function isApprox(p: GeoPrecision): boolean {
  return p !== "house";
}

/**
 * Подпись точности. `where` — короткая, в строке списка и под «Где»: у дома
 * её нет. `listing` — под полем адреса в форме: объясняет, что увидят
 * покупатели, в том числе у дома. Объект (`poi`) подписывается отдельно:
 * «≈ населённый пункт» про ЖК читался бы странно. Вид неизвестен (`kind` не
 * передан: сохранённый адрес, колонки вида нет) — подпись, верная для обоих.
 */
export function precisionNote(
  p: GeoPrecision | null, mode: "where" | "listing", kind?: AddressHit["kind"],
): string | null {
  if (p === null || p === "city") return null;
  const notes = content.address.note[mode];
  if (p === "house") return mode === "listing" ? content.address.note.listing.house : null;
  if (p === "place") return kind === "poi" ? notes.poi : kind ? notes.place : notes.area;
  return notes[p];
}
