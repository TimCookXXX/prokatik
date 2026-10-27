// Заявки без аккаунта (booking_leads, ADR 0028): черновики для бота, заявки
// запасной формы, привязка к Telegram-аккаунту, отправка, статусы карточки и
// чтения админки.
//
// Условные UPDATE … WHERE status = … RETURNING — единственная защита от гонок:
// вебхук Telegram повторяет доставку, кнопку жмут дважды, два человека в группе
// жмут одновременно. Пустой RETURNING значит «уже не в том состоянии».
//
// Время в колонках timestamp — UTC, как во всей схеме: моменты уходят
// параметрами через колонки (drizzle переводит Date в ISO UTC), а не голыми
// Date в sql`` и не now() базы (см. server/visitor-analytics.ts).

import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { bookingLeads, visitorEvents, visitors } from "@db/schema";
import { assertAdmin } from "@/lib/auth/assert-admin";
import { newId } from "@/lib/id";
import { withLeadCode } from "@/lib/leads/code";
import { leadSourcesOf, type LeadMarkStatus } from "@/lib/leads/status";
import { cleanUtm } from "@/lib/leads/payload";
import { callBot } from "@/lib/telegram/api";
import { getEnv } from "@/lib/env";
import type { ListingSnapshot } from "@/server/booking-check";
import { retryUndeliveredCards } from "@/server/lead-delivery";

export type LeadRow = typeof bookingLeads.$inferSelect;
type LeadInsert = typeof bookingLeads.$inferInsert;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Черновик старше суток бот считает устаревшим. */
export const DRAFT_TTL_MS = DAY_MS;
/** Самое длинное окно воронки /admin/leads, в сутках. */
export const LEAD_FUNNEL_MAX_DAYS = 30;
/**
 * Неотправленные черновики удаляются (pruneLeadDrafts) не раньше, чем выйдут
 * из самого длинного окна воронки: иначе её колонка недосчитывала бы черновики
 * и привязки, а в живых оставались бы только дошедшие до отправки — и
 * конверсия «открыли → отправили» выглядела бы выше настоящей.
 */
const DRAFT_PRUNE_AGE_MS = LEAD_FUNNEL_MAX_DAYS * DAY_MS;
/** Метка кампании из статистики посещений — за этот срок. */
const UTM_LOOKBACK_MS = 30 * DAY_MS;
/** «Черновик без привязки» в админке — старше этого. */
export const UNBOUND_ALERT_MS = 10 * 60 * 1000;

// --------------------------------------------------------------- ошибки базы

/** Код и имя ограничения ошибки pg — на самой ошибке или в cause (обёртка drizzle). */
function pgError(e: unknown): { code: string | null; constraint: string | null } {
  const err = e as { code?: unknown; constraint?: unknown; cause?: { code?: unknown; constraint?: unknown } } | null;
  const src = err?.cause && typeof err.cause.code === "string" ? err.cause : err;
  return {
    code: typeof src?.code === "string" ? src.code : null,
    constraint: typeof src?.constraint === "string" ? src.constraint : null,
  };
}

/** Нарушение уникальности именно этого ограничения. */
export function isUniqueViolation(e: unknown, constraint: string): boolean {
  const { code, constraint: name } = pgError(e);
  return code === "23505" && name === constraint;
}

const CODE_UQ = "booking_leads_code_unique";
const TOKEN_UQ = "booking_leads_start_token_unique";
const isCodeCollision = (e: unknown) => isUniqueViolation(e, CODE_UQ);

// ---------------------------------------------------------- контекст браузера

export interface VisitorContext {
  /** Браузер помечен «свои». Сессию админа вызывающий добавляет сам. */
  internal: boolean;
  ymClientId: string | null;
  utm: Record<string, string> | null;
}

/**
 * Пометка «свои», ClientID и последняя метка рекламы этого браузера за 30
 * дней. На странице объявления location.search почти всегда пуст: туда
 * приходят клиентским переходом, и метки входа остаются в статистике
 * посещений. «Рекламная» — источник визита `ad` (src/lib/analytics/source.ts):
 * yclid Директа или платный utm_medium.
 */
export async function visitorContext(visitorId: string | null, now: Date = new Date()): Promise<VisitorContext> {
  if (!visitorId) return { internal: false, ymClientId: null, utm: null };
  const db = getDb();
  const [v] = await db.select({ isInternal: visitors.isInternal, ymClientId: visitors.ymClientId })
    .from(visitors).where(eq(visitors.id, visitorId)).limit(1);
  const [ev] = await db.select({ utm: sql<Record<string, string> | null>`${visitorEvents.props}->'utm'` })
    .from(visitorEvents)
    .where(and(
      eq(visitorEvents.visitorId, visitorId),
      eq(visitorEvents.type, "pageview"),
      gte(visitorEvents.createdAt, new Date(now.getTime() - UTM_LOOKBACK_MS)),
      sql`${visitorEvents.props}->'utm' is not null`,
      sql`${visitorEvents.props}->'src'->>'kind' = 'ad'`,
    ))
    .orderBy(desc(visitorEvents.createdAt))
    .limit(1);
  return {
    internal: v?.isInternal ?? false,
    ymClientId: v?.ymClientId ?? null,
    utm: cleanUtm(ev?.utm ?? null),
  };
}

// ------------------------------------------------------------------ запись

/** Поля снимка объявления в строке лида. */
export function snapshotColumns(s: ListingSnapshot | null): Partial<LeadInsert> {
  if (!s) return {};
  return {
    listingId: s.listingId,
    ownerUserId: s.ownerUserId,
    listingTitle: s.title.slice(0, 200),
    listingPath: s.path.slice(0, 300),
    ownerName: s.ownerName?.slice(0, 100) ?? null,
    ownerPhone: s.ownerPhone?.slice(0, 20) ?? null,
    priceDay: s.priceDay,
    priceWeek: s.priceWeek,
    priceMonth: s.priceMonth,
    depositType: s.depositType,
    depositAmount: s.depositAmount,
  };
}

export type DraftValues = Omit<LeadInsert, "id" | "channel" | "status" | "code" | "createdAt" | "sentAt"> & {
  startToken: string;
};

/**
 * Черновик для бота. Повтор токена — тихий успех: маяк мог уйти дважды, а
 * первая строка уже то, что нужно боту.
 */
export async function insertLeadDraft(values: DraftValues, now: Date = new Date()): Promise<"created" | "duplicate"> {
  try {
    await getDb().insert(bookingLeads).values({
      ...values,
      id: newId(),
      channel: "telegram",
      status: "draft",
      createdAt: now,
    });
    return "created";
  } catch (e) {
    if (isUniqueViolation(e, TOKEN_UQ)) return "duplicate";
    throw e;
  }
}

export type FormLeadValues = Omit<LeadInsert, "id" | "channel" | "status" | "code" | "startToken" | "createdAt" | "sentAt">;

/**
 * Заявка запасной формы — сразу отправленная, с кодом. `deliver` — ставить ли
 * карточку в расписание доставки: сверх суточного потолка формы заявка
 * сохраняется, но в группу не идёт и видна только в админке.
 */
export async function insertFormLead(values: FormLeadValues, deliver: boolean, now: Date = new Date()): Promise<LeadRow> {
  const id = newId();
  return withLeadCode(async (code) => {
    const [row] = await getDb().insert(bookingLeads).values({
      ...values,
      id,
      channel: "form",
      status: "sent",
      code,
      createdAt: now,
      sentAt: now,
      cardNextAt: deliver ? now : null,
    }).returning();
    return row;
  }, isCodeCollision);
}

// ------------------------------------------------------------------- чтение

export async function findLeadById(id: string): Promise<LeadRow | null> {
  const [row] = await getDb().select().from(bookingLeads).where(eq(bookingLeads.id, id)).limit(1);
  return row ?? null;
}

export async function findDraftByToken(token: string): Promise<LeadRow | null> {
  const [row] = await getDb().select().from(bookingLeads).where(eq(bookingLeads.startToken, token)).limit(1);
  return row ?? null;
}

/**
 * Черновик, который ждёт отправки от этого Telegram-аккаунта: последний
 * привязанный по bound_at. К нему относятся присланный контакт и текст.
 * bound_at гасит releaseDraftsOf — тогда активного черновика нет.
 */
export async function activeDraftOf(tgUserId: number, now: Date = new Date()): Promise<LeadRow | null> {
  const [row] = await getDb().select().from(bookingLeads)
    .where(and(
      eq(bookingLeads.tgUserId, tgUserId),
      eq(bookingLeads.status, "draft"),
      isNotNull(bookingLeads.boundAt),
      gte(bookingLeads.createdAt, new Date(now.getTime() - DRAFT_TTL_MS)),
    ))
    .orderBy(desc(bookingLeads.boundAt))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------- переходы

/**
 * /start, который черновик не привязал (устарел, чужой, с invalid_reason, уже
 * отправлен), гасит активный черновик этого аккаунта: человек ушёл к новому
 * выбору, и контакт с прежней клавиатуры не должен отправить старые даты.
 * Гасится bound_at, tg_user_id остаётся: черновик по-прежнему его и в
 * воронке считается привязанным; повторный /start по его ссылке привяжет
 * заново.
 */
export async function releaseDraftsOf(tgUserId: number): Promise<void> {
  await getDb().update(bookingLeads)
    .set({ boundAt: null })
    .where(and(
      eq(bookingLeads.tgUserId, tgUserId),
      eq(bookingLeads.status, "draft"),
      isNotNull(bookingLeads.boundAt),
    ));
}

export interface TgIdentity {
  userId: number;
  username: string | null;
  name: string;
}

/**
 * Привязка черновика к Telegram-аккаунту по /start. Повторный /start того же
 * человека освежает bound_at — черновик снова становится активным. null —
 * черновик уже не черновик или привязан к другому.
 */
export async function bindDraft(id: string, tg: TgIdentity, now: Date = new Date()): Promise<LeadRow | null> {
  const [row] = await getDb().update(bookingLeads)
    .set({
      tgUserId: tg.userId,
      tgUsername: tg.username?.slice(0, 32) ?? null,
      tgName: tg.name.slice(0, 130) || null,
      boundAt: now,
    })
    .where(and(
      eq(bookingLeads.id, id),
      eq(bookingLeads.status, "draft"),
      or(isNull(bookingLeads.tgUserId), eq(bookingLeads.tgUserId, tg.userId)),
    ))
    .returning();
  return row ?? null;
}

export interface SendFields {
  customerPhone: string | null;
  /** Свежий снимок из повторной проверки: имя и телефон проката могли смениться. */
  snapshot: ListingSnapshot;
  total: number | null;
}

/**
 * draft → sent из бота: выдаёт код, пишет телефон и sent_at и ставит карточку
 * в расписание доставки. null — черновик уже отправлен (второе нажатие,
 * повтор вебхука).
 */
export async function markLeadSent(id: string, fields: SendFields, now: Date = new Date()): Promise<LeadRow | null> {
  return withLeadCode(async (code) => {
    const [row] = await getDb().update(bookingLeads)
      .set({
        ...snapshotColumns(fields.snapshot),
        status: "sent",
        code,
        customerPhone: fields.customerPhone,
        total: fields.total,
        sentAt: now,
        cardNextAt: now,
      })
      .where(and(eq(bookingLeads.id, id), eq(bookingLeads.status, "draft")))
      .returning();
    return row ?? null;
  }, isCodeCollision);
}

/**
 * Кнопка статуса в карточке. Условие — и на допустимый переход, и на ту самую
 * карточку (message_id): пустой RETURNING значит «уже изменено» или чужое
 * сообщение.
 */
export async function setLeadStatus(
  id: string,
  to: LeadMarkStatus,
  groupMessageId: number,
  by: string,
  now: Date = new Date(),
): Promise<LeadRow | null> {
  const [row] = await getDb().update(bookingLeads)
    .set({ status: to, statusChangedAt: now, statusChangedBy: by.slice(0, 130) || null })
    .where(and(
      eq(bookingLeads.id, id),
      inArray(bookingLeads.status, leadSourcesOf(to)),
      eq(bookingLeads.groupMessageId, groupMessageId),
    ))
    .returning();
  return row ?? null;
}

// ------------------------------------------------------------------ чистка

interface PruneLock { nextAt: number; running: Promise<void> | null }
const G = globalThis as { __inrentaLeadPrune?: PruneLock };
const pruneLock = (): PruneLock => (G.__inrentaLeadPrune ??= { nextAt: 0, running: null });

/**
 * Неотправленные черновики старше окна воронки удаляются: крона нет, чистка ленивая —
 * из роута черновика и чтений админки, не чаще раза в час на процесс.
 * Отправленные заявки не чистятся.
 */
export function pruneLeadDrafts(now: Date = new Date()): Promise<void> {
  const l = pruneLock();
  if (l.running) return l.running;
  if (now.getTime() < l.nextAt) return Promise.resolve();
  l.nextAt = now.getTime() + HOUR_MS;
  l.running = (async () => {
    try {
      await getDb().delete(bookingLeads).where(and(
        eq(bookingLeads.status, "draft"),
        lt(bookingLeads.createdAt, new Date(now.getTime() - DRAFT_PRUNE_AGE_MS)),
      ));
    } catch (e) {
      console.error("[leads] чистка черновиков не удалась:", pgError(e).code ?? "unknown");
    } finally {
      l.running = null;
    }
  })();
  return l.running;
}

/** Только для тестов: замок чистки в исходное состояние. */
export function _resetLeadPruneForTests(): void {
  G.__inrentaLeadPrune = { nextAt: 0, running: null };
}

// ------------------------------------------------------------------ админка

export interface LeadCounts {
  /** Клики «Забронировать» из своей статистики (booking_click), без своих и ботов. */
  clicks: number;
  drafts: number;
  bound: number;
  sentTelegram: number;
  sentForm: number;
  /** Дошли до «Передал» и дальше, кроме отказа сразу после отправки. */
  handed: number;
  taken: number;
  declined: number;
}

/**
 * Воронка за последние `days` суток, без тестовых заявок: клики → черновики →
 * привязанные → отправленные → передано → взяли / отказ. Строка хранит только
 * последний статус, поэтому «передано» — это handed и taken: отказ мог быть и
 * после «Передал», и сразу.
 */
export async function adminLeadCounts(days: number, now: Date = new Date()): Promise<LeadCounts> {
  await assertAdmin();
  await pruneLeadDrafts(now);
  const db = getDb();
  const since = new Date(now.getTime() - days * DAY_MS);
  const real = eq(bookingLeads.internal, false);
  const [created] = await db.select({
    drafts: sql<number>`count(*) filter (where ${bookingLeads.channel} = 'telegram')::int`,
    // Привязан — есть tg_user_id: bound_at гасит releaseDraftsOf.
    bound: sql<number>`count(*) filter (where ${bookingLeads.tgUserId} is not null)::int`,
  }).from(bookingLeads).where(and(real, gte(bookingLeads.createdAt, since)));
  const [sent] = await db.select({
    sentTelegram: sql<number>`count(*) filter (where ${bookingLeads.channel} = 'telegram')::int`,
    sentForm: sql<number>`count(*) filter (where ${bookingLeads.channel} = 'form')::int`,
    handed: sql<number>`count(*) filter (where ${bookingLeads.status} in ('handed', 'taken'))::int`,
    taken: sql<number>`count(*) filter (where ${bookingLeads.status} = 'taken')::int`,
    declined: sql<number>`count(*) filter (where ${bookingLeads.status} = 'declined')::int`,
  }).from(bookingLeads).where(and(real, ne(bookingLeads.status, "draft"), gte(bookingLeads.sentAt, since)));
  const [clicks] = await db.select({ n: count() })
    .from(visitorEvents)
    .innerJoin(visitors, eq(visitors.id, visitorEvents.visitorId))
    .where(and(
      eq(visitorEvents.type, "booking_click"),
      gte(visitorEvents.createdAt, since),
      eq(visitors.isInternal, false),
      eq(visitors.isBot, false),
    ));
  return {
    clicks: clicks?.n ?? 0,
    drafts: created?.drafts ?? 0,
    bound: created?.bound ?? 0,
    sentTelegram: sent?.sentTelegram ?? 0,
    sentForm: sent?.sentForm ?? 0,
    handed: sent?.handed ?? 0,
    taken: sent?.taken ?? 0,
    declined: sent?.declined ?? 0,
  };
}

export interface LeadHealth {
  /** Черновики без привязки старше 10 минут за сутки: признак, что вебхук не доходит. */
  unboundDrafts: number;
  /** Отправленные заявки без карточки в группе. */
  undelivered: LeadRow[];
}

export async function adminLeadHealth(now: Date = new Date()): Promise<LeadHealth> {
  await assertAdmin();
  // Админка — ещё один повод дослать карточки; страницу ответ Telegram не ждёт.
  void retryUndeliveredCards(now);
  const db = getDb();
  const [unbound] = await db.select({ n: count() }).from(bookingLeads).where(and(
    eq(bookingLeads.status, "draft"),
    eq(bookingLeads.channel, "telegram"),
    isNull(bookingLeads.tgUserId),
    isNull(bookingLeads.invalidReason),
    eq(bookingLeads.internal, false),
    lt(bookingLeads.createdAt, new Date(now.getTime() - UNBOUND_ALERT_MS)),
    gte(bookingLeads.createdAt, new Date(now.getTime() - DAY_MS)),
  ));
  const undelivered = await db.select().from(bookingLeads)
    .where(and(ne(bookingLeads.status, "draft"), isNull(bookingLeads.groupMessageId)))
    .orderBy(desc(bookingLeads.sentAt))
    .limit(50);
  return { unboundDrafts: unbound?.n ?? 0, undelivered };
}

/** Отправленные заявки, свежие сверху. */
export async function adminListLeads(limit = 100): Promise<LeadRow[]> {
  await assertAdmin();
  await pruneLeadDrafts();
  return getDb().select().from(bookingLeads)
    .where(ne(bookingLeads.status, "draft"))
    .orderBy(desc(bookingLeads.sentAt))
    .limit(limit);
}

export interface WebhookHealth {
  pendingUpdateCount: number;
  lastErrorDate: Date | null;
  lastErrorMessage: string | null;
}

/** getWebhookInfo: очередь недоставленных апдейтов и последняя ошибка. null — бот выключен или недоступен. */
export async function adminWebhookInfo(): Promise<WebhookHealth | null> {
  await assertAdmin();
  if (!getEnv().TELEGRAM_BOT_TOKEN) return null;
  const r = await callBot<{ pending_update_count?: number; last_error_date?: number; last_error_message?: string }>(
    "getWebhookInfo",
  );
  if (!r.ok) return null;
  return {
    pendingUpdateCount: r.result.pending_update_count ?? 0,
    lastErrorDate: r.result.last_error_date ? new Date(r.result.last_error_date * 1000) : null,
    lastErrorMessage: r.result.last_error_message ?? null,
  };
}
