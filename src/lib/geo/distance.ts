// Подпись расстояния до вещи: карточка выдачи и OwnerCard. Расстояние по
// прямой (SQL distanceKm в src/server/catalog.ts) — минут в пути и дорожных км
// нет (docs/decisions/0021), поэтому у подписи title «по прямой».

import { content } from "@theme/content";

/** title у подписи расстояния. */
export const DISTANCE_TITLE = content.search.distanceTitle;

/**
 * «≈ 3 км» — хоть одна точка не дом (approx); точно: «400 м», «1,2 км», «14 км».
 * Метры — с шагом 100 и не меньше 100: точнее точка покупателя (3 знака) не
 * знает. Порог считается по округлённому значению — 0,97 км это «1 км», а не
 * «1000 м».
 */
export function distanceLabel(km: number, approx: boolean): string {
  if (approx) return `≈ ${Math.max(1, Math.round(km))} км`;
  const tenths = Math.round(km * 10);
  if (tenths < 10) return `${Math.max(100, tenths * 100)} м`;
  if (tenths < 100) return `${(tenths / 10).toLocaleString("ru-RU")} км`;
  return `${Math.round(km)} км`;
}
