"use server";

// Server actions админки: модерация пользователей/объявлений, CRUD городов и
// категорий, бан пользователей. Все проверяют роль admin сами (в отличие
// от assertAdmin с redirect — actions возвращают ошибку).

import { z } from "zod";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { bookingRequests, categories, cities, events, geoImports, listings, users } from "@db/schema";
import { auth } from "@/lib/auth";
import { newId } from "@/lib/id";
import { writeDealNote } from "@/server/deal-note";
import { slugify } from "@/lib/slugify";
import { RESERVED_SLUGS } from "@/lib/owner/validation";
import { invalidateSearchIndex } from "@/server/search-index";
import { invalidateCitiesGeo } from "@/server/city";
import { notify } from "@/server/notifications";
import { publish } from "@/server/realtime";
import { requestNotify } from "@/lib/realtime/events";
import type { RequestNotificationKind } from "@/lib/notifications/kinds";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") return null;
  return session.user.id;
}

// ============================== Модерация ==============================

const listingStatusSchema = z.enum(["active", "hidden", "archived"]);

export async function adminSetListingStatus(
  listingId: string,
  status: "active" | "hidden" | "archived",
): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  // Тип аргумента защищает только вызывающих из кода: action доступен по сети
  // напрямую, и оттуда в enum-колонку приедет что угодно.
  const parsed = listingStatusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const next = parsed.data;
  const db = getDb();

  // Поднять объявление забаненного нельзя: каталог, поиск и sitemap отличают
  // публичное от скрытого по одному лишь статусу, и active у забаненного вернул
  // бы вещь в выдачу при том, что её карточка отдаёт 404, а заявку создать
  // нельзя. Условие живёт в самом UPDATE, а не в отдельном SELECT: между чтением
  // и записью владельца могли забанить, и тогда объявление осталось бы active
  // без метки — разбан бы его не нашёл, а из каталога оно бы уже не ушло.
  const ownerAlive = sql`not exists (
    select 1 from ${users}
    where ${users.id} = ${listings.ownerUserId} and ${users.bannedAt} is not null
  )`;

  // Явная смена статуса снимает метку бана: дальше судьба объявления — решение
  // админа, и разбан не должен его отменять.
  const res = await db.update(listings)
    .set({ status: next, hiddenByBan: false, updatedAt: new Date() })
    .where(next === "active" ? and(eq(listings.id, listingId), ownerAlive) : eq(listings.id, listingId))
    .returning({ id: listings.id });

  if (res.length === 0) {
    // Ноль строк значит либо «нет такого объявления», либо «владелец забанен».
    // Админу разница важна: во втором случае есть что сделать.
    const exists = await db.select({ id: listings.id })
      .from(listings).where(eq(listings.id, listingId)).limit(1);
    return exists.length > 0
      ? { ok: false, error: "Владелец забанен — сначала снимите бан" }
      : { ok: false, error: "not_found" };
  }
  invalidateSearchIndex();
  revalidatePath("/admin/listings");
  return { ok: true, data: undefined };
}

export async function adminSetUserVerified(
  userId: string,
  isVerified: boolean,
): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const res = await getDb().update(users)
    .set({ isVerified, verifiedAt: isVerified ? new Date() : null })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (res.length === 0) return { ok: false, error: "not_found" };
  revalidatePath("/admin/users");
  return { ok: true, data: undefined };
}

// ============================== Города ==============================

// Пустое поле формы — «не задано»: Number("") и Number(" ") дают ноль, а точка
// (0, 0) лежит в Гвинейском заливе.
const coordinate = (min: number, max: number, label: string) => z.preprocess(
  (v) => {
    if (v === undefined) return null;
    if (typeof v !== "string") return v;
    const t = v.trim();
    return t === "" ? null : Number(t.replace(",", "."));
  },
  z.number({ invalid_type_error: `${label} — число` }).min(min, `${label}: от ${min} до ${max}`)
    .max(max, `${label}: от ${min} до ${max}`).nullable(),
);

const citySchema = z.object({
  name: z.string().trim().min(2).max(100),
  region: z.string().trim().max(100).optional().default(""),
  // Предложный падеж без предлога: «Казани». Пусто — допустимо: заголовок тогда
  // соберётся без предлога, но неверный падеж не покажет.
  nameLocative: z.string().trim().max(100).optional().default(""),
  // Центр города: от него ранжируются подсказки адресов.
  lat: coordinate(-90, 90, "Широта"),
  lon: coordinate(-180, 180, "Долгота"),
  // Регион геоданных из загруженных (geo_imports). Пусто — у города геоданных
  // нет; это же аварийный выключатель геокодера для города.
  geoRegion: z.string().trim().max(40).optional().default(""),
}).superRefine((v, ctx) => {
  if ((v.lat === null) !== (v.lon === null)) {
    ctx.addIssue({ code: "custom", message: "Центр города — широта и долгота вместе" });
  }
  if (v.geoRegion && v.lat === null) {
    ctx.addIssue({ code: "custom", message: "С геоданными нужен центр города — от него ищутся адреса" });
  }
});

type CityInput = z.infer<typeof citySchema>;

/** Регион геоданных выбирается только из загруженных: иначе город остался бы без адресов молча. */
async function checkGeoRegion(geoRegion: string): Promise<string | null> {
  if (!geoRegion) return null;
  const found = await getDb().select({ id: geoImports.id }).from(geoImports)
    .where(eq(geoImports.region, geoRegion)).limit(1);
  return found.length > 0 ? null : `Геоданных региона «${geoRegion}» нет — сначала pnpm geo:import`;
}

function cityGeoValues(v: CityInput) {
  return { lat: v.lat, lon: v.lon, geoRegion: v.geoRegion || null };
}

export async function adminCreateCity(input: unknown): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const parsed = citySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };

  const db = getDb();
  const slug = slugify(parsed.data.name);
  if (!slug) return { ok: false, error: "bad_name" };
  // Слаг города — первый сегмент адреса: «search» или «admin» перекрыли бы
  // маршрут приложения, и город остался бы без страниц.
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: `Адрес «/${slug}» занят сервисом — назовите город иначе` };
  const dup = await db.select({ id: cities.id }).from(cities).where(eq(cities.slug, slug)).limit(1);
  if (dup.length > 0) return { ok: false, error: "Город с таким слагом уже есть" };
  const geoError = await checkGeoRegion(parsed.data.geoRegion);
  if (geoError) return { ok: false, error: geoError };

  await db.insert(cities).values({
    id: newId(),
    name: parsed.data.name,
    slug,
    region: parsed.data.region || null,
    nameLocative: parsed.data.nameLocative || null,
    ...cityGeoValues(parsed.data),
  });
  // Названия городов — стоп-слова поиска, они снимаются при сборке индекса.
  invalidateSearchIndex();
  invalidateCitiesGeo();
  revalidatePath("/admin/cities");
  return { ok: true, data: undefined };
}

/* Правка заведённого города. Слаг не трогаем: он в адресах всех страниц города
 * и в чужих ссылках — переименование ломало бы их молча. Менять можно то, что
 * видно текстом: название, регион и падеж, — и геоданные: центр и регион. */
export async function adminUpdateCity(cityId: string, input: unknown): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const parsed = citySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const geoError = await checkGeoRegion(parsed.data.geoRegion);
  if (geoError) return { ok: false, error: geoError };

  const res = await getDb().update(cities)
    .set({
      name: parsed.data.name,
      region: parsed.data.region || null,
      nameLocative: parsed.data.nameLocative || null,
      ...cityGeoValues(parsed.data),
    })
    .where(eq(cities.id, cityId))
    .returning({ id: cities.id });
  if (res.length === 0) return { ok: false, error: "not_found" };

  invalidateSearchIndex();
  invalidateCitiesGeo();
  revalidatePath("/admin/cities");
  return { ok: true, data: undefined };
}

export async function adminSetCityActive(cityId: string, isActive: boolean): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const res = await getDb().update(cities)
    .set({ isActive })
    .where(eq(cities.id, cityId))
    .returning({ id: cities.id });
  if (res.length === 0) return { ok: false, error: "not_found" };
  invalidateSearchIndex();
  invalidateCitiesGeo();
  revalidatePath("/admin/cities");
  return { ok: true, data: undefined };
}

// ============================== Категории ==============================

const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  parentId: z.string().optional().default(""),
  vertical: z.string().trim().max(40).optional().default(""),
});

export async function adminCreateCategory(input: unknown): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const form = parsed.data;

  const db = getDb();
  const slug = slugify(form.name);
  if (!slug) return { ok: false, error: "bad_name" };
  const dup = await db.select({ id: categories.id }).from(categories)
    .where(eq(categories.slug, slug)).limit(1);
  if (dup.length > 0) return { ok: false, error: "Категория с таким слагом уже есть" };

  if (form.parentId) {
    // Дерево строго 2 уровня: родителем может быть только корневая.
    const parent = await db.select().from(categories)
      .where(and(eq(categories.id, form.parentId), isNull(categories.parentId)))
      .limit(1);
    if (parent.length === 0) return { ok: false, error: "bad_parent" };
  }

  await db.insert(categories).values({
    id: newId(),
    parentId: form.parentId || null,
    name: form.name,
    slug,
    vertical: form.vertical || null,
  });
  invalidateSearchIndex();
  revalidatePath("/admin/categories");
  return { ok: true, data: undefined };
}

export async function adminDeleteCategory(categoryId: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const db = getDb();

  const [children, used] = await Promise.all([
    db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, categoryId)).limit(1),
    db.select({ id: listings.id }).from(listings).where(eq(listings.categoryId, categoryId)).limit(1),
  ]);
  if (children.length > 0) return { ok: false, error: "Сначала удалите подкатегории" };
  if (used.length > 0) return { ok: false, error: "В категории есть позиции — удалить нельзя" };

  await db.delete(categories).where(eq(categories.id, categoryId));
  invalidateSearchIndex();
  revalidatePath("/admin/categories");
  return { ok: true, data: undefined };
}

// ============================== Пользователи ==============================

const banReasonSchema = z.string().trim().min(5, "Причина от 5 символов").max(500);

// Бан уводит из публичного контура и человека, и его вещи. Одной транзакцией:
// частичный бан оставил бы объявления в каталоге, а заявки — висеть на том, кто
// уже не может ни ответить на них, ни довести до конца свои.
//
// Порядок внутри транзакции не произволен. booking_requests берутся раньше
// listings, потому что встречный порядок даёт ABBA с transitionRequest: тот
// лочит заявку, а потом объявление (actions/owner.ts, ветка confirmed).
// Уведомления идут после обеих таблиц — этот порядок описан в server/
// notifications.ts. События заявок копятся в toPublish и уходят в конце; своё
// событие writeDealNote публикует сам, сразу за своей записью.
// Сколько записей о сделке бан дописывает в переписки. Закрывает он все
// заявки, а рассказывает о первых — см. цикл ниже.
const BAN_JOURNAL_LIMIT = 50;

export async function adminBanUser(userId: string, reason: unknown): Promise<ActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, error: "forbidden" };
  if (userId === adminId) return { ok: false, error: "Нельзя забанить себя" };
  const parsedReason = banReasonSchema.safeParse(reason);
  if (!parsedReason.success) {
    return { ok: false, error: parsedReason.error.issues[0]?.message ?? "invalid_input" };
  }

  try {
    await getDb().transaction(async (tx) => {
      const res = await tx.update(users)
        .set({ bannedAt: new Date(), banReason: parsedReason.data })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      // Раньше всего остального: несуществующий пользователь не должен оставить
      // за собой ни строки.
      if (res.length === 0) throw new Error("not_found");

      const now = new Date();
      // Только ещё живые заявки. Та, у которой срок вышел, но ленивое протухание
      // до неё не дошло, — уже мертва: пометить её отклонённой и уведомить об
      // этом значило бы сообщить о событии, которого не было (протухание молчит).
      const stillPending = and(eq(bookingRequests.status, "new"), gte(bookingRequests.expiresAt, now));

      // Входящие: подтвердить их забаненный не может (requireUser в
      // actions/owner.ts отсекает banned), а ссылка на скрытое объявление у
      // арендатора теперь отдаёт 404. Оставить их протухать значило бы сутки
      // держать человека в ожидании ответа, которого не будет.
      const incoming = await tx.update(bookingRequests)
        .set({ status: "declined", respondedAt: now })
        .where(and(eq(bookingRequests.ownerUserId, userId), stillPending))
        .returning({
          id: bookingRequests.id,
          counterpartId: bookingRequests.customerUserId,
          listingId: bookingRequests.listingId,
          dateFrom: bookingRequests.dateFrom,
          dateTo: bookingRequests.dateTo,
          qty: bookingRequests.qty,
        });

      // Исходящие: забаненный не доведёт аренду до конца, а чужой владелец,
      // ничего не зная, подтвердил бы её и занял даты под аккаунт, которого на
      // сайт уже не пускают.
      const outgoing = await tx.update(bookingRequests)
        .set({ status: "cancelled", respondedAt: now })
        .where(and(eq(bookingRequests.customerUserId, userId), stillPending))
        .returning({
          id: bookingRequests.id,
          counterpartId: bookingRequests.ownerUserId,
          listingId: bookingRequests.listingId,
          dateFrom: bookingRequests.dateFrom,
          dateTo: bookingRequests.dateTo,
          qty: bookingRequests.qty,
        });

      // Подтверждённые заявки бан не трогает по обе стороны: это сделка в
      // реальном мире, вещь может быть уже у арендатора, и даты она держит по
      // праву. Ни одна new-заявка дат не держит, поэтому availability здесь ни
      // при чём (см. lib/catalog/booking-status).

      // Метка отличает погашенное баном от скрытого владельцем — по одному лишь
      // статусу эти случаи неразличимы, и разбан поднял бы лишнее.
      await tx.update(listings)
        .set({ status: "hidden", hiddenByBan: true, updatedAt: now })
        .where(and(eq(listings.ownerUserId, userId), eq(listings.status, "active")));

      // Сторона получателя называется здесь, рядом с counterpartId, а не
      // выводится из вида события ниже: вид сторону не задаёт. Входящую заявку
      // забаненного владельца отклоняют — узнаёт её автор, арендатор; исходящую
      // заявку забаненного арендатора отменяют — узнаёт владелец вещи.
      const touched = [
        ...incoming.map((r) => ({
          ...r, kind: "request_declined" as const, side: "customer" as const,
          event: "request_declined",
          // Забанен владелец: он и есть хозяин вещи, вторая сторона — клиент.
          ownerUserId: userId, customerUserId: r.counterpartId,
        })),
        ...outgoing.map((r) => ({
          ...r, kind: "request_cancelled" as const, side: "owner" as const,
          event: "cancel_request",
          // Забанен арендатор: хозяин вещи — вторая сторона.
          ownerUserId: r.counterpartId, customerUserId: userId,
        })),
      ];

      const toPublish: Array<{ kind: RequestNotificationKind; requestId: string; recipientId: string }> = [];
      let notesLeft = BAN_JOURNAL_LIMIT;
      for (const req of touched) {
        await tx.insert(events).values({
          id: newId(),
          entityType: "booking_request",
          entityId: req.id,
          event: req.event,
          userId: adminId,
          metaJson: { fromStatus: "new", reason: "user_banned" },
        });
        /* Журнал сделки дописываем, но с потолком. Закрыть заявки обязаны все —
         * это правильность; запись в тред — рассказ о случившемся, и на бане
         * тяжёлого аккаунта их могут быть сотни, каждая с find-or-create треда
         * и вставкой внутри одной транзакции. Что обрезано — видно по числу,
         * молча этого не происходит. */
        if (notesLeft > 0) {
          notesLeft -= 1;
          await writeDealNote(tx, {
            listingId: req.listingId,
            ownerUserId: req.ownerUserId,
            customerUserId: req.customerUserId,
            kind: req.kind,
            meta: { requestId: req.id, from: req.dateFrom, to: req.dateTo, qty: req.qty },
          });
        }
        const notified = await notify(tx, {
          recipientId: req.counterpartId,
          actorId: adminId,
          kind: req.kind,
          side: req.side,
          entityId: req.id,
        });
        if (notified) {
          toPublish.push({ kind: req.kind, requestId: req.id, recipientId: req.counterpartId });
        }
      }

      for (const p of toPublish) await publish(tx, requestNotify(p));
    });
  } catch (e) {
    if (e instanceof Error && e.message === "not_found") return { ok: false, error: "not_found" };
    throw e;
  }

  // Вещи забаненного уходят из подсказок и /search сразу.
  invalidateSearchIndex();
  // Бан закрывает живые заявки по обе стороны, а лента у них теперь общая.
  revalidatePath("/admin/users");
  revalidatePath("/cabinet/requests");
  revalidatePath("/cabinet");
  return { ok: true, data: undefined };
}

export async function adminUnbanUser(userId: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };

  try {
    await getDb().transaction(async (tx) => {
      const res = await tx.update(users)
        .set({ bannedAt: null, banReason: null })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (res.length === 0) throw new Error("not_found");

      // Условие по метке, а не по статусу: объявления, которые владелец скрыл
      // сам до бана, должны остаться скрытыми. Отклонённые заявки не
      // воскрешаются — declined терминален.
      await tx.update(listings)
        .set({ status: "active", hiddenByBan: false, updatedAt: new Date() })
        .where(and(eq(listings.ownerUserId, userId), eq(listings.hiddenByBan, true)));
    });
  } catch (e) {
    if (e instanceof Error && e.message === "not_found") return { ok: false, error: "not_found" };
    throw e;
  }

  invalidateSearchIndex();
  revalidatePath("/admin/users");
  return { ok: true, data: undefined };
}
