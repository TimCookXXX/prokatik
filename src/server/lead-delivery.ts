// Доставка карточки заявки в админскую группу Telegram (ADR 0028). База —
// источник правды, Telegram — только доставка: заявка уже записана, и карточку
// можно дослать позже.
//
// Порядок: захват строки → sendMessage → group_message_id. Захват — условный
// UPDATE с card_claimed_at: без него два пути (after() отправки и повтор из
// вебхука) могли бы послать две карточки, и у обеих были бы живые кнопки.
// Захват протухает через 2 минуты — процесс мог умереть между захватом и
// ответом Telegram.
//
// Повторы — по card_next_at с нарастающей паузой: 1, 2, 5, 15, 60 минут и
// дальше раз в час, но не дольше суток с отправки заявки. 429 с retry_after
// сдвигает следующую попытку не раньше, чем просит Telegram. card_next_at
// NULL у отправленной заявки без карточки — повторов больше не будет
// (суточный потолок формы или сутки истекли); такие видны в /admin/leads.
//
// Крона нет: retryUndeliveredCards зовут вебхук, роут черновика, форма и
// админка, не чаще раза в минуту на процесс.
//
// Вторая карточка возможна: Telegram мог принять sendMessage, а ответ не
// дошёл (таймаут, обрыв), — повтор пошлёт ещё одну. Живые кнопки у той, чей
// id записан; нажатие на другую бот гасит (server/telegram-bot.ts, onStatus).

import { and, asc, eq, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { bookingLeads } from "@db/schema";
import { getEnv } from "@/lib/env";
import { siteUrl } from "@/lib/site-config";
import { callBot } from "@/lib/telegram/api";
import { leadCardText } from "@/lib/leads/card";
import { cardReplyMarkup } from "@/lib/leads/status";

const MINUTE_MS = 60 * 1000;
/** Захват строки живёт столько: дольше ответ Telegram не ждут (таймаут 5 с). */
export const CARD_CLAIM_MS = 2 * MINUTE_MS;
/** Паузы между попытками по номеру неудачной попытки; дальше — последняя. */
export const CARD_BACKOFF_MIN = [1, 2, 5, 15, 60] as const;
/** Дольше суток с отправки заявки карточку не досылают. */
export const CARD_GIVE_UP_MS = 24 * 60 * MINUTE_MS;
/** Сколько карточек досылается за один проход. */
const RETRY_BATCH = 10;

/**
 * Когда пробовать снова после `attempts` неудачных попыток; null — больше не
 * пробовать. retry_after из 429 — нижняя граница паузы.
 */
export function nextCardAttemptAt(
  attempts: number,
  sentAt: Date,
  now: Date,
  retryAfterSec: number | null = null,
): Date | null {
  const idx = Math.min(Math.max(attempts, 1), CARD_BACKOFF_MIN.length) - 1;
  const pauseMs = Math.max(CARD_BACKOFF_MIN[idx] * MINUTE_MS, (retryAfterSec ?? 0) * 1000);
  const at = new Date(now.getTime() + pauseMs);
  return at.getTime() - sentAt.getTime() > CARD_GIVE_UP_MS ? null : at;
}

export type CardOutcome =
  | { kind: "sent"; messageId: number }
  /** Строку захватил другой путь, карточка уже есть или заявка не отправлена. */
  | { kind: "skipped" }
  /** Бот не настроен. */
  | { kind: "off" }
  | { kind: "failed"; retryAfter: number | null };

/** Отправка карточки заявки в группу. Ошибки базы уходят наверх. */
export async function sendLeadCard(id: string, now: Date = new Date()): Promise<CardOutcome> {
  const env = getEnv();
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID;
  if (!env.TELEGRAM_BOT_TOKEN || chatId === undefined) return { kind: "off" };

  const db = getDb();
  const [lead] = await db.update(bookingLeads)
    .set({ cardAttempts: sql`${bookingLeads.cardAttempts} + 1`, cardClaimedAt: now })
    .where(and(
      eq(bookingLeads.id, id),
      ne(bookingLeads.status, "draft"),
      isNull(bookingLeads.groupMessageId),
      or(isNull(bookingLeads.cardClaimedAt), lt(bookingLeads.cardClaimedAt, new Date(now.getTime() - CARD_CLAIM_MS))),
    ))
    .returning();
  if (!lead) return { kind: "skipped" };

  const r = await callBot<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: leadCardText(lead, siteUrl()),
    parse_mode: "HTML",
    reply_markup: cardReplyMarkup(lead.id, lead.status),
    link_preview_options: { is_disabled: true },
  });

  if (r.ok) {
    await db.update(bookingLeads)
      .set({ groupMessageId: r.result.message_id, cardNextAt: null, cardClaimedAt: null })
      .where(eq(bookingLeads.id, id));
    return { kind: "sent", messageId: r.result.message_id };
  }
  const next = nextCardAttemptAt(lead.cardAttempts, lead.sentAt ?? lead.createdAt, now, r.retryAfter);
  await db.update(bookingLeads)
    .set({ cardNextAt: next, cardClaimedAt: null })
    .where(eq(bookingLeads.id, id));
  if (next === null) console.error("[leads] карточка не доставлена за сутки:", lead.code);
  return { kind: "failed", retryAfter: r.retryAfter };
}

/**
 * Отправка карточки после ответа (из after()): ошибка базы только в лог —
 * заявка уже записана, а повтор подхватит её по card_next_at.
 */
export async function deliverLeadCard(id: string): Promise<void> {
  try {
    await sendLeadCard(id);
  } catch (e) {
    console.error("[leads] доставка карточки упала:", dbCode(e));
  }
}

interface RetryLock { nextAt: number; running: Promise<void> | null }
const G = globalThis as { __inrentaCardRetry?: RetryLock };
const retryLock = (): RetryLock => (G.__inrentaCardRetry ??= { nextAt: 0, running: null });

/**
 * Досылает карточки, у которых подошло время. Первый отказ Telegram
 * останавливает проход: при сбое или 429 остальные упадут так же, их
 * расписание не трогается.
 */
export function retryUndeliveredCards(now: Date = new Date()): Promise<void> {
  const l = retryLock();
  if (l.running) return l.running;
  if (now.getTime() < l.nextAt) return Promise.resolve();
  l.nextAt = now.getTime() + MINUTE_MS;
  l.running = (async () => {
    try {
      const env = getEnv();
      if (!env.TELEGRAM_BOT_TOKEN) return;
      const due = await getDb().select({ id: bookingLeads.id }).from(bookingLeads)
        .where(and(
          ne(bookingLeads.status, "draft"),
          isNull(bookingLeads.groupMessageId),
          isNotNull(bookingLeads.cardNextAt),
          lte(bookingLeads.cardNextAt, now),
        ))
        .orderBy(asc(bookingLeads.cardNextAt))
        .limit(RETRY_BATCH);
      for (const { id } of due) {
        const r = await sendLeadCard(id, now);
        if (r.kind === "failed" || r.kind === "off") break;
      }
    } catch (e) {
      console.error("[leads] повтор карточек упал:", dbCode(e));
    } finally {
      l.running = null;
    }
  })();
  return l.running;
}

/** Только для тестов: замок повторов в исходное состояние. */
export function _resetCardRetryForTests(): void {
  G.__inrentaCardRetry = { nextAt: 0, running: null };
}

/** Код ошибки базы для лога: текст запроса drizzle несёт параметры — имена и телефоны. */
function dbCode(e: unknown): string {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = err?.cause?.code ?? err?.code;
  return typeof code === "string" ? code : "unknown";
}
