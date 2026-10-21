// Трекер своей статистики посещений: события копятся в очереди и уходят в
// POST /api/analytics пачкой на следующем тике. Что событие значит и что из
// него записать, решает роут: адрес и referrer он чистит сам, а здесь только
// собирается то, что видит браузер.
//
// Молчит, когда учитывать нельзя или незачем: после отказа от учёта
// (analyticsAllowed), во фрейме — так сайт показывает интерфейс Метрики, и
// запись Вебвизора не должна становиться визитом, — и в админке.
//
// Пачки уходят по одной: следующая ждёт ответа на прошлую. Ответ может выдать
// браузеру новый id (вход, выход, смена аккаунта), и параллельная пачка со
// старым id завела бы второй новый. При уходе со страницы (pagehide) остаток
// уходит сразу — fetch keepalive переживает выгрузку документа.

import type { ClientEvent, ClientEventType } from "@/lib/analytics/payload";
import { TRACK_BATCH_MAX, TRACK_BODY_MAX_BYTES, TRACK_RAW_PATH_MAX } from "@/lib/analytics/limits";
import { analyticsAllowedHere } from "./allowed-here";
import { isMetrikaSkipped } from "./metrika-url";

export const TRACK_ENDPOINT = "/api/analytics";

/** Сколько событий ждут отправки; дальше новые отбрасываются. */
export const TRACK_QUEUE_LIMIT = 50;

type Queued = { event: ClientEvent; tick: number };

let queue: Queued[] = [];
let tick = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let listening = false;

const encoder = typeof TextEncoder === "undefined" ? null : new TextEncoder();
const byteLength = (s: string) => (encoder ? encoder.encode(s).length : s.length);

/** Учитывать ли сейчас: отказ, фрейм и админка — нет. */
function silent(): boolean {
  if (typeof window === "undefined") return true;
  if (window.top !== window.self) return true;
  if (isMetrikaSkipped(window.location.pathname)) return true;
  return !analyticsAllowedHere();
}

/** Текущий адрес: путь и query — то, что чистит сервер. */
export function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`.slice(0, TRACK_RAW_PATH_MAX);
}

function enqueue(event: ClientEvent): void {
  if (queue.length >= TRACK_QUEUE_LIMIT) return;
  const item = { event, tick };
  // Просмотр страницы идёт первым среди событий своего тика: эффекты страницы
  // (поиск, объявление) могут отработать раньше эффекта трекера в layout'е.
  const at = event.type === "pageview"
    ? queue.findIndex((q) => q.tick === tick && q.event.type !== "pageview")
    : -1;
  if (at === -1) queue.push(item);
  else queue.splice(at, 0, item);
}

/** Пачка из головы очереди: не больше TRACK_BATCH_MAX событий и потолка тела. */
function takeBatch(): ClientEvent[] {
  const batch: ClientEvent[] = [];
  // Запас на обёртку `{"events":[…],"bot":true}`.
  let size = 32;
  while (queue.length > 0 && batch.length < TRACK_BATCH_MAX) {
    const { event } = queue[0];
    const next = byteLength(JSON.stringify(event)) + 1;
    if (batch.length > 0 && size + next > TRACK_BODY_MAX_BYTES) break;
    queue.shift();
    // Одно событие больше потолка роут всё равно отбросит.
    if (size + next > TRACK_BODY_MAX_BYTES) continue;
    batch.push(event);
    size += next;
  }
  return batch;
}

function post(events: ClientEvent[]): Promise<unknown> {
  const body = JSON.stringify(navigator.webdriver ? { events, bot: true } : { events });
  return fetch(TRACK_ENDPOINT, {
    method: "POST",
    body,
    keepalive: true,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
  });
}

function schedule(): void {
  if (timer !== null || inFlight || queue.length === 0) return;
  timer = setTimeout(flush, 0);
}

async function flush(): Promise<void> {
  timer = null;
  tick++;
  if (inFlight) return;
  const batch = takeBatch();
  if (batch.length === 0) return;
  inFlight = true;
  try {
    await post(batch);
  } catch {
    // Статистика — не повод для ошибки на странице и для повтора: пачка теряется.
  } finally {
    inFlight = false;
    schedule();
  }
}

// Документ уходит: всё, что ждёт, — сейчас, не дожидаясь ответа прошлой пачки.
function onPageHide(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  tick++;
  for (let batch = takeBatch(); batch.length > 0; batch = takeBatch()) {
    post(batch).catch(() => {});
  }
}

type EventData<T extends ClientEventType> = Omit<Extract<ClientEvent, { type: T }>, "type">;

/** Событие своей статистики. Молча отбрасывается, если учитывать нельзя. */
export function track<T extends ClientEventType>(type: T, data: EventData<T>): void {
  if (silent()) return;
  if (!listening) {
    listening = true;
    window.addEventListener("pagehide", onPageHide);
  }
  enqueue({ type, ...data } as unknown as ClientEvent);
  schedule();
}

/** Только для тестов: исходное состояние модуля. */
export function _resetTrackForTests(): void {
  queue = [];
  tick = 0;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  inFlight = false;
  if (listening && typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
  listening = false;
}
