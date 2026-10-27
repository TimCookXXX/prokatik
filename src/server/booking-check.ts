// Проверка выбора на странице вещи: объявление, даты, количество, увиденные
// цены, минимальный срок и занятость. Одна на три входа — заявку из кабинета
// (createBookingRequest), черновик для бота (/api/leads/draft) с его отправкой
// и запасную форму (submitLeadForm), — чтобы правила брони у них не разошлись.
//
// Коды ошибок — те же, что createBookingRequest отдавал всегда: их разбирают
// диалог заявки и тексты бота (lib/leads/card.ts, leadReasonText).
//
// Сессия, бан смотрящего, лимиты и honeypot — забота вызывающего: у каждого
// входа они свои. Здесь только `own_listing`, потому что его место в порядке
// проверок — между «нет объявления» и «объявление скрыто».

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { availability, listings, users } from "@db/schema";
import { isSelectionShifted, parseBookingParams, rentalDaysCount, type BookingSelection } from "@/lib/booking/params";
import type { BookingSelectionData } from "@/lib/booking/validation";
import { unavailableDates, type AvailabilityMap } from "@/lib/catalog/availability";
import { isPubliclyVisible } from "@/lib/catalog/visibility";
import { listingPath } from "@/lib/catalog/listing-path";
import { quote } from "@/lib/catalog/tariff";
import { todayStr } from "@/lib/catalog/dates";

type Listing = typeof listings.$inferSelect;

/** Кто выбирает: null — без аккаунта (бот, форма гостя). */
export type SelectionViewer = { userId: string } | null;

/**
 * Снимок объявления для заявки без аккаунта: из него собирается карточка в
 * группе, и ему не нужен join — ссылка и имя проката переживут удаление вещи.
 */
export interface ListingSnapshot {
  listingId: string;
  ownerUserId: string;
  title: string;
  /** listingPath() без хоста. */
  path: string;
  ownerName: string | null;
  ownerPhone: string | null;
  priceDay: number | null;
  priceWeek: number | null;
  priceMonth: number | null;
  depositType: Listing["depositType"];
  depositAmount: number | null;
}

export type SelectionCheck =
  | {
    ok: true;
    listing: Listing;
    snapshot: ListingSnapshot;
    /** Выбор после клампа — совпадает с присланным, иначе была бы ошибка. */
    sel: BookingSelection;
    /** Сумма за срок и количество (quote); null — посчитать нечем. */
    total: number | null;
  }
  | {
    ok: false;
    error: string;
    /** null — объявления нет вовсе. */
    snapshot: ListingSnapshot | null;
  };

/**
 * Проверка выбора. Порядок отказов тот же, что был в createBookingRequest:
 * нет объявления → своё → скрыто → даты сдвинулись → количество → цена →
 * минимальный срок → занятость.
 */
export async function checkBookingSelection(
  form: BookingSelectionData,
  viewer: SelectionViewer,
): Promise<SelectionCheck> {
  const db = getDb();
  // Владелец читается вместе с объявлением: публичность решает isPubliclyVisible,
  // а не один только статус. Бан гасит объявления на записи, но статус может
  // разойтись с баном, если объявление подняли вручную.
  // Слаги города и раздела — подзапросами, а не join'ами: один запрос на всё,
  // а путь в снимке собирается тем же listingPath, что и ссылки на сайте.
  const listingRows = await db.select({
    listing: listings,
    ownerBannedAt: users.bannedAt,
    ownerName: users.name,
    ownerPhone: users.phone,
    citySlug: sql<string>`(select c.slug from cities c where c.id = listings.city_id)`,
    categorySlug: sql<string>`(select k.slug from categories k where k.id = listings.category_id)`,
  })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.ownerUserId))
    .where(eq(listings.id, form.listingId))
    .limit(1);
  const row = listingRows[0];
  if (!row) return { ok: false, error: "listing_not_found", snapshot: null };
  const listing = row.listing;
  const snapshot: ListingSnapshot = {
    listingId: listing.id,
    ownerUserId: listing.ownerUserId,
    title: listing.title,
    path: listingPath(row.citySlug, row.categorySlug, listing.slug, listing.id),
    ownerName: row.ownerName ?? null,
    ownerPhone: row.ownerPhone ?? null,
    priceDay: listing.priceDay,
    priceWeek: listing.priceWeek,
    priceMonth: listing.priceMonth,
    depositType: listing.depositType,
    depositAmount: listing.depositAmount,
  };
  const fail = (error: string): SelectionCheck => ({ ok: false, error, snapshot });

  // Заявка на свою же вещь закрыта так же, как переписка с самим собой: иначе
  // владелец подтверждает её сам и занимает собственные даты в обход календаря
  // занятости, а уведомлений за весь её цикл не приходит никому.
  // Сравнение стоит раньше публичности — тот же порядок, что в canStartThread:
  // владельцу скрытого объявления ответ «позиция недоступна» говорил бы не о
  // том, а раскрыть эта ветка ничего не может, она отвечает только владельцу.
  if (viewer && listing.ownerUserId === viewer.userId) return fail("own_listing");
  // Ответ совпадает с несуществующим объявлением: по нему нельзя узнать, что
  // владелец забанен, — тот же принцип, что в lib/chat/rules.ts. Снимка у
  // такого ответа нет: ссылка вела бы на закрытую страницу.
  if (!isPubliclyVisible({ status: listing.status, ownerBannedAt: row.ownerBannedAt })) {
    return { ok: false, error: "listing_not_found", snapshot: null };
  }

  // Кламп дат к [today, horizon] — форма могла пролежать открытой. Если он
  // что-то сдвинул, заявку не создаём: диалог показывает только «готово», и
  // человек, открывший карточку до полуночи, молча отправил бы владельцу
  // другие даты, чем выбрал.
  const sel = parseBookingParams(
    { from: form.from, to: form.to, qty: String(form.qty) },
    { today: todayStr(), maxQty: listing.quantity },
  );
  if (isSelectionShifted(form, sel)) return fail("dates_stale");
  // Количество клампится к quantity так же молча, как когда-то даты: владелец
  // мог уменьшить его, пока форма открыта, и заявка ушла бы на меньшее число
  // единиц, чем человек видел в диалоге. Отдельный код, а не dates_stale:
  // причина другая, и текст человеку нужен другой.
  if (sel.qty !== form.qty) return fail("qty_stale");
  // И цена: заявка навсегда запоминает условия, на которых её подали, поэтому
  // подать её на условиях, которых человек не видел, нельзя. Без этой проверки
  // поднятая за секунду до отправки цена замерзала бы в заявке как «то, на что
  // вы согласились» — ровно тот обман, от которого снимок и заводился.
  // Сверяются все три тарифа: сумма за срок зависит от каждого (quote).
  const priceShifted = ([
    [form.priceDay, listing.priceDay],
    [form.priceWeek, listing.priceWeek],
    [form.priceMonth, listing.priceMonth],
  ] as const).some(([seen, now]) => seen !== undefined && seen !== now);
  if (priceShifted) return fail("price_stale");

  // Минимальный срок — после клампа: проверяются ровно те даты, что уйдут в
  // заявку. Свой код с числом, чтобы диалог назвал минимум словами.
  const days = rentalDaysCount(sel);
  if (days < listing.minDays) return fail(`min_days:${listing.minDays}`);

  const availRows = await db.select().from(availability).where(and(
    eq(availability.listingId, listing.id),
    gte(availability.date, sel.from),
    lte(availability.date, sel.to),
  ));
  const map: AvailabilityMap = new Map(
    availRows.map((r) => [r.date, { bookedQty: r.bookedQty, blockedQty: r.blockedQty }]),
  );
  const busy = unavailableDates(listing.quantity, map, sel.from, sel.to, sel.qty);
  if (busy.length > 0) return fail(`dates_taken:${busy.join(",")}`);

  const q = quote(listing, days, sel.qty);
  return { ok: true, listing, snapshot, sel, total: q.ok ? q.total : null };
}
