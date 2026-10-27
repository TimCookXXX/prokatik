// Исходящие вызовы Bot API (ADR 0028). Один вход на все методы: ответ Telegram
// разбирается здесь, и вызывающий получает результат, а не исключение, — бот
// и доставка карточек решают сами, что делать с отказом.
//
// Токен живёт в адресе запроса, поэтому адрес не попадает ни в лог, ни в
// ошибку: в лог идут только метод и `description` из ответа Telegram. Ошибка
// fetch сводится к имени (TimeoutError, TypeError) — её текст и cause
// разработчику не нужны, а гарантировать, что в них нет адреса, нельзя.

import { getEnv } from "@/lib/env";

const API_BASE = "https://api.telegram.org";
const TIMEOUT_MS = 5_000;
// Из РФ запрос к api.telegram.org время от времени виснет целиком, а соседний
// тут же проходит за доли секунды. Повтор — только когда ответа не было
// вовсе: отказ Telegram повтором не лечится. Если первый запрос всё же дошёл,
// человек увидит сообщение дважды — это лучше, чем не увидеть сводку заявки.
const NETWORK_RETRIES = 1;

export type BotResult<T> =
  | { ok: true; result: T }
  | {
    ok: false;
    /** Текст Telegram или имя сетевой ошибки. */
    description: string;
    /** HTTP-код ответа Telegram; null — ответа не было (сеть, таймаут, не настроен). */
    errorCode: number | null;
    /** Секунды из parameters.retry_after при 429. */
    retryAfter: number | null;
  };

type Failure = Extract<BotResult<unknown>, { ok: false }>;

function fail(description: string, errorCode: number | null = null, retryAfter: number | null = null): Failure {
  return { ok: false, description, errorCode, retryAfter };
}

/**
 * Вызов метода Bot API. Не бросает: бот без токена, сеть, таймаут, не-JSON и
 * `ok: false` — всё возвращается отказом.
 */
export async function callBot<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<BotResult<T>> {
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  if (!token) return fail("bot is not configured");
  let res: Response | undefined;
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await fetch(`${API_BASE}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "Error";
      console.error("[telegram]", method, name);
      if (attempt >= NETWORK_RETRIES) return fail(name);
    }
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    console.error("[telegram]", method, `HTTP ${res.status}, not JSON`);
    return fail(`HTTP ${res.status}`, res.status);
  }
  return parseBotResponse<T>(method, res.status, body);
}

/** Разбор `{ok, result, description, error_code, parameters.retry_after}`. */
export function parseBotResponse<T>(method: string, status: number, body: unknown): BotResult<T> {
  const b = (body && typeof body === "object" ? body : {}) as {
    ok?: unknown; result?: unknown; description?: unknown; error_code?: unknown;
    parameters?: { retry_after?: unknown };
  };
  if (b.ok === true) return { ok: true, result: b.result as T };
  const description = typeof b.description === "string" ? b.description : `HTTP ${status}`;
  const errorCode = typeof b.error_code === "number" ? b.error_code : status;
  const retry = b.parameters?.retry_after;
  const retryAfter = typeof retry === "number" && retry >= 0 ? retry : null;
  // «message is not modified» — не сбой: карточку перерисовали тем же текстом.
  if (!isNotModified(description)) console.error("[telegram]", method, description);
  return fail(description, errorCode, retryAfter);
}

function isNotModified(description: string): boolean {
  return description.includes("message is not modified");
}

/**
 * Правка сообщения тем же содержимым Telegram отклоняет с «message is not
 * modified». Для перерисовки карточки это успех: на ней уже нужный текст.
 */
export function isEditNoop(r: BotResult<unknown>): boolean {
  return !r.ok && isNotModified(r.description);
}
