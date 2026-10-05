// Web Worker поля адреса (перенос из sravniprokat): скачивает мини-индекс,
// собирает из него движок и отвечает на подсказки — всё вне главного потока.
// Сборка — одна синхронная задача ≈ 190 мс на M-серии и, по оценке, 0,6–1,2 с
// на среднем Android: в главном потоке она подвешивала бы ввод, пока человек
// печатает. Подсказка в воркере — доли миллисекунды плюс пересылка сообщения.
//
// Создаёт его address-client.ts через new Worker(new URL(...)): Turbopack
// собирает воркер отдельным чанком со своего домена, CSP — worker-src 'self'.

import { createClientGeocoder, type ClientGeocoder, type ClientIndex } from "@/lib/geocoder/client-index";
import type { AddressHit, SuggestOptions } from "@/lib/geocoder/types";

export type GeoWorkerRequest =
  | { type: "load"; url: string }
  | { type: "suggest"; id: number; q: string; opts: SuggestOptions };

export type GeoWorkerReply =
  | { type: "ready"; version: string }
  | { type: "failed"; error: string }
  | { type: "hits"; id: number; items: AddressHit[] };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<GeoWorkerRequest>) => void) | null;
  postMessage(m: GeoWorkerReply): void;
};

let geocoder: ClientGeocoder | null = null;

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === "load") {
    void (async () => {
      try {
        const res = await fetch(m.url);
        if (!res.ok) throw new Error(`client-index ${res.status}`);
        geocoder = createClientGeocoder((await res.json()) as ClientIndex);
        scope.postMessage({ type: "ready", version: geocoder.version });
      } catch (err) {
        scope.postMessage({ type: "failed", error: (err as Error).message });
      }
    })();
  } else if (m.type === "suggest") {
    let items: AddressHit[] = [];
    try {
      items = geocoder ? geocoder.suggest(m.q, m.opts) : [];
    } catch {
      // ошибка движка на одном запросе — пустой ответ, дома и так придут с сервера
    }
    scope.postMessage({ type: "hits", id: m.id, items });
  }
};
