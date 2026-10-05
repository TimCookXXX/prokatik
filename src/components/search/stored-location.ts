// Последнее выбранное «Где» — на этом устройстве (перенос из sravniprokat).
// Применённым значением оно не становится: поле «Где» показывает только то,
// что в адресе страницы, иначе шапка писала бы «Где: улица …» над карточками
// без расстояний. Оно — первая строка списка «Где» («Недавнее: …») и `near`
// подсказок адресов, пока место не выбрано.
//
// Запись помнит регион геоданных: в городе другого региона точка ни при чём.
// Только удобство — нет хранилища (приватный режим) — просто не помним.

import { locationQuery, parseLocation, type UserPoint } from "@/lib/geo/location";

const LOC_KEY = "inrenta_loc";

/** Последнее место с этого устройства в регионе `region`; нет или чужой регион — null. */
export function readStoredLocation(region: string): UserPoint | null {
  try {
    const raw = localStorage.getItem(LOC_KEY);
    if (!raw) return null;
    const { region: stored, ...q } = JSON.parse(raw) as Record<string, string>;
    return stored === region ? parseLocation(q) : null;
  } catch {
    return null;
  }
}

/** Запомнить выбранное место региона; null («весь город», «×») — забыть. */
export function storeLocation(region: string, p: UserPoint | null) {
  try {
    if (p) localStorage.setItem(LOC_KEY, JSON.stringify({ region, ...locationQuery(p) }));
    else localStorage.removeItem(LOC_KEY);
  } catch { /* нет хранилища — не помним */ }
}
