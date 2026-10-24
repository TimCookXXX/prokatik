// Сводка кабинета: одна страница вместо обхода пяти разделов.

import { and, desc, eq, gt, gte, inArray, lte, or, sql } from "drizzle-orm";
import { QueryBuilder, alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import {
  availability, bookingRequests, categories, chatThreads, cities, listings, users, visitorEvents, visitors,
} from "@db/schema";
import { expireStaleRequests } from "@/server/actions/booking";
import { APP_TIME_ZONE, todayStr, addDaysStr } from "@/lib/catalog/dates";
import type { BookingStatus } from "@/lib/catalog/booking-status";
import {
  disclosedPhone, requestSide, type RequestSide,
} from "@/lib/booking/request-access";
import type { LinkableListing } from "@/lib/booking/listing-link";
import type { DepositType } from "@/lib/catalog/format";
import { getUnreadByThread } from "@/server/chat";
import { summaryRows, toFeedRow } from "@/server/requests-feed";
import type { FeedRow } from "@/components/cabinet/RequestsFeed";

/* Строка ленты заявок — одна на обе роли. Полей ownerPhone и customerPhone
 * здесь нет намеренно: наружу уходит только peerPhone, уже прошедший через
 * правило раскрытия. Показать не тот телефон из этой строки неоткуда. */
export interface CabinetRequestRow {
  id: string;
  /** Кто я в этой заявке. Единственный источник ролевых решений в интерфейсе. */
  side: RequestSide;
  status: BookingStatus;
  dateFrom: string;
  dateTo: string;
  qty: number;
  createdAt: Date;
  expiresAt: Date;
  customerComment: string | null;
  /* Условия сделки на момент заявки, а не сегодняшние условия вещи. Владелец
   * вправе поменять цену в любой день, и без снимка стоимость старой заявки
   * ползла бы вслед за ней — человек видел бы не ту сумму, на которую
   * соглашался. Снимок лежит колонками самой заявки, см. drizzle/schema.ts.
   * Тарифы — все три: сумма за срок считается по лестнице (lib/catalog/tariff). */
  priceDay: number | null;
  priceWeek: number | null;
  priceMonth: number | null;
  depositType: DepositType;
  depositAmount: number | null;
  /** Всё, что нужно ссылке на вещь: публичный контур закрывают и статус, и бан
   *  владельца — см. lib/booking/listing-link. */
  listing: LinkableListing & { title: string; image: string | null };
  /** Переписка пары (вещь, арендатор). Пусто у заявок, созданных до журнала
   *  сделки, по которым ещё не принималось решение. */
  threadId: string | null;
  peer: { id: string; name: string | null };
  /** Телефон второй стороны или null — см. lib/booking/request-access. */
  peerPhone: string | null;
}

export interface CabinetRequestsOptions {
  /** Сужает выдачу до одной стороны. Расширить ею права нельзя — см. ниже. */
  role?: RequestSide;
  listingId?: string;
  statuses?: readonly BookingStatus[];
  /** Без значения — без ограничения: пагинации в проекте нет, и молча
   *  обрезанная лента потеряла бы заявку без единого признака. */
  limit?: number;
}

/* Условие выборки — отдельной функцией, чтобы главное её свойство проверялось
 * тестом: права ставятся всегда, а role добавляется через AND и только сужает.
 * Подменять им базовый предикат нельзя — параметр приходит из адреса, и при
 * подмене он расширял бы выдачу вместо того, чтобы её сужать. */
export function cabinetRequestsWhere(userId: string, opts: CabinetRequestsOptions = {}) {
  const conds = [or(
    eq(bookingRequests.ownerUserId, userId),
    eq(bookingRequests.customerUserId, userId),
  )];
  if (opts.role === "owner") conds.push(eq(bookingRequests.ownerUserId, userId));
  if (opts.role === "customer") conds.push(eq(bookingRequests.customerUserId, userId));
  if (opts.listingId !== undefined) conds.push(eq(bookingRequests.listingId, opts.listingId));
  // Пустой список статусов — это «ни одного», а не «любой»: на этапе слияния
  // значения поедут из адреса, и «фильтр ничего не выбрал» обязан дать пустую
  // ленту, а не всю. inArray пустой массив не принимает, поэтому явное false.
  if (opts.statuses !== undefined) {
    conds.push(opts.statuses.length === 0
      ? sql`false`
      : inArray(bookingRequests.status, [...opts.statuses]));
  }
  return and(...conds);
}

/* Условие плитки «просмотров за неделю» — отдельной функцией, как у ленты
 * заявок: его свойства держит тест. Просмотр — событие view_listing своей
 * статистики (его пишет маяк страницы объявления, свою вещь владелец не
 * «просматривает»), только по вещам этого человека, без ботов и своих заходов
 * (админ, проверяющий объявления, — не спрос покупателя) и за срок.
 * Таблица visitors должна быть в запросе: признаки — у браузера. */
export function cabinetViewsWhere(userId: string, since: Date) {
  const myListings = new QueryBuilder()
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.ownerUserId, userId));
  return and(
    eq(visitorEvents.type, "view_listing"),
    gte(visitorEvents.createdAt, since),
    eq(visitors.isBot, false),
    eq(visitors.isInternal, false),
    inArray(visitorEvents.listingId, myListings),
  );
}

/* Заявки, где я любая из сторон. Заменяет две прежние выборки — владельца и
 * арендатора, — которые расходились сортировкой, набором полей и правилом
 * раскрытия телефона.
 *
 * Один запрос, а не два со склейкой: лимит, применённый до склейки, обрезал бы
 * не то. Протухание — лениво, как и у прежних двух: крона в проекте нет. */
export async function getCabinetRequests(
  userId: string,
  opts: CabinetRequestsOptions = {},
): Promise<CabinetRequestRow[]> {
  await expireStaleRequests();

  const peer = alias(users, "peer");
  // Владелец вещи отдельным join'ом, а не через peer: peer им оказывается
  // только когда смотрит арендатор, а бан нужен знать в обоих случаях.
  const lister = alias(users, "lister");

  const query = getDb()
    .select({
      id: bookingRequests.id,
      status: bookingRequests.status,
      dateFrom: bookingRequests.dateFrom,
      dateTo: bookingRequests.dateTo,
      qty: bookingRequests.qty,
      createdAt: bookingRequests.createdAt,
      expiresAt: bookingRequests.expiresAt,
      confirmedAt: bookingRequests.confirmedAt,
      customerComment: bookingRequests.customerComment,
      ownerUserId: bookingRequests.ownerUserId,
      customerUserId: bookingRequests.customerUserId,
      customerPhone: bookingRequests.customerPhone,
      listingId: listings.id,
      listingTitle: listings.title,
      listingSlug: listings.slug,
      listingStatus: listings.status,
      // Обложка в SQL, как в getThreadList: весь photos_json ради миниатюры
      // не тянем.
      listingImage: sql<string | null>`${listings.photosJson}->0->>'url'`,
      priceDay: bookingRequests.priceDay,
      priceWeek: bookingRequests.priceWeek,
      priceMonth: bookingRequests.priceMonth,
      depositType: bookingRequests.depositType,
      depositAmount: bookingRequests.depositAmount,
      listerBannedAt: lister.bannedAt,
      threadId: chatThreads.id,
      citySlug: cities.slug,
      categorySlug: categories.slug,
      peerId: peer.id,
      peerName: peer.name,
      peerPhone: peer.phone,
    })
    .from(bookingRequests)
    .innerJoin(listings, eq(listings.id, bookingRequests.listingId))
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .innerJoin(lister, eq(lister.id, listings.ownerUserId))
    // Тред пары (вещь, арендатор) — leftJoin: у заявок старше журнала сделки
    // его может не быть, и строка ленты обязана выжить без него.
    .leftJoin(chatThreads, and(
      eq(chatThreads.listingId, listings.id),
      eq(chatThreads.customerUserId, bookingRequests.customerUserId),
    ))
    // Вторая сторона одним join'ом: кто именно — решает та же колонка, что и
    // права, поэтому условие вычисляется, а не выбирается снаружи.
    .innerJoin(peer, sql`${peer.id} = case
      when ${bookingRequests.ownerUserId} = ${userId} then ${bookingRequests.customerUserId}
      else ${bookingRequests.ownerUserId} end`)
    .where(cabinetRequestsWhere(userId, opts))
    // Ровно прежний порядок обеих лент: у владельца новые наверх, у арендатора
    // таких строк нет и остаётся чистая свежесть. Расширять ключ нельзя —
    // «жду ответа» и «мне действовать» это разные вещи.
    .orderBy(
      sql`case when ${bookingRequests.ownerUserId} = ${userId}
        and ${bookingRequests.status} = 'new' then 0 else 1 end`,
      desc(bookingRequests.createdAt),
    );

  const rows = opts.limit !== undefined ? await query.limit(opts.limit) : await query;

  return rows.flatMap((r) => {
    const parties = { ownerUserId: r.ownerUserId, customerUserId: r.customerUserId };
    const side = requestSide(parties, userId);
    // Чужая строка сюда не доедет — условие выборки её отсекает. Пустой массив
    // вместо исключения: сторож не должен ронять страницу.
    if (!side) return [];
    const status = r.status as BookingStatus;
    return [{
      id: r.id,
      side,
      status,
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      qty: r.qty,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      customerComment: r.customerComment,
      priceDay: r.priceDay,
      priceWeek: r.priceWeek,
      priceMonth: r.priceMonth,
      depositType: r.depositType,
      depositAmount: r.depositAmount,
      listing: {
        id: r.listingId,
        title: r.listingTitle,
        slug: r.listingSlug,
        citySlug: r.citySlug,
        categorySlug: r.categorySlug,
        status: r.listingStatus,
        ownerBannedAt: r.listerBannedAt,
        image: r.listingImage,
      },
      threadId: r.threadId,
      peer: { id: r.peerId, name: r.peerName },
      // peer.phone — профиль второй стороны, и владельцем она оказывается
      // только когда смотрит арендатор. Подставлять её как ownerPhone в другом
      // случае нельзя: сейчас правило туда не заглядывает, но подпись «телефон
      // владельца» под телефоном клиента — заготовленная утечка.
      peerPhone: disclosedPhone({
        ...parties,
        confirmedAt: r.confirmedAt,
        customerPhone: r.customerPhone,
        ownerPhone: side === "customer" ? r.peerPhone : null,
      }, userId),
    }];
  });
}

export interface CabinetSummary {
  /* Живые заявки обеих ролей одной лентой, уже отсортированные и срезанные.
   * Три списка (pending/lending/borrowing) разошлись вместе с тремя разделами
   * экрана: роль теперь подпись в строке, а не место, где строка лежит. */
  rows: FeedRow[];
  /** Сколько живых заявок не поместилось. Точное: резали в памяти, не лимитом. */
  rest: number;
  stats: {
    views7d: number;
    requests30d: number;
    activeListings: number;
    busyDays30d: number;
  };
}

/* Сколько строк показывает панель. Потолок обязателен: при двадцати заявках
 * сводка превратилась бы в ту же ленту, только без фильтров — ровно то, чего
 * ADR 0015 велел не допускать. Остаток назван числом и ведёт в ленту. */
const SUMMARY_ROWS = 8;

export async function getCabinetSummary(userId: string): Promise<CabinetSummary> {
  // Читаем после протухания: заявка с истёкшим сроком не должна висеть
  // в «требует действия».
  await expireStaleRequests();

  const db = getDb();
  const today = todayStr();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const myListings = db
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.ownerUserId, userId));

  const [live, views, requests, active, busy] = await Promise.all([
    /* Тот же запрос, что и у ленты. Второго пути чтения у заявки больше нет:
     * прежний deals() отдавал семь полей, и «Пульту» их не хватало — телефона,
     * снимка вещи, залога и суммы в нём не было вовсе. */
    getCabinetRequests(userId, { statuses: ["new", "confirmed"] }),

    /* Просмотр — один браузер, одна вещь, один московский день: перезагрузки
     * и возвраты в тот же день одним человеком плитку не накручивают. */
    db
      .select({
        cnt: sql<number>`count(distinct (${visitorEvents.visitorId}, ${visitorEvents.listingId},
          (${visitorEvents.createdAt} at time zone 'UTC' at time zone ${APP_TIME_ZONE})::date))::int`,
      })
      .from(visitorEvents)
      .innerJoin(visitors, eq(visitors.id, visitorEvents.visitorId))
      .where(cabinetViewsWhere(userId, weekAgo)),

    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(bookingRequests)
      .where(and(
        eq(bookingRequests.ownerUserId, userId),
        gte(bookingRequests.createdAt, monthAgo),
      )),

    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(eq(listings.ownerUserId, userId), eq(listings.status, "active"))),

    // Занятость на месяц вперёд: сколько дней хотя бы одна вещь в работе.
    db
      .select({ cnt: sql<number>`count(distinct ${availability.date})::int` })
      .from(availability)
      .where(and(
        inArray(availability.listingId, myListings),
        gte(availability.date, today),
        lte(availability.date, addDaysStr(today, 30)),
        gt(availability.bookedQty, 0),
      )),
  ]);

  /* Непрочитанное — счётчиком у иконки переписки. Формула одна на весь
   * проект: список переписок, треды объявления и сводка обязаны считать
   * одинаково, поэтому берём общую функцию, а не пишем четвёртую копию. */
  const threadIds = live.map((r) => r.threadId).filter((id): id is string => id !== null);
  const unread = await getUnreadByThread(threadIds, userId);

  const { shown, rest } = summaryRows(
    live.map((r) => ({
      ...toFeedRow(r),
      unread: r.threadId ? unread.get(r.threadId) ?? 0 : 0,
    })),
    SUMMARY_ROWS,
  );

  return {
    rows: shown,
    rest,
    stats: {
      views7d: views[0]?.cnt ?? 0,
      requests30d: requests[0]?.cnt ?? 0,
      activeListings: active[0]?.cnt ?? 0,
      busyDays30d: busy[0]?.cnt ?? 0,
    },
  };
}

