// Вебхук бота заявок (ADR 0028). Telegram шлёт сюда апдейты с секретом из
// setWebhook (pnpm tg:webhook) в заголовке X-Telegram-Bot-Api-Secret-Token.
//
// Порядок, от дешёвого к дорогому:
// 1. бот не настроен → 404 — снаружи роута как будто нет;
// 2. секрет не совпал → 401;
// 3. тело больше 64 КБ → 413;
// 4. JSON и схема; непонятное → 200, иначе Telegram повторял бы его вечно;
// 5. чат не личка и не админская группа → 200 молча;
// 6. лимит по Telegram id → 200 молча: на 429 Telegram стал бы повторять;
//    отсечённое нажатие кнопки всё же получает пустой answerCallbackQuery,
//    иначе у кнопки висят часики;
// 7. обработчик → 200. Исходящие вызовы Bot API — в after(), после ответа.
//    Ошибка базы → 500: Telegram повторит апдейт, обработчики идемпотентны.
//    Прочее исключение — баг или неожиданные данные, повтор упал бы так же:
//    200 и запись в лог, иначе апдейт «отравит» очередь.
//
// Кука vid этому роуту не нужна — middleware его не накрывает.

import { NextResponse, after, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { checkLimit } from "@/lib/rate-limit";
import { readBodyCapped } from "@/lib/http/read-capped";
import { isWebhookSecretValid } from "@/lib/telegram/secret";
import { parseUpdate, type BotUpdate } from "@/lib/telegram/update";
import { callBot } from "@/lib/telegram/api";
import { handleUpdate, newOutbox, updateOrigin, type BotOutbox } from "@/server/telegram-bot";
import { deliverLeadCard, retryUndeliveredCards } from "@/server/lead-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Потолок тела апдейта: сообщения бота короткие, медиа приходят ссылками. */
const WEBHOOK_BODY_MAX = 64 * 1024;

const ok = () => new NextResponse(null, { status: 200 });

/** Апдейт отсечён фильтром: 200, а нажатию кнопки — пустой ответ, чтобы снять часики. */
function drop(update: BotUpdate): NextResponse {
  if (update.kind === "callback") {
    const id = update.callback.id;
    after(async () => {
      await callBot("answerCallbackQuery", { callback_query_id: id });
    });
  }
  return ok();
}

/** Вызовы по порядку: сводка раньше клавиатуры, ответ на нажатие раньше правки. */
async function flush(out: BotOutbox): Promise<void> {
  for (const call of out.calls) await callBot(call.method, call.params);
  for (const id of out.cards) await deliverLeadCard(id);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_ADMIN_CHAT_ID === undefined) {
    return new NextResponse(null, { status: 404 });
  }
  if (!isWebhookSecretValid(req.headers.get("x-telegram-bot-api-secret-token"), env.TELEGRAM_WEBHOOK_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }

  const body = await readBodyCapped(req, WEBHOOK_BODY_MAX);
  if (body === null) return new NextResponse(null, { status: 413 });

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return ok();
  }
  const update = parseUpdate(raw);
  const origin = updateOrigin(update);
  if (!origin) return drop(update);
  if (origin.chatType !== "private" && origin.chatId !== env.TELEGRAM_ADMIN_CHAT_ID) return drop(update);
  if (origin.userId !== null && !checkLimit(String(origin.userId), "tg_user").ok) return drop(update);

  const out = newOutbox();
  try {
    await handleUpdate(update, out);
  } catch (e) {
    const code = dbCode(e);
    console.error("[telegram] обработка апдейта упала:", code ?? (e instanceof Error ? e.name : "unknown"));
    // Ответы, накопленные до исключения, не уходят: апдейт либо повторится
    // целиком, либо обработан не будет.
    return code !== null ? new NextResponse(null, { status: 500 }) : ok();
  }

  after(async () => {
    await flush(out);
    await retryUndeliveredCards();
  });
  return ok();
}

/**
 * Код ошибки базы: SQLSTATE или код соединения драйвера (ECONNREFUSED,
 * CONNECT_TIMEOUT) — на самой ошибке или в cause (обёртка drizzle). null — не
 * ошибка базы. Текст запроса в лог не идёт: drizzle несёт в нём параметры —
 * имена и телефоны.
 */
function dbCode(e: unknown): string | null {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = err?.cause?.code ?? err?.code;
  return typeof code === "string" ? code : null;
}
