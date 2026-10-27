"use server";

// Server actions флоу заявок: создание (покупатель) и отмена (покупатель).
// Подтверждение/отклонение владельцем — в кабинете владельца (следующий этап).
//
// Инварианты:
// - только confirmed-заявка держит bookedQty (см. lib/catalog/booking-status);
//   создание new-заявки availability НЕ трогает;
// - отмена confirmed освобождает даты в той же транзакции, что и смена статуса;
// - протухание new-заявок ленивое: expireStaleRequests() дёргается перед
//   чтением списков, крона в v1 нет.

import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cache } from "react";
import { getDb } from "@/lib/db";
import {
  availability, bookingRequests, events, listings, users,
} from "@db/schema";
import { auth } from "@/lib/auth";
import { newId } from "@/lib/id";
import { checkLimit } from "@/lib/rate-limit";
import { bookingFormSchema } from "@/lib/booking/validation";
import { canTransition, availabilityDelta } from "@/lib/catalog/booking-status";
import { todayStr } from "@/lib/catalog/dates";
import { notify } from "@/server/notifications";
import { publish } from "@/server/realtime";
import { writeDealNote } from "@/server/deal-note";
import { queueBookingMail } from "@/server/booking-mail";
import { requestNotify } from "@/lib/realtime/events";
import { checkBookingSelection } from "@/server/booking-check";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const EXPIRES_HOURS = 24;

export async function createBookingRequest(
  input: unknown,
): Promise<ActionResult<{ requestId: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };
  if (session.user.bannedAt) return { ok: false, error: "banned" };

  const parsed = bookingFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  }
  const form = parsed.data;

  // Honeypot: боту отвечаем «успехом», заявку не создаём.
  if (form.website !== "") return { ok: true, data: { requestId: "" } };

  const limit = checkLimit(session.user.id, "booking");
  if (!limit.ok) return { ok: false, error: `rate_limited:${limit.retryAfterSec}` };
  // Второй контур — по паре с объявлением. Общий потолок поднят, чтобы не бить
  // по честному «присматриваю шесть вещей за вечер»; долбёжку в одну вещь
  // ловит этот ключ. Объявление ещё не прочитано, и это нормально: чужой id
  // тратит квоту того, кто его прислал.
  const perListing = checkLimit(`${session.user.id}:${form.listingId}`, "booking_listing");
  if (!perListing.ok) return { ok: false, error: `rate_limited:${perListing.retryAfterSec}` };

  // Объявление, даты, количество, цены, срок и занятость — общая проверка
  // с заявкой без аккаунта (server/booking-check.ts), порядок отказов прежний.
  const check = await checkBookingSelection(form, { userId: session.user.id });
  if (!check.ok) return { ok: false, error: check.error };
  const { listing, sel } = check;

  const db = getDb();
  const requestId = newId();
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(bookingRequests).values({
        id: requestId,
        listingId: listing.id,
        ownerUserId: listing.ownerUserId,
        customerUserId: session.user.id,
        dateFrom: sel.from,
        dateTo: sel.to,
        qty: sel.qty,
        // Условия на момент заявки — снимком, а не ссылкой на вещь: владелец
        // вправе поменять цену завтра, и стоимость, которую человек видел,
        // выбирая даты, от этого меняться не должна.
        priceDay: listing.priceDay,
        priceWeek: listing.priceWeek,
        priceMonth: listing.priceMonth,
        depositType: listing.depositType,
        depositAmount: listing.depositAmount,
        status: "new",
        customerPhone: form.phone,
        customerComment: form.comment || null,
        expiresAt: new Date(now.getTime() + EXPIRES_HOURS * 60 * 60 * 1000),
      });
      // Телефон из первой заявки запоминаем в профиле для предзаполнения.
      await tx.update(users)
        .set({ phone: form.phone })
        .where(and(eq(users.id, session.user.id), sql`${users.phone} IS NULL`));
      await tx.insert(events).values({
        id: newId(),
        entityType: "listing",
        entityId: listing.id,
        event: "submit_request",
        userId: session.user.id,
        metaJson: { requestId, from: sel.from, to: sel.to, qty: sel.qty },
      });
      // Заявка заводит переписку и открывает журнал сделки. До этого у владельца
      // канала к клиенту не было вовсе: свой тред он начать не может, а телефон
      // и комментарий при отклонении — весь его инструмент.
      await writeDealNote(tx, {
        listingId: listing.id,
        ownerUserId: listing.ownerUserId,
        customerUserId: session.user.id,
        kind: "request_created",
        // Комментарий копией: колонку читает шторка в момент решения, эту —
        // переписка. Копия делается здесь же, одной транзакцией, поэтому
        // разъехаться им негде.
        // Тем же снимком, что лёг в заявку: карточка в переписке и шторка
        // обязаны называть одну сумму.
        meta: {
          requestId, from: sel.from, to: sel.to, qty: sel.qty,
          priceDay: listing.priceDay ?? undefined,
          priceWeek: listing.priceWeek ?? undefined,
          priceMonth: listing.priceMonth ?? undefined,
          depositType: listing.depositType,
          depositAmount: listing.depositAmount ?? undefined,
          comment: form.comment || undefined,
        },
      });
      const notified = await notify(tx, {
        recipientId: listing.ownerUserId,
        actorId: session.user.id,
        kind: "request_created",
        side: "owner",
        entityId: requestId,
      });
      if (notified) {
        await publish(tx, requestNotify({
          kind: "request_created", requestId, recipientId: listing.ownerUserId,
        }));
      }
    });
  } catch (e) {
    /* Дубль ловим индексом, а не проверкой перед вставкой: между чтением и
     * записью помещается вторая вкладка, и от гонки проверка не спасает.
     * 23505 — нарушение уникальности; свой индекс отличаем по имени, чужое
     * нарушение пробрасываем. */
    const code = (e as { code?: string })?.code;
    const detail = String((e as { constraint?: string })?.constraint ?? "");
    if (code === "23505" && detail === "booking_requests_live_dup_uq") {
      return { ok: false, error: "duplicate_request" };
    }
    throw e;
  }

  queueBookingMail({
    kind: "created",
    recipientId: listing.ownerUserId,
    listingTitle: listing.title,
    dateFrom: sel.from,
    dateTo: sel.to,
  });
  revalidatePath("/cabinet/requests");
  // И сводка: новая заявка встаёт в её панель такой же строкой.
  revalidatePath("/cabinet");
  return { ok: true, data: { requestId } };
}

export async function cancelBookingRequest(requestId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };

  const db = getDb();
  let mail: Parameters<typeof queueBookingMail>[0] | null = null;
  try {
    await db.transaction(async (tx) => {
      /* ПЕРВЫМ лочится объявление — то же правило, что в actions/owner.ts.
       * Без него отмена брала строку заявки, а подтверждение — объявление, и
       * два пути вставали во встречном порядке: подтверждение держит
       * объявление и тянется к заявке, отмена держит заявку и тянется к
       * занятости, которую подтверждение уже забрало. */
      const idRows = await tx
        .select({ listingId: bookingRequests.listingId })
        .from(bookingRequests)
        .where(eq(bookingRequests.id, requestId))
        .limit(1);
      if (!idRows[0]) throw new Error("not_found");
      await tx.select({ id: listings.id }).from(listings)
        .where(eq(listings.id, idRows[0].listingId)).for("update").limit(1);

      const rows = await tx.select().from(bookingRequests)
        .where(eq(bookingRequests.id, requestId))
        .for("update")
        .limit(1);
      const req = rows[0];
      if (!req || req.customerUserId !== session.user.id) throw new Error("not_found");
      if (!canTransition(req.status, "cancelled")) throw new Error("bad_status");

      // Отмена confirmed освобождает даты; new ничего не держит.
      if (availabilityDelta(req.status, "cancelled") === -1) {
        await tx.update(availability)
          .set({ bookedQty: sql`greatest(0, ${availability.bookedQty} - ${req.qty})` })
          .where(and(
            eq(availability.listingId, req.listingId),
            gte(availability.date, req.dateFrom),
            lte(availability.date, req.dateTo),
          ));
      }

      await tx.update(bookingRequests)
        .set({ status: "cancelled", respondedAt: new Date() })
        .where(eq(bookingRequests.id, requestId));

      await tx.insert(events).values({
        id: newId(),
        entityType: "booking_request",
        entityId: requestId,
        event: "cancel_request",
        userId: session.user.id,
        metaJson: { fromStatus: req.status },
      });
      await writeDealNote(tx, {
        listingId: req.listingId,
        ownerUserId: req.ownerUserId,
        customerUserId: req.customerUserId,
        kind: "request_cancelled",
        meta: { requestId, from: req.dateFrom, to: req.dateTo, qty: req.qty },
      });
      const titleRows = await tx.select({ title: listings.title })
        .from(listings).where(eq(listings.id, req.listingId)).limit(1);
      mail = {
        // Отзыв new и отмена confirmed — разные события: во втором случае
        // рушится существующая договорённость, в первом её ещё не было.
        kind: req.status === "confirmed" ? "cancelled" : "withdrawn",
        recipientId: req.ownerUserId,
        listingTitle: titleRows[0]?.title ?? "",
        dateFrom: req.dateFrom,
        dateTo: req.dateTo,
      };
      // Отменяет арендатор — узнать об этом должен владелец.
      const notified = await notify(tx, {
        recipientId: req.ownerUserId,
        actorId: session.user.id,
        kind: "request_cancelled",
        side: "owner",
        entityId: requestId,
      });
      if (notified) {
        await publish(tx, requestNotify({
          kind: "request_cancelled", requestId, recipientId: req.ownerUserId,
        }));
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg === "not_found" || msg === "bad_status") return { ok: false, error: msg };
    throw e;
  }

  if (mail) queueBookingMail(mail);
  revalidatePath("/cabinet/requests");
  // И сводка: отменённая бронь стоит в её панели такой же строкой, как в ленте.
  revalidatePath("/cabinet");
  return { ok: true, data: undefined };
}

/* Две ленивые уборки, обе перед чтением списков: крона в проде нет.
 *
 * Протухание: new с истёкшим expires_at становится expired.
 * Закрытие: confirmed с прошедшим date_to становится completed — итог аренды
 * следует из календаря, а не из нажатия владельца. Отмечать состоявшуюся
 * аренду его больше не просят; единственное, чего календарь не знает, —
 * «сдавать передумали», и для этого есть отмена.
 *
 * Ни та, ни другая не уведомляют и не пишут в журнал сделки: это массовые
 * UPDATE внутри чужого рендера, и запись по строке превратила бы их в N+1.
 * Исключение названо в ADR 0017 и расширено на закрытие в ADR 0018.
 *
 * Обёрнуто в cache(): за один рендер кабинета уборку зовут до трёх раз —
 * счётчик в layout, сводка, список объявлений, — а работа у неё одна.
 *
 * День берём деловой (Europe/Moscow), а не current_date базы: у контейнера db
 * зона не задана, и с полуночи до трёх ночи по Москве он отдавал бы вчерашний
 * день — закрытие опаздывало бы на три часа.
 *
 * Даты закрытая бронь не освобождает, и это верно: диапазон уже прожит,
 * история занятости честная. Прошлые дни всё равно никем не читаются —
 * все выборки занятости начинаются с сегодня. */
export const expireStaleRequests = cache(async (): Promise<void> => {
  const db = getDb();
  const now = new Date();
  await db.update(bookingRequests)
    .set({ status: "expired", respondedAt: now })
    .where(and(
      eq(bookingRequests.status, "new"),
      lt(bookingRequests.expiresAt, now),
    ));
  await db.update(bookingRequests)
    .set({ status: "completed", respondedAt: now })
    .where(and(
      eq(bookingRequests.status, "confirmed"),
      lt(bookingRequests.dateTo, todayStr()),
    ));
});

