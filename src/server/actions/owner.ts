"use server";

// Server actions кабинета: товары, решения по заявкам, ручное закрытие дат.
// «Владелец» — любой залогиненный юзер с товарами; отдельной сущности нет.
//
// Инварианты (см. lib/catalog/booking-status):
// - подтверждение заявки увеличивает bookedQty на диапазон в ТОЙ ЖЕ транзакции,
//   что и смена статуса; перед этим занятость перепроверяется под блокировкой;
// - завершение вовремя дат не освобождает: диапазон прожит. Досрочный
//   возврат освобождает ОСТАТОК — граница по дате, и живёт она здесь, а не
//   в availabilityDelta: та чистая функция от пары статусов со знаком;
// - отмена confirmed освобождает весь диапазон, и веток две: у арендатора в
//   actions/booking.ts, у владельца здесь. Свести их в одну нельзя — права и
//   набор блокировок у путей разные;
// - blocked_qty — ручные закрытия владельцем, не пересекается с booked_qty.
//
// LOCK ORDER. Всё, что трогает заявки или занятость одного объявления, лочит
// СНАЧАЛА строку объявления, и только потом заявки и availability. Правило
// действует и здесь, и в actions/booking.ts, и нарушать его нельзя: до него
// подтверждение брало свою строку заявки, потом набор по объявлению, а вторая
// транзакция — в обратном порядке, и два подтверждения по одной вещи вставали
// в дедлок. Одна точка сериализации на объявление снимает это целиком.

import { and, asc, eq, gt, gte, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import {
  availability, bookingRequests, events, listings, users,
} from "@db/schema";
import { auth } from "@/lib/auth";
import { newId } from "@/lib/id";
import { todayStr } from "@/lib/catalog/dates";
import { slugify } from "@/lib/slugify";
import { listingFormSchema } from "@/lib/owner/validation";
import { parseSellerName } from "@/lib/owner/seller-name";
import {
  unavailableDates, eachDate, type AvailabilityMap,
} from "@/lib/catalog/availability";
import { canTransition } from "@/lib/catalog/booking-status";
import { kindForDecision, type OwnerDecision } from "@/lib/notifications/kinds";
import { writeDealNote } from "@/server/deal-note";
import { queueBookingMail } from "@/server/booking-mail";
import { notify } from "@/server/notifications";
import { publish } from "@/server/realtime";
import { requestNotify } from "@/lib/realtime/events";
import { invalidateSearchIndex } from "@/server/search-index";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function requireUser(): Promise<{ userId: string } | null> {
  const session = await auth();
  if (!session?.user?.id || session.user.bannedAt) return null;
  return { userId: session.user.id };
}

// ============================== Товары ==============================

export async function createListing(input: unknown): Promise<ActionResult<{ listingId: string }>> {
  const owner = await requireUser();
  if (!owner) return { ok: false, error: "auth_required" };

  const parsed = listingFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const form = parsed.data;

  // Имя продавца приезжает тем же вызовом отдельным ключом: listingFormSchema
  // не strict, лишний ключ она отбрасывает, поэтому достаём его из сырого ввода.
  const sellerName = parseSellerName(input);
  if (!sellerName.ok) return { ok: false, error: sellerName.error };

  const slug = slugify(form.title);
  if (!slug) return { ok: false, error: "Название должно содержать буквы или цифры" };

  // Пустое поле не затирает имя: значит человек его просто не трогал.
  if (sellerName.name) {
    await getDb().update(users).set({ name: sellerName.name }).where(eq(users.id, owner.userId));
  }

  const id = newId();
  // Без премодерации: товар сразу active. Уникальность URL даёт id в хвосте пути.
  await getDb().insert(listings).values({
    id,
    ownerUserId: owner.userId,
    cityId: form.cityId,
    categoryId: form.categoryId,
    title: form.title,
    slug,
    description: form.description || null,
    location: form.location || null,
    priceDay: form.priceDay,
    depositAmount: form.depositType === "money" ? form.depositAmount : null,
    depositType: form.depositType,
    quantity: form.quantity,
    handoverPickup: form.handoverPickup,
    handoverDelivery: form.handoverDelivery,
    photosJson: form.photos,
    status: "active",
  });

  // Подсказки и /search идут по индексу в памяти: без сброса новая вещь
  // появилась бы в них только после сверки версии.
  invalidateSearchIndex();
  revalidatePath("/cabinet/listings");
  return { ok: true, data: { listingId: id } };
}

export async function updateListing(listingId: string, input: unknown): Promise<ActionResult> {
  const owner = await requireUser();
  if (!owner) return { ok: false, error: "auth_required" };

  const parsed = listingFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const form = parsed.data;

  const res = await getDb().update(listings)
    .set({
      cityId: form.cityId,
      categoryId: form.categoryId,
      title: form.title, // слаг сохраняем: URL позиции не должен ломаться
      description: form.description || null,
      location: form.location || null,
      priceDay: form.priceDay,
      depositAmount: form.depositType === "money" ? form.depositAmount : null,
      depositType: form.depositType,
      quantity: form.quantity,
      handoverPickup: form.handoverPickup,
      handoverDelivery: form.handoverDelivery,
      photosJson: form.photos,
      updatedAt: new Date(),
    })
    .where(and(eq(listings.id, listingId), eq(listings.ownerUserId, owner.userId)))
    .returning({ id: listings.id });
  if (res.length === 0) return { ok: false, error: "not_found" };

  invalidateSearchIndex();
  revalidatePath("/cabinet/listings");
  revalidatePath(`/cabinet/listings/${listingId}`);
  return { ok: true, data: undefined };
}

// Статус приходит извне и типу не соответствует автоматически: экшен доступен
// по сети напрямую, а произвольная строка доехала бы до enum-колонки и дала 500
// вместо внятного отказа.
const setStatusSchema = z.object({
  listingId: z.string().min(1),
  status: z.enum(["active", "hidden", "archived"]),
});

export async function setListingStatus(
  listingId: string,
  status: "active" | "hidden" | "archived",
): Promise<ActionResult> {
  const owner = await requireUser();
  if (!owner) return { ok: false, error: "auth_required" };

  const parsed = setStatusSchema.safeParse({ listingId, status });
  if (!parsed.success) return { ok: false, error: "bad_status" };

  // hiddenByBan снимается вместе с явной сменой статуса, чтобы метка означала
  // ровно одно: строку погасил бан и с тех пор статуса никто не касался. Сюда
  // забаненный не дойдёт (requireUser его отсекает), но инвариант должен
  // держаться на любом пути записи, а не на рассуждении о достижимости.
  const res = await getDb().update(listings)
    .set({ status: parsed.data.status, hiddenByBan: false, updatedAt: new Date() })
    .where(and(eq(listings.id, parsed.data.listingId), eq(listings.ownerUserId, owner.userId)))
    .returning({ id: listings.id });
  if (res.length === 0) return { ok: false, error: "not_found" };

  // Скрытое объявление должно пропасть из подсказок сразу, а не через 30 с.
  invalidateSearchIndex();
  revalidatePath("/cabinet/listings");
  return { ok: true, data: undefined };
}

// ============================== Заявки ==============================

/* Отказы, о которых человеку есть что сказать: внутри транзакции они летят
 * исключением, наружу уходят кодом. Всё остальное — настоящая поломка, и её
 * нужно ронять, а не показывать как отказ.
 *
 * Списком, а не цепочкой сравнений: новый код отказа иначе молча превращается
 * в 500 — ровно это и случилось с not_started, пока его сюда не добавили.
 * `dates_taken:` проверяется отдельно — он несёт в себе список дат. */
const KNOWN_REFUSALS = new Set(["not_found", "bad_status", "not_started"]);

/* Сколько соседних заявок закрывает одно подтверждение. Потолок нужен: набор
 * лочится целиком внутри транзакции подтверждения, и на популярной вещи он
 * может быть большим. Что сверху — протухнет само, через сутки. */
const RIVALS_LIMIT = 50;

async function transitionRequest(
  requestId: string,
  to: OwnerDecision,
): Promise<ActionResult> {
  const owner = await requireUser();
  if (!owner) return { ok: false, error: "auth_required" };
  const userId = owner.userId;

  const db = getDb();
  let mail: Parameters<typeof queueBookingMail>[0] | null = null;
  const rivalMails: Parameters<typeof queueBookingMail>[0][] = [];
  try {
    await db.transaction(async (tx) => {
      // Какая это вещь — читаем без блокировки: лочить надо объявление, а его
      // id иначе неоткуда взять.
      const idRows = await tx
        .select({ listingId: bookingRequests.listingId, ownerUserId: bookingRequests.ownerUserId })
        .from(bookingRequests)
        .where(eq(bookingRequests.id, requestId))
        .limit(1);
      const head = idRows[0];
      if (!head || head.ownerUserId !== userId) throw new Error("not_found");

      /* ПЕРВЫМ лочится объявление — правило на весь модуль, см. LOCK ORDER в
       * шапке файла. Оно даёт одну точку сериализации на вещь, и порядок
       * захвата строк заявок дальше уже не важен.
       *
       * Без него было так: одна транзакция брала свою строку заявки, потом
       * набор по объявлению; вторая — свою, потом тот же набор. Порядок
       * встречный, и два подтверждения по одной вещи вставали в дедлок.
       * Воспроизводилось двумя сессиями за секунды. */
      const lrows = await tx.select().from(listings)
        .where(eq(listings.id, head.listingId)).for("update").limit(1);
      const listing = lrows[0];
      if (!listing) throw new Error("not_found");
      const listingQuantity = listing.quantity;

      /* Заявка и её соседи — одним упорядоченным запросом. Подтверждение
       * занимает даты, и пересекающиеся заявки становятся невыполнимыми:
       * раньше они висели сутки, а владелец узнавал об этом, только нажав
       * «Подтвердить» и получив «даты заняты».
       *
       * Пересечение диапазонов обязательно. Без него закрывались бы и заявки,
       * к которым это подтверждение отношения не имеет, — например лежащие на
       * датах, закрытых руками полгода назад. */
      const locked = await tx.select().from(bookingRequests)
        .where(and(
          eq(bookingRequests.listingId, head.listingId),
          or(eq(bookingRequests.id, requestId), eq(bookingRequests.status, "new")),
        ))
        .orderBy(asc(bookingRequests.id))
        .for("update")
        .limit(RIVALS_LIMIT);

      const req = locked.find((r) => r.id === requestId);
      if (!req || req.ownerUserId !== userId) throw new Error("not_found");
      if (!canTransition(req.status, to)) throw new Error("bad_status");

      // Соседи — только пересекающиеся по датам и только ждущие ответа.
      const rivals = to === "confirmed"
        ? locked.filter((r) => r.id !== requestId
          && r.status === "new"
          && r.dateFrom <= req.dateTo && r.dateTo >= req.dateFrom)
        : [];

      if (to === "confirmed") {
        const availRows = await tx.select().from(availability)
          .where(and(
            eq(availability.listingId, req.listingId),
            gte(availability.date, req.dateFrom),
            lte(availability.date, req.dateTo),
          ))
          .for("update");
        const map: AvailabilityMap = new Map(
          availRows.map((r) => [r.date, { bookedQty: r.bookedQty, blockedQty: r.blockedQty }]),
        );
        const busy = unavailableDates(listing.quantity, map, req.dateFrom, req.dateTo, req.qty);
        if (busy.length > 0) throw new Error(`dates_taken:${busy.join(",")}`);

        for (const date of eachDate(req.dateFrom, req.dateTo)) {
          await tx.insert(availability)
            .values({ listingId: req.listingId, date, bookedQty: req.qty })
            .onConflictDoUpdate({
              target: [availability.listingId, availability.date],
              set: { bookedQty: sql`${availability.bookedQty} + ${req.qty}` },
            });
        }
      }

      /* Вещь вернули раньше срока: аренда состоялась, но остаток дней должен
       * вернуться в продажу. Освобождаем строго БУДУЩЕЕ — прожитые дни вещь
       * действительно была занята, и делать вид, что она была свободна, нельзя.
       *
       * Здесь же умирает прежняя ловушка «завершил в первый день — даты
       * заперты навсегда»: закрытие первым днём теперь освобождает всё, что
       * после него, и это верный ответ — вещь вернулась.
       *
       * Частичное освобождение не выражается через availabilityDelta: та —
       * чистая функция от пары статусов со знаком, а тут граница по дате. */
      if (to === "completed") {
        if (req.status !== "confirmed") throw new Error("bad_status");
        const from = todayStr();
        /* Нижняя граница обязательна. Без неё «вернули раньше» закрывало бы и
         * бронь, которая ещё не начиналась: освобождался бы ВЕСЬ диапазон, а
         * аренда, которой не было, попадала в публичный счётчик сделок — ровно
         * тот дефект, за который сняли «неявку». Не начавшаяся бронь
         * расторгается, а не завершается: для этого есть «Отменить бронь». */
        if (req.dateFrom > from) throw new Error("not_started");
        if (req.dateTo > from) {
          await tx.update(availability)
            .set({ bookedQty: sql`greatest(0, ${availability.bookedQty} - ${req.qty})` })
            .where(and(
              eq(availability.listingId, req.listingId),
              gt(availability.date, from),
              lte(availability.date, req.dateTo),
            ));
        }
      }

      /* Владелец отменяет подтверждённую бронь — даты освобождаются. Ветка
       * повторяет ту, что в cancelBookingRequest у арендатора: держать
       * освобождение дат в одном месте нельзя, потому что права и блокировки у
       * этих двух путей разные.
       *
       * Ограничение статусом обязательно: машина разрешает и `new → cancelled`,
       * а экшен доступен по сети мимо интерфейса. Без него владелец «отменял»
       * бы новую заявку вместо отказа — другое уведомление, другой текст в
       * журнале и никакого комментария клиенту. */
      if (to === "cancelled") {
        if (req.status !== "confirmed") throw new Error("bad_status");
        await tx.update(availability)
          .set({ bookedQty: sql`greatest(0, ${availability.bookedQty} - ${req.qty})` })
          .where(and(
            eq(availability.listingId, req.listingId),
            gte(availability.date, req.dateFrom),
            lte(availability.date, req.dateTo),
          ));
      }

      await tx.update(bookingRequests)
        .set({
          status: to,
          respondedAt: new Date(),
          // Ставится один раз и не стирается: на неё смотрит правило
          // раскрытия телефона, а responded_at перезапишет любое следующее
          // решение.
          ...(to === "confirmed" ? { confirmedAt: new Date() } : {}),
        })
        .where(eq(bookingRequests.id, requestId));

      // Закрываем тех, кому подтверждение только что перекрыло даты. Пересчёт
      // идёт по уже обновлённой занятости, поэтому «не помещается» здесь —
      // факт, а не прогноз.
      for (const rival of rivals) {
        if (rival.id === requestId) continue;
        const availRows = await tx.select().from(availability)
          .where(and(
            eq(availability.listingId, rival.listingId),
            gte(availability.date, rival.dateFrom),
            lte(availability.date, rival.dateTo),
          ));
        const map: AvailabilityMap = new Map(
          availRows.map((r) => [r.date, { bookedQty: r.bookedQty, blockedQty: r.blockedQty }]),
        );
        if (unavailableDates(listingQuantity, map, rival.dateFrom, rival.dateTo, rival.qty).length === 0) {
          continue;
        }
        await tx.update(bookingRequests)
          .set({ status: "declined", respondedAt: new Date() })
          .where(eq(bookingRequests.id, rival.id));
        await writeDealNote(tx, {
          listingId: rival.listingId,
          ownerUserId: rival.ownerUserId,
          customerUserId: rival.customerUserId,
          kind: "request_declined",
          meta: { requestId: rival.id, from: rival.dateFrom, to: rival.dateTo, qty: rival.qty },
        });
        // Для арендатора конкурента это тот же отказ, что и ручной, — и
        // письмо то же. Копим и шлём после коммита: писем внутри транзакции
        // не бывает. Набор ограничен RIVALS_LIMIT, ящик — квотой получателя.
        rivalMails.push({
          kind: "declined",
          recipientId: rival.customerUserId,
          listingTitle: listing.title,
          dateFrom: rival.dateFrom,
          dateTo: rival.dateTo,
        });
        const rivalNotified = await notify(tx, {
          recipientId: rival.customerUserId,
          actorId: userId,
          kind: "request_declined",
          side: "customer",
          entityId: rival.id,
        });
        if (rivalNotified) {
          await publish(tx, requestNotify({
            kind: "request_declined", requestId: rival.id, recipientId: rival.customerUserId,
          }));
        }
      }

      await tx.insert(events).values({
        id: newId(),
        entityType: "booking_request",
        entityId: requestId,
        event: `request_${to}`,
        userId,
        metaJson: { fromStatus: req.status },
      });
      await writeDealNote(tx, {
        listingId: req.listingId,
        ownerUserId: req.ownerUserId,
        customerUserId: req.customerUserId,
        kind: `request_${to}`,
        meta: { requestId, from: req.dateFrom, to: req.dateTo, qty: req.qty },
      });
      // Письмо — только там, где арендатору есть о чём узнать срочно:
      // подтверждение (пора договариваться), отказ и отмена (планы рухнули).
      // Завершение не шлём: досрочное закрытие отмечает тот факт, что вещь
      // ему же и вернули, — новостью это не является.
      if (to === "confirmed" || to === "declined" || to === "cancelled") {
        mail = {
          kind: to,
          recipientId: req.customerUserId,
          listingTitle: listing.title,
          dateFrom: req.dateFrom,
          dateTo: req.dateTo,
        };
      }
      // Решение принимает владелец — узнать о нём должен арендатор.
      const notified = await notify(tx, {
        recipientId: req.customerUserId,
        actorId: userId,
        kind: kindForDecision(to),
        side: "customer",
        entityId: requestId,
      });
      if (notified) {
        await publish(tx, requestNotify({
          kind: kindForDecision(to), requestId, recipientId: req.customerUserId,
        }));
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (KNOWN_REFUSALS.has(msg) || msg.startsWith("dates_taken:")) {
      return { ok: false, error: msg };
    }
    throw e;
  }

  // Лента одна на обе роли, поэтому адрес тоже один. Сводка — отдельно:
  // решение принимают и там, и карточка «требует действия» обязана уйти.
  if (mail) queueBookingMail(mail);
  for (const m of rivalMails) queueBookingMail(m);
  revalidatePath("/cabinet/requests");
  revalidatePath("/cabinet");
  return { ok: true, data: undefined };
}

export async function confirmRequest(requestId: string): Promise<ActionResult> {
  return transitionRequest(requestId, "confirmed");
}
export async function declineRequest(requestId: string): Promise<ActionResult> {
  return transitionRequest(requestId, "declined");
}

/* Закрыть бронь досрочно: вещь вернули раньше срока. Аренда засчитывается
 * состоявшейся, остаток дней возвращается в продажу. Вовремя завершённую
 * бронь нажимать не нужно — она закроется сама. */
export async function completeRequest(requestId: string): Promise<ActionResult> {
  return transitionRequest(requestId, "completed");
}

/* Владелец отменяет подтверждённую бронь. Раньше отменить её мог только
 * арендатор, и владельцу, у которого вещь сломалась или он заболел, оставалась
 * «Неявка» — то есть обвинить клиента в том, чего тот не делал. */
export async function cancelConfirmedByOwner(requestId: string): Promise<ActionResult> {
  return transitionRequest(requestId, "cancelled");
}

// ============================== Календарь ==============================

// Ручное закрытие дат («сдал по телефону», «в ремонте»): выставляет blocked_qty
// на диапазон. qty=0 открывает даты обратно. Клампится к quantity позиции.
export async function setBlockedDates(
  listingId: string,
  dateFrom: string,
  dateTo: string,
  blockedQty: number,
): Promise<ActionResult> {
  const owner = await requireUser();
  if (!owner) return { ok: false, error: "auth_required" };

  if (!Number.isInteger(blockedQty) || blockedQty < 0) return { ok: false, error: "bad_qty" };

  const db = getDb();
  const lrows = await db.select().from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.ownerUserId, owner.userId)))
    .limit(1);
  const listing = lrows[0];
  if (!listing) return { ok: false, error: "not_found" };

  let dates: string[];
  try { dates = eachDate(dateFrom, dateTo); } catch { return { ok: false, error: "bad_dates" }; }
  if (dates.length > 366) return { ok: false, error: "range_too_long" };

  const qty = Math.min(blockedQty, listing.quantity);
  await db.transaction(async (tx) => {
    for (const date of dates) {
      await tx.insert(availability)
        .values({ listingId, date, blockedQty: qty })
        .onConflictDoUpdate({
          target: [availability.listingId, availability.date],
          set: { blockedQty: qty },
        });
    }
  });

  revalidatePath(`/cabinet/listings/${listingId}`);
  return { ok: true, data: undefined };
}
