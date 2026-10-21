"use server";

// Server actions переписки: первое сообщение по объявлению, ответ в треде,
// отметка прочтения.
//
// Инварианты:
// - вставка сообщения и сдвиг last_message_at идут одной транзакцией; в задаче
//   «доставка по вебсокетам» туда же встанет pg_notify, поэтому разносить их на
//   два запроса нельзя;
// - действие возвращает созданное сообщение целиком, а не факт успеха: лента
//   рисует его сразу, а при подключении сокета этим же id дедуплицируется эхо;
// - отправитель в той же транзакции двигает свой курсор прочтения — иначе
//   собственное сообщение считалось бы непрочитанным.

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/lib/db";
import { chatMessages, chatThreads, listings, notifications, users } from "@db/schema";
import { auth } from "@/lib/auth";
import { newId, newSortableId } from "@/lib/id";
import { checkLimit } from "@/lib/rate-limit";
import { canPostMessage, canReadThread, canStartThread, counterpartOf } from "@/lib/chat/rules";
import {
  cursorSchema, postMessageSchema, startThreadSchema, threadIdSchema,
} from "@/lib/chat/validation";
import { z } from "zod";
import { findThreadByListing, getMessages, type ThreadMessage } from "@/server/chat";
import { notify } from "@/server/notifications";
import { publish } from "@/server/realtime";
import { chatMessageNotify, threadReadNotify } from "@/lib/realtime/events";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/* Отправленное человеком сообщение. Вид и meta заданы константами: этим путём
 * пишутся только реплики, записи о сделке приходят из мутаций заявки. Поля
 * нужны, чтобы эхо в ленте было структурно тем же, что приезжает с сервера, —
 * иначе только что отправленный пузырь считался бы записью и не рисовался. */
export type SentMessage = {
  id: string;
  threadId: string;
  senderUserId: string;
  kind: "user";
  body: string;
  meta: null;
  createdAt: Date;
};

// Общий путь записи для обоих действий: разъехаться этим двум веткам нельзя.
//
// recipientId приходит параметром, а не дочитывается из треда: в postMessage он
// уже вычислен counterpartOf, в startThread это владелец объявления — четвёртый
// запрос внутри транзакции был бы лишним.
async function insertMessage(
  tx: Tx,
  threadId: string,
  senderUserId: string,
  senderIsOwner: boolean,
  body: string,
  recipientId: string | null,
): Promise<SentMessage> {
  // Монотонный id: он же курсор пагинации и единственный ключ сортировки ленты.
  const id = newSortableId();
  const inserted = await tx.insert(chatMessages)
    .values({ id, threadId, senderUserId, kind: "user", body })
    .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt });
  const createdAt = inserted[0].createdAt;

  // greatest() на обеих колонках: две вкладки одного человека могут закоммитить
  // транзакции в обратном порядке, и ни отметка последнего сообщения, ни курсор
  // прочтения не должны при этом уехать назад.
  const cursor = senderIsOwner
    ? chatThreads.ownerLastReadMessageId
    : chatThreads.customerLastReadMessageId;
  await tx.update(chatThreads)
    .set({
      lastMessageAt: sql`greatest(${chatThreads.lastMessageAt}, ${createdAt})`,
      ...(senderIsOwner
        ? { ownerLastReadMessageId: sql`greatest(coalesce(${cursor}, ''), ${id})` }
        : { customerLastReadMessageId: sql`greatest(coalesce(${cursor}, ''), ${id})` }),
    })
    .where(eq(chatThreads.id, threadId));

  // Строго после обновления треда: порядок блокировок chat_threads →
  // notifications держится одинаковым здесь и в markThreadRead, иначе дедлок.
  // entity_id — тред, а не сообщение: иначе частичный UNIQUE не сработает
  // никогда и на тред нападает по строке за сообщение.
  const notified = await notify(tx, {
    recipientId,
    actorId: senderUserId,
    kind: "chat_message",
    // У сообщения сторон сделки нет — поле обязательное, значение явное.
    side: null,
    entityId: threadId,
  });

  // Событие доставки уходит ВСЕГДА, даже когда уведомление схлопнулось: иначе
  // второе и последующие сообщения треда не доехали бы до открытой ленты вовсе.
  // Флаг inserted гейтит только «счётчик +1».
  await publish(tx, chatMessageNotify({
    threadId,
    messageId: id,
    senderId: senderUserId,
    recipientId,
    inserted: notified?.inserted ?? false,
  }));

  return { id, threadId, senderUserId, kind: "user", body, meta: null, createdAt };
}

export async function startThread(
  input: unknown,
): Promise<ActionResult<{ threadId: string; message: SentMessage; created: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };
  const viewer = { id: session.user.id, bannedAt: session.user.bannedAt ?? null };

  const parsed = startThreadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  }
  const { listingId, body } = parsed.data;

  // Лимит до похода в базу — как в createBookingRequest: отклонённый запрос не
  // должен стоить нескольких выборок. Квота на новые треды тратится ниже,
  // только когда тред действительно заводится.
  const messageLimit = checkLimit(viewer.id, "chat_message");
  if (!messageLimit.ok) return { ok: false, error: `rate_limited:${messageLimit.retryAfterSec}` };

  const db = getDb();
  const listingRows = await db.select({
    ownerUserId: listings.ownerUserId,
    status: listings.status,
    ownerBannedAt: users.bannedAt,
  })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.ownerUserId))
    .where(eq(listings.id, listingId))
    .limit(1);
  const listing = listingRows[0];
  if (!listing) return { ok: false, error: "listing_not_found" };

  const verdict = canStartThread(viewer, listing, listing.ownerBannedAt);
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const existing = await findThreadByListing(listingId, viewer.id);

  // Квота на новые треды тратится только когда тред действительно новый:
  // иначе продолжение старой переписки съедало бы защиту от ботов.
  if (!existing) {
    const threadLimit = checkLimit(viewer.id, "chat_thread");
    if (!threadLimit.ok) return { ok: false, error: `rate_limited:${threadLimit.retryAfterSec}` };
  }

  const { message, created } = await db.transaction(async (tx) => {
    let threadId = existing;
    let created = false;
    if (!threadId) {
      // Гонка двух вкладок: UNIQUE (listing_id, customer_user_id) не даст завести
      // второй тред, а повторный SELECT достаёт того, кто выиграл.
      const inserted = await tx.insert(chatThreads)
        .values({
          id: newId(),
          listingId,
          customerUserId: viewer.id,
          ownerUserId: listing.ownerUserId,
        })
        .onConflictDoNothing()
        .returning({ id: chatThreads.id });
      created = inserted.length > 0;
      const rows = await tx.select({ id: chatThreads.id })
        .from(chatThreads)
        .where(and(
          eq(chatThreads.listingId, listingId),
          eq(chatThreads.customerUserId, viewer.id),
        ))
        .limit(1);
      threadId = rows[0].id;
    }
    // Тред заводит арендатор, владельцу это запрещено правилом own_listing.
    return { message: await insertMessage(tx, threadId, viewer.id, false, body, listing.ownerUserId), created };
  });

  // created — переписку завёл именно этот вызов. Тред мог появиться раньше
  // (заметка о заявке из другой вкладки, гонка двух вкладок), и тогда
  // сообщение просто дописано в него: для цели «Начал переписку» это не начало.
  return { ok: true, data: { threadId: message.threadId, message, created } };
}

export async function postMessage(
  input: unknown,
): Promise<ActionResult<{ message: SentMessage }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };
  const viewer = { id: session.user.id, bannedAt: session.user.bannedAt ?? null };

  const parsed = postMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  }
  const { threadId, body } = parsed.data;

  const limit = checkLimit(viewer.id, "chat_message");
  if (!limit.ok) return { ok: false, error: `rate_limited:${limit.retryAfterSec}` };

  const db = getDb();
  const rows = await db.select({
    ownerUserId: chatThreads.ownerUserId,
    customerUserId: chatThreads.customerUserId,
    listingOwnerUserId: listings.ownerUserId,
    status: listings.status,
  })
    .from(chatThreads)
    .innerJoin(listings, eq(listings.id, chatThreads.listingId))
    .where(eq(chatThreads.id, threadId))
    .limit(1);
  const thread = rows[0];
  // Несуществующий и чужой тред отвечают одинаково — намеренно.
  if (!thread) return { ok: false, error: "not_participant" };

  const counterpartId = counterpartOf(thread, viewer.id);
  const counterpartRows = counterpartId
    ? await db.select({ bannedAt: users.bannedAt }).from(users)
      .where(eq(users.id, counterpartId)).limit(1)
    : [];

  const verdict = canPostMessage(
    viewer,
    thread,
    { ownerUserId: thread.listingOwnerUserId, status: thread.status },
    counterpartRows[0]?.bannedAt ?? null,
  );
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const message = await db.transaction((tx) =>
    insertMessage(
      tx, threadId, viewer.id, thread.ownerUserId === viewer.id, body, counterpartId,
    ));

  return { ok: true, data: { message } };
}

// Подгрузка ранней истории кнопкой. Это чтение, но вызывается с клиента, а
// значит доступно по сети напрямую — права проверяются здесь так же, как в
// любой мутации.
export async function fetchOlderMessages(
  threadId: unknown,
  before: unknown,
): Promise<ActionResult<{ messages: ThreadMessage[]; hasMore: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };

  const args = z.object({ threadId: threadIdSchema, before: cursorSchema })
    .safeParse({ threadId, before });
  if (!args.success) return { ok: false, error: "invalid_input" };

  const limit = checkLimit(session.user.id, "chat_read");
  if (!limit.ok) return { ok: false, error: `rate_limited:${limit.retryAfterSec}` };

  const rows = await getDb().select({
    ownerUserId: chatThreads.ownerUserId,
    customerUserId: chatThreads.customerUserId,
  })
    .from(chatThreads)
    .where(eq(chatThreads.id, args.data.threadId))
    .limit(1);
  const thread = rows[0];
  if (!thread || !canReadThread(session.user.id, thread)) {
    return { ok: false, error: "not_participant" };
  }

  return { ok: true, data: await getMessages(args.data.threadId, args.data.before) };
}

export async function markThreadRead(rawThreadId: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };
  const viewerId = session.user.id;

  const parsedId = threadIdSchema.safeParse(rawThreadId);
  if (!parsedId.success) return { ok: false, error: "invalid_input" };
  const threadId = parsedId.data;

  const limit = checkLimit(viewerId, "chat_read");
  if (!limit.ok) return { ok: false, error: `rate_limited:${limit.retryAfterSec}` };

  const db = getDb();
  const rows = await db.select({
    ownerUserId: chatThreads.ownerUserId,
    customerUserId: chatThreads.customerUserId,
  })
    .from(chatThreads)
    .where(eq(chatThreads.id, threadId))
    .limit(1);
  const thread = rows[0];
  if (!thread || !canReadThread(viewerId, thread)) {
    return { ok: false, error: "not_participant" };
  }

  // Сдвиг курсора и гашение уведомлений — одной транзакцией. Порознь они дают
  // гонку: снят latestId = M1, собеседник коммитит M2 с уведомлением, курсор
  // встаёт на M1, а уведомление про M2 гаснет вместе с ним. Бейдж чата покажет
  // «1», список уведомлений будет пуст.
  await db.transaction(async (tx) => {
    const latest = await tx.select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(sql`${chatMessages.id} desc`)
      .limit(1);
    const latestId = latest[0]?.id;
    if (!latestId) return;

    const isOwner = thread.ownerUserId === viewerId;
    const column = isOwner
      ? chatThreads.ownerLastReadMessageId
      : chatThreads.customerLastReadMessageId;

    // greatest(): курсор двигается только вперёд. Открытая старая вкладка,
    // доехавшая позже, не должна возвращать переписку в непрочитанное.
    await tx.update(chatThreads)
      .set(isOwner
        ? { ownerLastReadMessageId: sql`greatest(coalesce(${column}, ''), ${latestId})` }
        : { customerLastReadMessageId: sql`greatest(coalesce(${column}, ''), ${latestId})` })
      .where(eq(chatThreads.id, threadId));

    // Гасим не «всё непрочитанное треда», а только то, что не новее снимка.
    // Сравнение обязано остаться внутри SQL: Postgres хранит микросекунды, а
    // node-postgres отдаёт Date с миллисекундами — пронесённая через JS граница
    // даёт created_at <= $1 равным false на той же самой строке, и гашение не
    // срабатывает никогда. Живого Postgres тесты не требуют, поймать нечем.
    await tx.update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(
        eq(notifications.userId, viewerId),
        eq(notifications.kind, "chat_message"),
        eq(notifications.entityId, threadId),
        isNull(notifications.readAt),
        sql`${notifications.createdAt} <= (
          select ${chatMessages.createdAt} from ${chatMessages}
          where ${chatMessages.id} = ${latestId}
        )`,
      ));

    // Собеседнику — сигнал «твои сообщения прочитаны до этой отметки». Уходит
    // только ему: своё же прочтение читателю ни о чём не говорит. Персистентного
    // уведомления за этим не стоит, счётчики событие не трогает.
    //
    // Последним оператором транзакции, как и все pg_notify: событие не должно
    // обгонять сдвинутый курсор.
    const counterpartId = counterpartOf(thread, viewerId);
    if (counterpartId) {
      await publish(tx, threadReadNotify({
        threadId, upToId: latestId, recipientId: counterpartId,
      }));
    }
  });

  return { ok: true, data: undefined };
}
