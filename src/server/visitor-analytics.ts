// Запись своей статистики посещений: строка браузера (visitors) и его события
// (visitor_events). Зовёт только роут сбора /api/analytics: синхронно —
// readVisitor (от неё зависит, выдавать ли новый id), остальное — в after(),
// уже после ответа браузеру.
//
// Время в колонках timestamp — UTC, как во всей схеме. Поэтому моменты идут
// параметрами через колонки (drizzle переводит Date в ISO UTC) или ISO-строкой,
// а не голыми Date в sql``: драйвер pg отдал бы их в зоне процесса
// (TZ=Europe/Moscow), и колонка без зоны записала бы московское время как UTC.

import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions, visitorEvents, visitors } from "@db/schema";
import { EVENT_RETENTION_DAYS, VISITOR_RETENTION_DAYS } from "@/lib/analytics/limits";
import type { Device } from "@/lib/analytics/device";
import type { Source } from "@/lib/analytics/source";

export interface StoredVisitor {
  userId: string | null;
  isInternal: boolean;
  /** Последний ClientID Метрики гостя. */
  ymClientId: string | null;
  /** Есть ли у строки события: отметку «вошёл» получает только гость с историей. */
  hasEvents: boolean;
  /** Последний заход: этим временем помечается «вошёл» прежнего гостя. */
  lastSeenAt: Date;
}

/** Строка браузера по id из куки; null — такой нет. */
export async function readVisitor(id: string): Promise<StoredVisitor | null> {
  const [row] = await getDb()
    .select({
      userId: visitors.userId,
      isInternal: visitors.isInternal,
      ymClientId: visitors.ymClientId,
      lastSeenAt: visitors.lastSeenAt,
      // Таблицы — явными именами: в полях select drizzle пишет колонки без
      // таблицы, и "id" внутри подзапроса оказался бы id события.
      hasEvents: sql<boolean>`exists (select 1 from visitor_events e where e.visitor_id = visitors.id)`,
    })
    .from(visitors)
    .where(eq(visitors.id, id))
    .limit(1);
  return row ?? null;
}

/** Событие к записи. id и время назначены до after(): порядок пачки сохраняется. */
export interface NewVisitorEvent {
  id: string;
  type: string;
  createdAt: Date;
  path?: string | null;
  listingId?: string | null;
  q?: string | null;
  total?: number | null;
  props?: Record<string, unknown>;
}

export interface VisitorWrite {
  /** Строка, в которую пишутся события: прежний id или только что выданный. */
  id: string;
  /** Аккаунт состояния; null — гость. */
  userId: string | null;
  at: Date;
  device: Device | null;
  isBot: boolean;
  isInternal: boolean;
  /** Источник первой загрузки документа в пачке; в строку — только если там пусто. */
  firstSource: Source | null;
  /** Новый ClientID Метрики гостя; null — не менялся. */
  ymClientId: string | null;
  /**
   * «Вошёл» — первым событием, только если строку завела эта запись. Её мог
   * завести раньше параллельный маяк того же браузера (его after() ещё шёл,
   * когда эта пачка прочитала «строки нет»): тогда вход уже записан.
   */
  login?: NewVisitorEvent;
  events: NewVisitorEvent[];
  /**
   * Прежний id браузера при входе гостя с историей: его лента кончается
   * событием «вошёл» без аккаунта, а вход админа помечает его заходы своими.
   * Время и id этого события — от последнего захода гостя, а не от входа, и
   * последний заход не сдвигается: иначе общий момент связал бы его строку
   * со строкой аккаунта.
   */
  previous?: { id: string; markInternal: boolean; events: NewVisitorEvent[] };
}

/** Чем кончилась запись: строку завели, дописали или не тронули (она чужого состояния). */
export type WriteOutcome = "created" | "updated" | "skipped";

const eventRow = (visitorId: string, userId: string | null) => (e: NewVisitorEvent) => ({
  id: e.id,
  visitorId,
  userId,
  type: e.type,
  path: e.path ?? null,
  listingId: e.listingId ?? null,
  q: e.q ?? null,
  total: e.total ?? null,
  props: e.props ?? {},
  createdAt: e.createdAt,
});

/**
 * Строка браузера и события одной транзакцией. Строку заводит upsert: её
 * может не быть (новый гость, новый id после входа), а параллельная пачка того
 * же браузера могла завести её раньше.
 *
 * Аккаунт у строки upsert не меняет: строка чужого состояния — гостевая, когда
 * пишется аккаунт, или наоборот (пачка решила по устаревшему чтению) — не
 * трогается вовсе, и её история к аккаунту не прирастает.
 */
export async function writeVisitorBatch(w: VisitorWrite): Promise<WriteOutcome> {
  return getDb().transaction(async (tx) => {
    if (w.previous) {
      // Только обновление: строку прежнего id мог удалить отказ от учёта, и
      // заводить её заново нельзя. Последний заход не трогается.
      const prev = w.previous;
      const updated = await tx.update(visitors)
        .set({ isInternal: sql`${visitors.isInternal} or ${prev.markInternal}` })
        .where(eq(visitors.id, prev.id))
        .returning({ id: visitors.id });
      if (updated.length > 0 && prev.events.length > 0) {
        await tx.insert(visitorEvents).values(prev.events.map(eventRow(prev.id, null)));
      }
    }

    const [row] = await tx.insert(visitors)
      .values({
        id: w.id,
        firstSeenAt: w.at,
        lastSeenAt: w.at,
        userId: w.userId,
        firstSource: w.firstSource,
        device: w.device,
        ymClientId: w.userId === null ? w.ymClientId : null,
        isBot: w.isBot,
        isInternal: w.isInternal,
      })
      .onConflictDoUpdate({
        target: visitors.id,
        set: {
          lastSeenAt: sql`greatest(${visitors.lastSeenAt}, excluded.last_seen_at)`,
          firstSource: sql`coalesce(${visitors.firstSource}, excluded.first_source)`,
          device: sql`coalesce(excluded.device, ${visitors.device})`,
          // ClientID хранится только у гостя: строке аккаунта он не нужен.
          ymClientId: sql`case when ${visitors.userId} is null
            then coalesce(excluded.ym_client_id, ${visitors.ymClientId}) end`,
          isBot: sql`${visitors.isBot} or excluded.is_bot`,
          isInternal: sql`${visitors.isInternal} or excluded.is_internal`,
        },
        // Смена аккаунта — это новый id: строку другого состояния не трогаем.
        setWhere: sql`${visitors.userId} is not distinct from excluded.user_id`,
      })
      // xmax = 0 — строку вставила эта команда, а не обновила.
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (!row) return "skipped";

    const events = [...(row.inserted && w.login ? [w.login] : []), ...w.events];
    if (events.length > 0) {
      await tx.insert(visitorEvents).values(events.map(eventRow(w.id, w.userId)));
    }
    return row.inserted ? "created" : "updated";
  });
}

/**
 * Живая ли сессия с этим токеном — когда auth() ответил «нет». Auth.js
 * глотает сбой базы и отвечает тем же «нет», а роут по нему меняет id браузера
 * и запоминает «нет сессии» на 10 минут: ложный выход и вход. true — сессия
 * есть, и «нет» значило сбой.
 */
export async function sessionTokenLive(token: string, now: Date = new Date()): Promise<boolean> {
  const [row] = await getDb()
    .select({ one: sql<number>`1` })
    .from(sessions)
    .where(and(eq(sessions.sessionToken, token), gt(sessions.expires, now)))
    .limit(1);
  return row !== undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Не вышло — следующая попытка через час, а не через сутки. */
const PRUNE_RETRY_MS = 60 * 60 * 1000;

let nextPruneAt = 0;
let pruning: Promise<void> | null = null;

/**
 * Чистка по сроку хранения (крона нет): события старше EVENT_RETENTION_DAYS
 * и браузеры без активности дольше VISITOR_RETENTION_DAYS — их события уходят
 * каскадом. Раз в сутки на процесс: зовут её и after() роута сбора, и чтения
 * админки, — что раньше случится. Второе место нужно, чтобы срок из политики
 * соблюдался и в дни без единого маяка.
 */
export function pruneVisitorData(now: Date = new Date()): Promise<void> {
  if (pruning) return pruning;
  if (now.getTime() < nextPruneAt) return Promise.resolve();
  nextPruneAt = now.getTime() + DAY_MS;
  pruning = (async () => {
    try {
      const db = getDb();
      await db.delete(visitorEvents)
        .where(lt(visitorEvents.createdAt, new Date(now.getTime() - EVENT_RETENTION_DAYS * DAY_MS)));
      await db.delete(visitors)
        .where(lt(visitors.lastSeenAt, new Date(now.getTime() - VISITOR_RETENTION_DAYS * DAY_MS)));
    } catch (e) {
      nextPruneAt = now.getTime() + PRUNE_RETRY_MS;
      console.error("[analytics] чистка по сроку не удалась:", dbErrorCode(e));
    } finally {
      pruning = null;
    }
  })();
  return pruning;
}

/**
 * Код ошибки базы для лога. Сообщение drizzle несёт текст запроса с
 * параметрами — id браузера и текст поиска, — поэтому в лог идёт только код.
 */
export function dbErrorCode(e: unknown): string {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = err?.cause?.code ?? err?.code;
  return typeof code === "string" ? code : "unknown";
}

/** Только для тестов: замок чистки в исходное состояние. */
export function _resetPruneForTests(): void {
  nextPruneAt = 0;
  pruning = null;
}
