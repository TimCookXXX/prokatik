// Ответ /api/listings/nearby — полоса «Рядом с вами» на главной. Общий тип
// роута и клиента. Наружу — только подпись расстояния: ни километров числом,
// ни точки, ни адреса объявления (docs/decisions/0021).

/** Сколько карточек в полосе. */
export const NEARBY_LIMIT = 8;

export interface NearbyItem {
  id: string;
  title: string;
  priceDay: number;
  /** Канонический путь карточки без query: «Где» дописывает клиент. */
  href: string;
  photoUrl: string | null;
  /** «≈ 3 км», «1,2 км», «350 м». */
  distanceLabel: string;
  distanceTitle: string;
}

export interface NearbyResponse {
  items: NearbyItem[];
}
