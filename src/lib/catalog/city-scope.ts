// Где ищет выдача города: сам город или, с точкой «Где», весь его регион
// (docs/domain.md, «Какой город показывается»). Собирает getCityScope
// (src/server/city.ts); здесь — форма и умолчание без БД.

import type { UserPoint } from "@/lib/geo/location";

export interface CityScope {
  /** У города есть геоданные: точка «Где» действует (FilterContext.region). */
  region: boolean;
  /** Действующая точка «Где»; null — её нет или у города нет геоданных. */
  near: UserPoint | null;
  /**
   * Города выдачи: с точкой — все активные города региона, иначе сам город.
   * Город страницы всегда первый.
   */
  cityIds: string[];
  /** В выдаче соседние города — над ней подпись «{Город} и рядом». */
  nearby: boolean;
}

/** Один город без «Где»: страница, которой точка не передана. */
export function singleCityScope(cityId: string, region = false): CityScope {
  return { region, near: null, cityIds: [cityId], nearby: false };
}
