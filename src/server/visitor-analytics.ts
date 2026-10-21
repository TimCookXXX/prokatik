// Запись своей статистики посещений: строка браузера (visitors) и его события
// (visitor_events). Зовёт только роут сбора /api/analytics: синхронно —
// readVisitor (от неё зависит, выдавать ли новый id), остальное — в after(),
// уже после ответа браузеру.
//
// Время в колонках timestamp — UTC, как во всей схеме. Поэтому моменты идут
// параметрами через колонки (drizzle переводит Date в ISO UTC) или ISO-строкой,
// а не голыми Date в sql``: драйвер pg отдал бы их в зоне процесса
// (TZ=Europe/Moscow), и колонка без зоны записала бы московское время как UTC.

import { eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { visitorEvents, visitors } from "@db/schema";
import { EVENT_RETENTION_DAYS, VISITOR_RETENTION_DAYS } from "@/lib/analytics/limits";
import type { Device } from "@/lib/analytics/device";
import type { Source } from "@/lib/analytics/source";

export interface StoredVisitor {
  userId: string | null;
  isInternal: boolean;
  /** Последний ClientID Метрики гостя. */
  ymClientId: string | null;
  /** Есть ли у строки события: гость без них при входе связывается на месте. */
  hasEvents: boolean;
}

/** Строка браузера по id из куки; null — такой нет. */
export async function readVisitor(id: string): Promise<StoredVisitor | null> {
  const [row] = await getDb()
    .select({
      userId: visitors.userId,
      isInternal: visitors.isInternal,
      ymClientId: visitors.ymClientId,
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
  events: NewVisitorEvent[];
  /**
   * Прежний id браузера при входе гостя с историей: его лента кончается
   * событием «вошёл» без аккаунта, а вход админа помечает его заходы своими.
   */
  previous?: { id: string; markInternal: boolean; events: NewVisitorEvent[] };
}

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
 */
export async function writeVisitorBatch(w: VisitorWrite): Promise<void> {
  await getDb().transaction(async (tx) => {
    if (w.previous) {
      // Только обновление: строку прежнего id мог удалить отказ от учёта, и
      // заводить её заново нельзя.
      const prev = w.previous;
      const updated = await tx.update(visitors)
        .set({
          lastSeenAt: sql`greatest(${visitors.lastSeenAt}, ${w.at.toISOString()}::timestamp)`,
          isInternal: sql`${visitors.isInternal} or ${prev.markInternal}`,
        })
        .where(eq(visitors.id, prev.id))
        .returning({ id: visitors.id });
      if (updated.length > 0 && prev.events.length > 0) {
        await tx.insert(visitorEvents).values(prev.events.map(eventRow(prev.id, null)));
      }
    }

    await tx.insert(visitors)
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
          // Аккаунт у строки ставится один раз (связка гостя без событий) и
          // другим не перезаписывается: смена аккаунта — это новый id.
          userId: sql`coalesce(${visitors.userId}, excluded.user_id)`,
          firstSource: sql`coalesce(${visitors.firstSource}, excluded.first_source)`,
          device: sql`coalesce(excluded.device, ${visitors.device})`,
          // ClientID хранится только у гостя: связанной строке он не нужен.
          ymClientId: sql`case when coalesce(${visitors.userId}, excluded.user_id) is null
            then coalesce(excluded.ym_client_id, ${visitors.ymClientId}) end`,
          isBot: sql`${visitors.isBot} or excluded.is_bot`,
          isInternal: sql`${visitors.isInternal} or excluded.is_internal`,
        },
      });
    if (w.events.length > 0) {
      await tx.insert(visitorEvents).values(w.events.map(eventRow(w.id, w.userId)));
    }
  });
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
