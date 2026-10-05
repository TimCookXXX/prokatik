"use client";

// «Моё местоположение»: геолокация браузера → подпись обратным геокодером без
// номера дома → точка «Где» (lib/geo/location.ts, точность хуже 150 м — `lp=s`)
// → запомнить как последнее место региона.
//
// Поколение: геолокация ждёт разрешения и сети до десятка секунд, и её ответ
// не должен затереть место, выбранное за это время, — `cancel()` (или новый
// `locate()`) делает ожидаемый ответ устаревшим. Счётчик один на страницу, а
// не на поле: на главной «Где» есть и в шапке, и в hero, и поздний ответ
// одного поля иначе затёр бы место, выбранное в другом.

import { useCallback, useState, useSyncExternalStore } from "react";
import { reverseLabel } from "@/lib/geo/address";
import { geolocationPoint, type UserPoint } from "@/lib/geo/location";
import { fetchReverse } from "./address-client";
import { storeLocation } from "./stored-location";

/** Город, в котором определяется место: слаг для геокодера, имя для подписи, регион для записи. */
export interface LocateCity {
  slug: string;
  name: string;
  region: string;
}

export type LocateResult =
  | { status: "ok"; point: UserPoint }
  /** Отказ, таймаут или геолокации нет — без сообщения об ошибке. */
  | { status: "denied" }
  /** Пока ждали, выбрали другое место или снова нажали — ответ не применять. */
  | { status: "stale" };

/** Геолокация браузера; отказ, таймаут или её нет — null, без сообщения об ошибке. */
function currentCoords(): Promise<GeolocationCoordinates | null> {
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos.coords),
        () => resolve(null),
        { timeout: 10_000, maximumAge: 5 * 60_000 },
      );
    } catch {
      resolve(null);
    }
  });
}

const noSubscribe = () => () => {};

/** Есть ли геолокация в браузере. Сервер и гидрация — false: разметка совпадает. */
export function useCanGeolocate(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => typeof navigator !== "undefined" && "geolocation" in navigator,
    () => false,
  );
}

let generation = 0;
const genListeners = new Set<() => void>();

/** Новое поколение: ожидаемые ответы всех полей страницы устарели. */
function bump(): number {
  generation += 1;
  for (const cb of genListeners) cb();
  return generation;
}

function subscribeGeneration(cb: () => void): () => void {
  genListeners.add(cb);
  return () => { genListeners.delete(cb); };
}

const readGeneration = () => generation;
const serverGeneration = () => 0;

/**
 * Определение места с общим поколением. `locating` — это поле ждёт браузер и
 * геокодер, и его запрос не отменён: отмена из другого поля гасит его сразу.
 */
export function useGeolocate(city: LocateCity) {
  // Поколение запроса, которого ждёт это поле; 0 — не ждёт.
  const [waiting, setWaiting] = useState(0);
  const current = useSyncExternalStore(subscribeGeneration, readGeneration, serverGeneration);
  const locating = waiting !== 0 && waiting === current;
  const { slug, name, region } = city;

  /** Ожидаемый ответ больше не нужен: место выбрали иначе. */
  const cancel = useCallback(() => { bump(); }, []);

  const locate = useCallback(async (): Promise<LocateResult> => {
    const started = bump();
    setWaiting(started);
    const coords = await currentCoords();
    const hit = coords ? await fetchReverse(slug, { lat: coords.latitude, lon: coords.longitude }) : null;
    setWaiting((w) => (w === started ? 0 : w));
    if (generation !== started) return { status: "stale" };
    if (!coords) return { status: "denied" };
    const point = geolocationPoint(coords, reverseLabel(hit, name));
    storeLocation(region, point);
    return { status: "ok", point };
  }, [slug, name, region]);

  return { locating, locate, cancel };
}
