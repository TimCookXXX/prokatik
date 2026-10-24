// Read-слой переписки.
//
// Список диалогов собирается двумя отдельными запросами — «где я владелец» и
// «где я арендатор», — а не одним с `OR`. Причина в индексах: у chat_threads их
// два, (owner_user_id, last_message_at) и (customer_user_id, last_message_at), и
// условие `owner = me OR customer = me` не даёт использовать ни один как есть —
// планировщик возьмёт BitmapOr и отсортирует весь набор. Две ветки с LIMIT в
// каждой дают два индексных прохода; слияние по last_message_at доделывается в
// JS и на размере страницы стоит ничего.

import { and, asc, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { categories, chatMessages, chatThreads, cities, listings, users } from "@db/schema";
import { canReadThread } from "@/lib/chat/rules";
import {
  isSystemKind, systemMessageLine,
  type ChatMessageKind, type ChatSystemMeta,
} from "@/lib/chat/system-message";

export const MESSAGES_PAGE_SIZE = 40;
const THREADS_PAGE_SIZE = 50;
const PREVIEW_LENGTH = 200;

export type ThreadListItem = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingSlug: string;
  /** Первый кадр объявления — миниатюра в строке списка. */
  listingImage: string | null;
  counterpartId: string;
  counterpartName: string | null;
  counterpartImage: string | null;
  lastMessageAt: Date;
  preview: string;
  lastMessageMine: boolean;
  /** С какой стороны человек в этой переписке — нужно фильтру «Мои вещи». */
  iAmOwner: boolean;
  /** Моё последнее сообщение уже прочитано собеседником: галочка вместо одной. */
  lastMessageReadByCounterpart: boolean;
  unread: number;
};

export type ThreadMessage = {
  id: string;
  /** Пусто у записи о сделке — её пишет не человек. */
  senderUserId: string | null;
  kind: ChatMessageKind;
  /** Пусто у записи о сделке: её текст собирает lib/chat/system-message. */
  body: string | null;
  meta: ChatSystemMeta | null;
  createdAt: Date;
};

export type ThreadHeader = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingSlug: string;
  listingCitySlug: string;
  listingCategorySlug: string;
  listingStatus: "active" | "hidden" | "archived";
  /** Для чипа объявления в шапке переписки. Строку цены и залога собирают
   *  formatPrice/formatDeposit из lib/catalog/format — второй реализации
   *  денежного формата в проекте быть не должно. */
  listingImage: string | null;
  listingPriceDay: number | null;
  listingPriceWeek: number | null;
  listingPriceMonth: number | null;
  listingDepositType: "money" | "document" | "none";
  listingDepositAmount: number | null;
  ownerUserId: string;
  customerUserId: string;
  counterpartId: string;
  counterpartName: string | null;
  counterpartImage: string | null;
  counterpartBannedAt: Date | null;
  /** Курсор читателя — по нему считается разделитель непрочитанного. Снимается
   *  до markThreadRead, иначе разделитель исчезнет сразу после открытия. */
  viewerLastReadMessageId: string | null;
  /** Курсор собеседника — по нему рисуются галочки прочтения. Это снимок на
   *  момент рендера: до задачи 2 сигнала о его сдвиге нет, поэтому «прочитано»
   *  появляется с задержкой, на следующем обновлении страницы. */
  counterpartLastReadMessageId: string | null;
};

// Курсор непрочитанного зависит от того, с какой стороны смотрит человек.
// COALESCE к пустой строке: NULL означает «не читал ничего», и тогда непрочитано
// всё — ULID лексикографически больше пустой строки всегда.
function unreadCursor(userId: string) {
  return sql`coalesce(case when ${chatThreads.ownerUserId} = ${userId}
    then ${chatThreads.ownerLastReadMessageId}
    else ${chatThreads.customerLastReadMessageId} end, '')`;
}

/* Непрочитанное в SQL — та же формула, что isUnreadFor в lib/chat/unread.
 * Собрана здесь одним выражением, а не переписана в каждой из трёх выборок:
 * счётчик в шапке, список переписок и треды объявления обязаны считать
 * одинаково.
 *
 * Про kind: системная запись не бывает непрочитанной, и проверяется это
 * отдельным условием, а не через отправителя. `sender_user_id <> ?` в SQL при
 * NULL даёт NULL и строку отбрасывает — то есть сегодня системная запись
 * выпала бы сама. На этом совпадении правило строить нельзя: оно молча
 * сломается, как только в отправителе окажется актор. */
function unreadCondition(userId: string) {
  return and(
    eq(chatMessages.kind, "user"),
    ne(chatMessages.senderUserId, userId),
    gt(chatMessages.id, unreadCursor(userId)),
  );
}

/* Сколько непрочитанного в каждом из тредов — одним сгруппированным запросом.
 *
 * Вынесено наружу по той же причине, по какой собрана unreadCondition:
 * читателей стало трое (список переписок, треды объявления и сводка кабинета),
 * и третья копия этих восьми строк разъехалась бы с остальными двумя первой же
 * правкой. Счётчик в шапке считает сумму без группировки и делит с ними только
 * unreadCondition.
 *
 * Пустой список — пустая карта без похода в базу: inArray на пустом массиве
 * drizzle не принимает. */
export async function getUnreadByThread(
  threadIds: readonly string[],
  userId: string,
): Promise<Map<string, number>> {
  if (threadIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ threadId: chatMessages.threadId, cnt: sql<number>`count(*)::int` })
    .from(chatMessages)
    .innerJoin(chatThreads, eq(chatThreads.id, chatMessages.threadId))
    .where(and(
      inArray(chatMessages.threadId, [...threadIds]),
      unreadCondition(userId),
    ))
    .groupBy(chatMessages.threadId);
  return new Map(rows.map((r) => [r.threadId, r.cnt]));
}

// Экспортируется ради тестов: функция чистая, а превью — то, что человек видит
// в списке чаще самого сообщения.
export function toPreview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat;
}

/* Превью последней строки треда. У записи о сделке текста в базе нет, поэтому
 * строка собирается из вида и meta — иначе тред, где последней была запись,
 * всплывал бы наверх списка с пустым превью. */
export function messagePreview(
  m: { kind: string; body: string | null; meta: ChatSystemMeta | null },
): string {
  if (isSystemKind(m.kind)) return toPreview(systemMessageLine(m.kind, m.meta));
  return m.body ? toPreview(m.body) : "";
}

export interface ListingThread {
  id: string;
  peerId: string;
  peerName: string | null;
  peerImage: string | null;
  lastMessageAt: Date;
  unread: number;
}

/* Переписки по одной вещи — для её страницы в кабинете. Отдельно от
 * getThreadList намеренно: тот собирает ленту всех переписок обеих ролей с
 * обложками объявлений и превью, шестью запросами. Здесь вещь одна и известна,
 * превью не нужно — хватает собеседника, свежести и числа непрочитанных.
 *
 * Только сторона владельца: чужая вещь в кабинет не попадает. */
export async function getListingThreads(
  listingId: string,
  ownerUserId: string,
): Promise<ListingThread[]> {
  const db = getDb();
  const peer = alias(users, "peer");

  const rows = await db
    .select({
      id: chatThreads.id,
      peerId: peer.id,
      peerName: peer.name,
      peerImage: peer.image,
      lastMessageAt: chatThreads.lastMessageAt,
    })
    .from(chatThreads)
    .innerJoin(peer, eq(peer.id, chatThreads.customerUserId))
    .where(and(
      eq(chatThreads.listingId, listingId),
      eq(chatThreads.ownerUserId, ownerUserId),
    ))
    .orderBy(desc(chatThreads.lastMessageAt))
    .limit(THREADS_PAGE_SIZE);

  if (rows.length === 0) return [];

  const unreadByThread = await getUnreadByThread(rows.map((r) => r.id), ownerUserId);
  return rows.map((r) => ({ ...r, unread: unreadByThread.get(r.id) ?? 0 }));
}

export async function getThreadList(userId: string): Promise<ThreadListItem[]> {
  const db = getDb();

  const columns = {
    id: chatThreads.id,
    listingId: chatThreads.listingId,
    ownerUserId: chatThreads.ownerUserId,
    customerUserId: chatThreads.customerUserId,
    lastMessageAt: chatThreads.lastMessageAt,
    ownerLastReadMessageId: chatThreads.ownerLastReadMessageId,
    customerLastReadMessageId: chatThreads.customerLastReadMessageId,
  };

  const [asOwner, asCustomer] = await Promise.all([
    db.select(columns).from(chatThreads)
      .where(eq(chatThreads.ownerUserId, userId))
      .orderBy(desc(chatThreads.lastMessageAt))
      .limit(THREADS_PAGE_SIZE),
    db.select(columns).from(chatThreads)
      .where(eq(chatThreads.customerUserId, userId))
      .orderBy(desc(chatThreads.lastMessageAt))
      .limit(THREADS_PAGE_SIZE),
  ]);

  const threads = [...asOwner, ...asCustomer]
    .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
    .slice(0, THREADS_PAGE_SIZE);

  if (threads.length === 0) return [];

  const threadIds = threads.map((t) => t.id);
  const counterpartIds = threads.map((t) => (t.ownerUserId === userId ? t.customerUserId : t.ownerUserId));
  const listingIds = threads.map((t) => t.listingId);

  const [lastMessages, unreadById, listingRows, counterpartRows] = await Promise.all([
    // DISTINCT ON по треду с сортировкой по id DESC — идёт по индексу
    // (thread_id, id) и берёт последнее сообщение каждого треда одним проходом.
    db.selectDistinctOn([chatMessages.threadId], {
      threadId: chatMessages.threadId,
      id: chatMessages.id,
      senderUserId: chatMessages.senderUserId,
      kind: chatMessages.kind,
      body: chatMessages.body,
      meta: sql<ChatSystemMeta | null>`${chatMessages.metaJson}`,
    })
      .from(chatMessages)
      .where(inArray(chatMessages.threadId, threadIds))
      .orderBy(chatMessages.threadId, desc(chatMessages.id)),
    getUnreadByThread(threadIds, userId),
    db.select({
      id: listings.id,
      title: listings.title,
      slug: listings.slug,
      // Первый кадр — обложка объявления (то же соглашение, что в ListingCard).
      // Достаём его в SQL: тянуть весь photos_json на полсотни объявлений ради
      // миниатюры 14×14 незачем.
      image: sql<string | null>`${listings.photosJson}->0->>'url'`,
    })
      .from(listings)
      .where(inArray(listings.id, listingIds)),
    db.select({ id: users.id, name: users.name, image: users.image })
      .from(users)
      .where(inArray(users.id, counterpartIds)),
  ]);

  const lastById = new Map(lastMessages.map((m) => [m.threadId, m]));
  const listingById = new Map(listingRows.map((l) => [l.id, l]));
  const userById = new Map(counterpartRows.map((u) => [u.id, u]));

  return threads.map((t) => {
    const iAmOwner = t.ownerUserId === userId;
    const counterpartId = iAmOwner ? t.customerUserId : t.ownerUserId;
    const last = lastById.get(t.id);
    const listing = listingById.get(t.listingId);
    const counterpart = userById.get(counterpartId);
    // Курсор той стороны, что напротив: моё сообщение прочитано, если оно не
    // новее его отметки. ULID сравнивается лексикографически.
    const counterpartCursor = iAmOwner ? t.customerLastReadMessageId : t.ownerLastReadMessageId;
    // Запись о сделке ничья: галочки прочтения к ней не относятся.
    const lastMessageMine = Boolean(last?.senderUserId) && last?.senderUserId === userId;
    return {
      id: t.id,
      listingId: t.listingId,
      listingTitle: listing?.title ?? "",
      listingSlug: listing?.slug ?? "",
      listingImage: listing?.image ?? null,
      counterpartId,
      counterpartName: counterpart?.name ?? null,
      counterpartImage: counterpart?.image ?? null,
      lastMessageAt: t.lastMessageAt,
      preview: last ? messagePreview(last) : "",
      lastMessageMine,
      iAmOwner,
      lastMessageReadByCounterpart: Boolean(
        lastMessageMine && last && counterpartCursor && last.id <= counterpartCursor,
      ),
      unread: unreadById.get(t.id) ?? 0,
    };
  });
}

// Шапка треда. Возвращает null и для несуществующего треда, и для чужого:
// снаружи эти случаи неразличимы намеренно.
export async function getThreadHeader(threadId: string, userId: string): Promise<ThreadHeader | null> {
  const db = getDb();
  const rows = await db.select({
    id: chatThreads.id,
    listingId: chatThreads.listingId,
    ownerUserId: chatThreads.ownerUserId,
    customerUserId: chatThreads.customerUserId,
    ownerLastReadMessageId: chatThreads.ownerLastReadMessageId,
    customerLastReadMessageId: chatThreads.customerLastReadMessageId,
    listingTitle: listings.title,
    listingSlug: listings.slug,
    listingCitySlug: cities.slug,
    listingCategorySlug: categories.slug,
    listingStatus: listings.status,
    listingImage: sql<string | null>`${listings.photosJson}->0->>'url'`,
    listingPriceDay: listings.priceDay,
    listingPriceWeek: listings.priceWeek,
    listingPriceMonth: listings.priceMonth,
    listingDepositType: listings.depositType,
    listingDepositAmount: listings.depositAmount,
  })
    .from(chatThreads)
    .innerJoin(listings, eq(listings.id, chatThreads.listingId))
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .where(eq(chatThreads.id, threadId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (!canReadThread(userId, row)) return null;

  const counterpartId = row.ownerUserId === userId ? row.customerUserId : row.ownerUserId;
  const counterpartRows = await db.select({
    name: users.name,
    image: users.image,
    bannedAt: users.bannedAt,
  })
    .from(users)
    .where(eq(users.id, counterpartId))
    .limit(1);
  const counterpart = counterpartRows[0];

  const iAmOwner = row.ownerUserId === userId;

  return {
    id: row.id,
    listingId: row.listingId,
    listingTitle: row.listingTitle,
    listingSlug: row.listingSlug,
    listingCitySlug: row.listingCitySlug,
    listingCategorySlug: row.listingCategorySlug,
    listingStatus: row.listingStatus,
    listingImage: row.listingImage,
    listingPriceDay: row.listingPriceDay,
    listingPriceWeek: row.listingPriceWeek,
    listingPriceMonth: row.listingPriceMonth,
    listingDepositType: row.listingDepositType,
    listingDepositAmount: row.listingDepositAmount,
    ownerUserId: row.ownerUserId,
    customerUserId: row.customerUserId,
    counterpartId,
    counterpartName: counterpart?.name ?? null,
    counterpartImage: counterpart?.image ?? null,
    counterpartBannedAt: counterpart?.bannedAt ?? null,
    viewerLastReadMessageId: iAmOwner ? row.ownerLastReadMessageId : row.customerLastReadMessageId,
    counterpartLastReadMessageId: iAmOwner
      ? row.customerLastReadMessageId
      : row.ownerLastReadMessageId,
  };
}

// Страница истории. Курсор — id сообщения (ULID сортируется по времени), а не
// OFFSET: он деградирует тем сильнее, чем длиннее переписка.
// Отдаётся в хронологическом порядке — так его и рисует лента.
export async function getMessages(
  threadId: string,
  before?: string,
): Promise<{ messages: ThreadMessage[]; hasMore: boolean }> {
  const db = getDb();
  const rows = await db.select({
    id: chatMessages.id,
    senderUserId: chatMessages.senderUserId,
    kind: chatMessages.kind,
    body: chatMessages.body,
    meta: sql<ChatSystemMeta | null>`${chatMessages.metaJson}`,
    createdAt: chatMessages.createdAt,
  })
    .from(chatMessages)
    .where(before
      ? and(eq(chatMessages.threadId, threadId), lt(chatMessages.id, before))
      : eq(chatMessages.threadId, threadId))
    .orderBy(desc(chatMessages.id))
    .limit(MESSAGES_PAGE_SIZE + 1);

  const hasMore = rows.length > MESSAGES_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, MESSAGES_PAGE_SIZE) : rows;
  return { messages: page.reverse(), hasMore };
}

// Догон после разрыва: всё, что появилось СТРОГО ПОСЛЕ курсора.
//
// Форму getMessages копировать нельзя. Тот отдаёт самые новые — и при
// накопленных за разрыв ста сообщениях клиент получил бы последние сорок, а
// шестьдесят в середине исчезли бы бесследно: buildFeed нарисовал бы блоки
// встык, «Показать более ранние» читает только строго старше самого старого, а
// refresh ленту из пропов не пересевает. Поэтому порядок по возрастанию от
// курсора, а клиент догоняет циклом, пока hasMore не станет false.
export async function getMessagesAfter(
  threadId: string,
  after: string,
): Promise<{ messages: ThreadMessage[]; hasMore: boolean }> {
  const rows = await getDb().select({
    id: chatMessages.id,
    senderUserId: chatMessages.senderUserId,
    kind: chatMessages.kind,
    body: chatMessages.body,
    meta: sql<ChatSystemMeta | null>`${chatMessages.metaJson}`,
    createdAt: chatMessages.createdAt,
  })
    .from(chatMessages)
    .where(and(eq(chatMessages.threadId, threadId), gt(chatMessages.id, after)))
    .orderBy(asc(chatMessages.id))
    // Потолок обязателен: древний курсор без него вытянул бы весь тред в память
    // процесса, а её на сервере гигабайт.
    .limit(MESSAGES_PAGE_SIZE + 1);

  const hasMore = rows.length > MESSAGES_PAGE_SIZE;
  return { messages: hasMore ? rows.slice(0, MESSAGES_PAGE_SIZE) : rows, hasMore };
}

// Бейдж в личной навигации. Считается рядом с newRequestsCount, поэтому запрос
// один и без обращения к списку тредов.
export async function getUnreadCount(userId: string): Promise<number> {
  const db = getDb();
  const rows = await db.select({ cnt: sql<number>`count(*)::int` })
    .from(chatMessages)
    .innerJoin(chatThreads, eq(chatThreads.id, chatMessages.threadId))
    .where(and(
      or(eq(chatThreads.ownerUserId, userId), eq(chatThreads.customerUserId, userId)),
      unreadCondition(userId),
    ));
  return rows[0]?.cnt ?? 0;
}

// Есть ли у человека переписки вообще. Нужно заглушке на /chat: «переписок нет»
// и «выберите переписку слева» — разные сообщения, и путать их нельзя.
export async function countThreads(userId: string): Promise<number> {
  const rows = await getDb().select({ cnt: sql<number>`count(*)::int` })
    .from(chatThreads)
    .where(or(eq(chatThreads.ownerUserId, userId), eq(chatThreads.customerUserId, userId)));
  return rows[0]?.cnt ?? 0;
}

// Тред по объявлению для конкретного арендатора: нужен, чтобы кнопка «Написать»
// вела в существующую переписку, а не заводила вторую.
export async function findThreadByListing(listingId: string, customerUserId: string) {
  const db = getDb();
  const rows = await db.select({ id: chatThreads.id })
    .from(chatThreads)
    .where(and(
      eq(chatThreads.listingId, listingId),
      eq(chatThreads.customerUserId, customerUserId),
    ))
    .limit(1);
  return rows[0]?.id ?? null;
}
