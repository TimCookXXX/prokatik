// Браузер: мини-индекс своего геокодера (улицы, пункты, микрорайоны, объекты —
// без домов) и запросы домов к серверу для поля адреса (перенос из
// sravniprokat). Мини-индекс грузится один раз на вкладку, лениво — при первом
// фокусе поля, — и собирается в движок в Web Worker (geo-worker.ts): сборка —
// одна длинная синхронная задача, в главном потоке она подвешивала бы ввод на
// телефоне. Без воркера (старый браузер, тесты, воркер не поднялся) — в главном
// потоке, в свободное время браузера.
//
// Запросы в полёте не отменяются (AbortController) — по той же причине, что в
// suggest-client.ts: ответ сверяется по порядку (shouldApply в lib/geo/address).

import { createClientGeocoder, type ClientIndex } from "@/lib/geocoder/client-index";
import type { AddressHit, SuggestOptions } from "@/lib/geocoder/types";
import type { GeoPoint } from "@/lib/geo/point";
import type { GeoWorkerReply, GeoWorkerRequest } from "./geo-worker";

/** Пауза перед запросом домов к серверу: мини-индекс отвечает и без неё. */
export const ADDRESS_DEBOUNCE_MS = 40;

/**
 * Подсказки мини-индекса: улицы, пункты, объекты. Ответ асинхронный — движок
 * живёт в воркере. null — воркер упал: мини-индекса больше нет, подсказки
 * только с сервера.
 */
export interface ClientSuggester {
  suggest(q: string, opts?: SuggestOptions): Promise<AddressHit[] | null>;
  readonly version: string;
}

const clients = new Map<string, Promise<ClientSuggester | null>>();

/** Дать браузеру дорисовать кадр перед сборкой индекса в главном потоке. */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 300 });
    else setTimeout(resolve, 0);
  });
}

/** Запасной путь: скачать и собрать в главном потоке. */
async function inMainThread(url: string): Promise<ClientSuggester> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`client-index ${res.status}`);
  const json = (await res.json()) as ClientIndex;
  await idle();
  const g = createClientGeocoder(json);
  return { version: g.version, suggest: async (q, opts) => g.suggest(q, opts) };
}

/** Движок в воркере: загрузка и сборка там же; ответы идут по номерам запросов. */
function inWorker(url: string, onDead: () => void): Promise<ClientSuggester> {
  // Модульный воркер: Turbopack собирает его отдельным чанком со своего домена
  // (не blob:), и он проходит CSP worker-src 'self' (Caddyfile).
  const worker = new Worker(new URL("./geo-worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, (items: AddressHit[] | null) => void>();
  let nextId = 0;
  let dead = false;
  let ready = false;
  const send = (m: GeoWorkerRequest) => worker.postMessage(m);
  return new Promise<ClientSuggester>((resolve, reject) => {
    // Упал и после готовности — suggest отвечает null, поле переходит на подсказки сервера.
    const fail = (why: string) => {
      dead = true;
      if (ready) onDead(); // до готовности сбой обработает loadClientGeocoder
      worker.terminate();
      for (const done of pending.values()) done(null);
      pending.clear();
      reject(new Error(why));
    };
    worker.onerror = (e) => fail(e.message || "geo worker error");
    worker.onmessage = (e: MessageEvent<GeoWorkerReply>) => {
      const m = e.data;
      if (m.type === "ready") {
        ready = true;
        resolve({
          version: m.version,
          suggest: (q, opts = {}) => new Promise<AddressHit[] | null>((done) => {
            if (dead) return done(null);
            const id = ++nextId;
            pending.set(id, done);
            send({ type: "suggest", id, q, opts });
          }),
        });
      } else if (m.type === "failed") fail(m.error);
      else if (m.type === "hits") {
        pending.get(m.id)?.(m.items);
        pending.delete(m.id);
      }
    };
    send({ type: "load", url });
  });
}

/**
 * Мини-индекс города: один на вкладку. `token` — метка версии данных из
 * гео-контекста города (CityGeoContext.token): ссылка с ней кэшируется
 * браузером навсегда. Сбой — null, следующий вызов попробует снова.
 */
export function loadClientGeocoder(citySlug: string, token: string): Promise<ClientSuggester | null> {
  const key = `${citySlug}|${token}`;
  let p = clients.get(key);
  if (!p) {
    const path = `/api/geo/client-index?city=${encodeURIComponent(citySlug)}&v=${encodeURIComponent(token)}`;
    p = (async () => {
      if (typeof Worker !== "undefined") {
        try {
          // в воркере относительная ссылка считалась бы от адреса скрипта — даём полную
          return await inWorker(new URL(path, location.href).href, () => clients.delete(key));
        } catch {
          // воркер не запустился или упал — ниже тот же путь в главном потоке
        }
      }
      return inMainThread(path);
    })().catch(() => {
      clients.delete(key);
      return null;
    });
    clients.set(key, p);
  }
  return p;
}

/** Подсказки с сервера (с домами); null — сеть или сервер не ответили (429, 5xx). */
export async function fetchAddressHits(
  citySlug: string, q: string, near: GeoPoint | null,
): Promise<AddressHit[] | null> {
  const params = new URLSearchParams({ city: citySlug, q });
  if (near) params.set("near", `${near.lat.toFixed(4)},${near.lon.toFixed(4)}`);
  try {
    const res = await fetch(`/api/geo/suggest?${params}`);
    return res.ok ? ((await res.json()) as { items: AddressHit[] }).items : null;
  } catch {
    return null;
  }
}

/**
 * Обратный геокодер для «Моё местоположение»: не дольше `timeoutMs`, иначе
 * null (точка остаётся без подписи).
 */
export async function fetchReverse(
  citySlug: string, p: GeoPoint, timeoutMs = 1500,
): Promise<AddressHit | null> {
  const params = new URLSearchParams({ city: citySlug, lat: p.lat.toFixed(6), lon: p.lon.toFixed(6) });
  const request = fetch(`/api/geo/reverse?${params}`)
    .then(async (res) => (res.ok ? ((await res.json()) as { hit: AddressHit | null }).hit : null))
    .catch(() => null);
  // Запрос не отменяем: по таймауту просто перестаём ждать.
  return Promise.race([request, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
}
