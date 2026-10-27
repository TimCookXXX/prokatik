// Read-слой раздела «Аналитика» в админке: сводка и таблица по дням, список
// гостей, карточка гостя, «Поиски». Каждое чтение само проверяет роль
// (assertAdmin): проверка в layout'е не гарантия (см. src/server/admin.ts).
// И каждое сначала зовёт чистку по сроку хранения — крона нет, и срок из
// политики должен соблюдаться и в дни без маяков.
//
// Человек в сводке — coalesce(user_id, id браузера): устройства одного
// аккаунта — один человек. Дни — московские (APP_TIME_ZONE): колонки timestamp
// хранят UTC, поэтому граница периода — московская полночь, переведённая в
// UTC внутри запроса, а день события — `created_at at time zone 'UTC' at time
// zone 'Europe/Moscow'`.
//
// Заявки и регистрации — из доменных таблиц, а не из событий: их видно и у
// тех, кого статистика посещений не учла (блокировщик, отказ от учёта).
// Свои заходы — браузеры с пометкой is_internal; у заявок и регистраций их
// аналог — аккаунты с ролью admin.

import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { assertAdmin } from "@/lib/auth/assert-admin";
import {
  accounts, bookingRequests, categories, chatThreads, cities, listings, users, visitorEvents, visitors,
} from "@db/schema";
import { APP_TIME_ZONE, addDaysStr, todayStr } from "@/lib/catalog/dates";
import { extractListingId } from "@/lib/catalog/listing-path";
import { visitorEventsCap } from "@/lib/analytics/daily-cap";
import { cursorParam, type AnalyticsFilters, type VisitorListFilters } from "@/lib/analytics/admin-filters";
import { isVisitorId } from "@/lib/analytics/visitor-cookie";
import { VISIT_GAP_MS, isSignupLogin, type AccountAction, type TimelineEvent } from "@/lib/analytics/visits";
import type { Directory } from "@/lib/analytics/describe";
import type { Source } from "@/lib/analytics/source";
import { pruneVisitorData } from "@/server/visitor-analytics";

/** Гостей на странице списка. */
export const VISITORS_PAGE_SIZE = 30;
/** Событий на карточке гостя: последние. */
export const CARD_EVENTS_MAX = 1000;
/** Шагов сделки каждого вида на карточке. */
const CARD_ACTIONS_MAX = 200;
/** Строк в каждой таблице «Поисков». */
const SEARCH_ROWS_MAX = 50;

async function adminRead(): Promise<void> {
  await assertAdmin();
  await pruneVisitorData();
}

/** Первый день периода по Москве: сегодня и period − 1 дней до него. */
export function periodStartDay(period: number, now: Date = new Date()): string {
  return addDaysStr(todayStr(now), -(period - 1));
}

/** Московская полночь дня — моментом UTC, как его хранит колонка timestamp. */
const moscowMidnightUtc = (day: string) =>
  sql`((${day}::date)::timestamp at time zone ${APP_TIME_ZONE}) at time zone 'UTC'`;

/** Московский день колонки timestamp (UTC). */
const moscowDate = (column: SQL) => sql`(${column} at time zone 'UTC' at time zone ${APP_TIME_ZONE})::date`;

/** Без ботов и своих заходов; `v` — псевдоним visitors в запросе. */
const humansOnly = (all: boolean) => (all ? sql`` : sql`and not v.is_bot and not v.is_internal`);
/** Без аккаунтов админов — аналог своих заходов для доменных таблиц; `u` — users. */
const customersOnly = (all: boolean) => (all ? sql`` : sql`and u.role <> 'admin'`);
/** Без тестовых заявок без аккаунта; `bl` — booking_leads. */
const leadsOnly = (all: boolean) => (all ? sql`` : sql`and not bl.internal`);

/** «Ничего не нашёл» — пустая выдача с причиной, кроме страницы за концом списка. */
const zeroResult = (alias: string) =>
  sql.raw(`${alias}.props->>'reason' is not null and ${alias}.props->>'reason' <> 'past_end'`);
const ZERO_RESULT = zeroResult("e");
const ZERO_RESULT_EV = zeroResult("ev");

export interface DayFigures {
  people: number;
  /** Впервые пришли в это окно; не строка, начатая входом или выходом. */
  new: number;
  /** Остальные: приходили и раньше. new + returned = people. */
  returned: number;
  searched: number;
  zero: number;
  viewed: number;
  clicked: number;
  requested: number;
  signups: number;
}

export interface DayRow extends DayFigures {
  /** "YYYY-MM-DD" по Москве. */
  day: string;
}

export interface VisitorSummary {
  since: string;
  today: string;
  totals: DayFigures;
  /** Все дни периода, от сегодняшнего вниз; пустой день — нулями. */
  days: DayRow[];
  /** Суточный потолок событий отказывал сегодня (в памяти этого процесса). */
  capReached: boolean;
}

const ZERO_FIGURES: DayFigures = {
  people: 0, new: 0, returned: 0, searched: 0, zero: 0, viewed: 0, clicked: 0, requested: 0, signups: 0,
};

type Grouped<T> = T & { day: string | null };

/**
 * Сводка и таблица по дням. «Новый» — впервые пришёл в это окно (в этот день
 * для строки таблицы, в этот период для итога), «приходил и раньше» —
 * остальные: новые и вернувшиеся вместе дают людей. Строка браузера,
 * заведённая входом, выходом или сменой аккаунта (first_source вида account),
 * новым человеком не считается — это продолжение того, кто уже был.
 *
 * Первый заход человека: у гостя — его строка (по PK), у аккаунта — самая
 * ранняя его строка (по visitors_user_idx) и дата регистрации, что раньше:
 * аккаунт старше своей статистики новым не бывает.
 */
export async function adminVisitorSummary(f: AnalyticsFilters, now: Date = new Date()): Promise<VisitorSummary> {
  await adminRead();
  const db = getDb();
  const since = periodStartDay(f.period, now);
  const bound = moscowMidnightUtc(since);

  const figures = (newWhen: SQL) => sql`
    count(distinct ev.person)::int as people,
    count(distinct ev.person) filter (where ${newWhen} and not f.continued)::int as new,
    count(distinct ev.person) filter (where ev.type = 'search' and ev.q is not null)::int as searched,
    count(distinct ev.person) filter (where ev.type = 'search' and ev.q is not null and ${ZERO_RESULT_EV})::int as zero,
    count(distinct ev.person) filter (where ev.type = 'view_listing')::int as viewed,
    count(distinct ev.person) filter (where ev.type = 'booking_click')::int as clicked`;

  const [activity, requests, signups] = await Promise.all([
    // Строка с day = null — итог периода: люди за период считаются без
    // повторов, а не суммой дней. Служебные события (ClientID, отметка входа)
    // — не заход.
    db.execute<Grouped<Omit<DayFigures, "returned" | "requested" | "signups">>>(sql`
      with ev as (
        select coalesce(v.user_id, v.id::text) as person,
          case when v.user_id is null then v.id end as guest_id,
          v.user_id,
          ${moscowDate(sql`e.created_at`)} as day,
          e.type, e.q, e.props
        from visitor_events e
        join visitors v on v.id = e.visitor_id
        where e.created_at >= ${bound} and e.type not in ('ym_client', 'login') ${humansOnly(f.all)}
      ),
      people as (select distinct person, guest_id, user_id from ev),
      firsts as (
        select p.person, ${moscowDate(sql`v.first_seen_at`)} as first_day,
          coalesce(v.first_source->>'kind' = 'account', false) as continued
        from people p join visitors v on v.id = p.guest_id
        union all
        select p.person, ${moscowDate(sql`least(u.created_at, a.first_seen_at)`)} as first_day, a.continued
        from people p
        join users u on u.id = p.user_id
        cross join lateral (
          select v.first_seen_at, coalesce(v.first_source->>'kind' = 'account', false) as continued
          from visitors v where v.user_id = p.user_id
          order by v.first_seen_at, v.id
          limit 1
        ) a
      )
      select ev.day::text as day, ${figures(sql`f.first_day = ev.day`)}
      from ev join firsts f on f.person = ev.person
      group by ev.day
      union all
      select null as day, ${figures(sql`f.first_day >= ${since}::date`)}
      from ev join firsts f on f.person = ev.person
    `),
    // Заявки из кабинета — по людям; заявки без аккаунта (бот и форма, ADR
    // 0028) — по Telegram-аккаунту или телефону, а без них каждая сама по
    // себе. Черновики не заявка; тестовые (internal) — как свои заходы.
    db.execute<Grouped<{ requested: number }>>(sql`
      select d.day::text as day, count(distinct d.customer)::int as requested
      from (
        select ${moscowDate(sql`br.created_at`)} as day, br.customer_user_id as customer
        from booking_requests br
        join users u on u.id = br.customer_user_id
        where br.created_at >= ${bound} ${customersOnly(f.all)}
        union all
        select ${moscowDate(sql`bl.sent_at`)} as day,
          'lead:' || coalesce(bl.tg_user_id::text, bl.customer_phone, bl.id) as customer
        from booking_leads bl
        where bl.status <> 'draft' and bl.sent_at >= ${bound} ${leadsOnly(f.all)}
      ) d
      group by grouping sets ((d.day), ())
    `),
    db.execute<Grouped<{ signups: number }>>(sql`
      select d.day::text as day, count(*)::int as signups
      from (
        select ${moscowDate(sql`u.created_at`)} as day
        from users u
        where u.created_at >= ${bound} ${customersOnly(f.all)}
      ) d
      group by grouping sets ((d.day), ())
    `),
  ]);

  const byDay = new Map<string | null, DayFigures>();
  const merge = (day: string | null, part: Partial<DayFigures>) => {
    byDay.set(day, { ...(byDay.get(day) ?? ZERO_FIGURES), ...part });
  };
  for (const { day, ...rest } of activity.rows) merge(day, { ...rest, returned: rest.people - rest.new });
  for (const { day, requested } of requests.rows) merge(day, { requested });
  for (const { day, signups: n } of signups.rows) merge(day, { signups: n });

  const today = todayStr(now);
  const days: DayRow[] = [];
  for (let day = today; day >= since; day = addDaysStr(day, -1)) {
    days.push({ day, ...(byDay.get(day) ?? ZERO_FIGURES) });
  }
  return {
    since,
    today,
    totals: byDay.get(null) ?? ZERO_FIGURES,
    days,
    capReached: visitorEventsCap.reachedToday(now),
  };
}

/**
 * Первый заход человека этой строки: у аккаунта — его регистрация или самая
 * ранняя строка, что раньше (новая строка — на каждый вход, и иначе давний
 * аккаунт после входа выглядел бы новичком); у гостя — своя строка. Таблица —
 * псевдоним `visitors` основного запроса.
 */
const personFirstSeen = sql<Date>`case when visitors.user_id is null then visitors.first_seen_at
  else least(users.created_at, (select min(v2.first_seen_at) from visitors v2 where v2.user_id = visitors.user_id)) end`;
/** Строка заведена входом, выходом или сменой аккаунта — продолжение, а не новый гость. */
const startedBySwitch = sql<boolean>`coalesce(visitors.first_source->>'kind' = 'account', false)`;
/** Дни с заходами, по Москве: служебные события (ClientID, отметка входа) — не заход. */
const activeDays = sql<number>`(select count(distinct ${moscowDate(sql`e.created_at`)})::int from visitor_events e
  where e.visitor_id = visitors.id and e.type not in ('ym_client', 'login'))`;

export interface VisitorListRow {
  id: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Первый заход человека (personFirstSeen) — для бейджа «новый» / «вернулся». */
  personFirstSeenAt: Date;
  /** Строка начата входом, выходом или сменой аккаунта. */
  continued: boolean;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  firstSource: Source | null;
  device: string | null;
  isBot: boolean;
  isInternal: boolean;
  /** Разных запросов за день: листание и смена сортировки того же запроса — не новый поиск. */
  searches: number;
  /** Разных объявлений за день: перезагрузка той же страницы — не новый просмотр. */
  views: number;
  /** В скольких разных днях по Москве есть заходы (в пределах срока хранения). */
  days: number;
}

export interface VisitorList {
  rows: VisitorListRow[];
  /** Курсор страницы новее этой; null — эта самая новая. */
  newer: string | null;
  /** Курсор страницы старше; null — дальше никого. */
  older: string | null;
  /** Чьи устройства показаны (фильтр user). */
  user: { id: string; name: string | null; email: string } | null;
}

export async function adminListVisitors(f: VisitorListFilters): Promise<VisitorList> {
  await adminRead();
  const db = getDb();

  const conditions: (SQL | undefined)[] = [];
  // Точный поиск и «Устройства» человека показывают строку при любых пометках:
  // её ищут по конкретному id.
  if (!f.all && f.find === null && f.user === null) {
    conditions.push(eq(visitors.isBot, false), eq(visitors.isInternal, false));
  }
  if (f.user) conditions.push(eq(visitors.userId, f.user));
  if (f.find?.kind === "vid") conditions.push(eq(visitors.id, f.find.value));
  if (f.find?.kind === "cid") {
    // Нынешний ClientID гостя или любой из прежних — по истории событий ym_client.
    const cid = f.find.value;
    conditions.push(or(
      eq(visitors.ymClientId, cid),
      inArray(visitors.id, db.select({ id: visitorEvents.visitorId }).from(visitorEvents)
        .where(and(eq(visitorEvents.type, "ym_client"), sql`${visitorEvents.props}->>'cid' = ${cid}`))),
    ));
  }
  const back = f.cursor?.dir === "before";
  if (f.cursor) {
    conditions.push(sql`(visitors.last_seen_at, visitors.id) ${sql.raw(back ? ">" : "<")}
      (${f.cursor.at}::timestamp, ${f.cursor.id}::uuid)`);
  }

  // Таблица в подзапросах — явными именами: в полях select drizzle пишет
  // колонки без таблицы, и "id" внутри подзапроса оказался бы id события.
  const rows = await db
    .select({
      id: visitors.id,
      firstSeenAt: visitors.firstSeenAt,
      lastSeenAt: visitors.lastSeenAt,
      userId: visitors.userId,
      userName: users.name,
      userEmail: users.email,
      firstSource: visitors.firstSource,
      device: visitors.device,
      isBot: visitors.isBot,
      isInternal: visitors.isInternal,
      cursor: sql<string>`to_char(visitors.last_seen_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
      personFirstSeenAt: personFirstSeen.mapWith(visitors.firstSeenAt),
      continued: startedBySwitch,
      searches: sql<number>`(select count(distinct (lower(e.q), ${moscowDate(sql`e.created_at`)}))::int
        from visitor_events e where e.visitor_id = visitors.id and e.type = 'search' and e.q is not null)`,
      views: sql<number>`(select count(distinct (e.listing_id, ${moscowDate(sql`e.created_at`)}))::int
        from visitor_events e where e.visitor_id = visitors.id and e.type = 'view_listing' and e.listing_id is not null)`,
      days: activeDays,
    })
    .from(visitors)
    .leftJoin(users, eq(users.id, visitors.userId))
    .where(and(...conditions))
    .orderBy(...(back ? [asc(visitors.lastSeenAt), asc(visitors.id)] : [desc(visitors.lastSeenAt), desc(visitors.id)]))
    .limit(VISITORS_PAGE_SIZE + 1);

  const more = rows.length > VISITORS_PAGE_SIZE;
  const page = rows.slice(0, VISITORS_PAGE_SIZE);
  if (back) page.reverse();
  const edge = (r: (typeof rows)[number] | undefined) => (r ? cursorParam(r.cursor, r.id) : null);
  const newer = back ? (more ? edge(page[0]) : null) : f.cursor ? edge(page[0]) : null;
  const older = back ? edge(page.at(-1)) : more ? edge(page.at(-1)) : null;

  let user: VisitorList["user"] = null;
  if (f.user) {
    const [found] = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(users).where(eq(users.id, f.user)).limit(1);
    user = found ?? null;
  }

  return {
    rows: page.map(({ cursor: _cursor, firstSource, ...r }) => ({
      ...r,
      firstSource: (firstSource as Source | null) ?? null,
    })),
    newer,
    older,
    user,
  };
}

export interface VisitorCard {
  visitor: {
    id: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
    /** Первый заход человека — для бейджа, как в списке. */
    personFirstSeenAt: Date;
    continued: boolean;
    /** Дни с заходами — тем же запросом, что в списке. */
    days: number;
    firstSource: Source | null;
    device: string | null;
    ymClientId: string | null;
    isBot: boolean;
    isInternal: boolean;
  };
  user: {
    id: string;
    name: string | null;
    email: string;
    createdAt: Date;
    providers: string[];
    hasPassword: boolean;
    /** Сколько ещё браузеров записано за этим аккаунтом. */
    otherDevices: number;
  } | null;
  /** По времени, старые первыми; не больше CARD_EVENTS_MAX последних. */
  events: TimelineEvent[];
  truncated: boolean;
  /** Шаги сделки аккаунта, пока этот браузер был активен. */
  actions: AccountAction[];
  /** id события login, которое было регистрацией аккаунта. */
  signupLoginId: string | null;
  directory: Directory;
}

/** Объявления, на которые ведут пути событий: /{город}/{раздел}/{слаг}-{ULID}. */
function listingIdsInPaths(paths: (string | null)[]): string[] {
  const ids = new Set<string>();
  for (const path of paths) {
    const segments = (path ?? "").split("?", 1)[0].split("/").filter(Boolean);
    if (segments.length !== 3) continue;
    const parsed = extractListingId(segments[2]);
    if (parsed) ids.add(parsed.id.toUpperCase());
  }
  return [...ids];
}

/**
 * Что знаем об аккаунте браузера: способы входа, первый вход (регистрация ли
 * он), шаги сделки, пока браузер был активен, — от первого захода до паузы
 * после последнего, — и сколько у аккаунта других браузеров.
 */
async function accountExtras(userId: string, visitorId: string, from: Date, to: Date) {
  const db = getDb();
  const inWindow = (column: AnyPgColumn) => and(gte(column, from), lte(column, to));
  const [providers, firstLogin, requests, chats, placed, others] = await Promise.all([
    db.select({ provider: accounts.provider }).from(accounts).where(eq(accounts.userId, userId)),
    db.select({ id: visitorEvents.id, at: visitorEvents.createdAt }).from(visitorEvents)
      .where(and(eq(visitorEvents.userId, userId), eq(visitorEvents.type, "login")))
      .orderBy(asc(visitorEvents.createdAt), asc(visitorEvents.id))
      .limit(1),
    db.select({
      id: bookingRequests.id, at: bookingRequests.createdAt, listingTitle: listings.title,
      dateFrom: bookingRequests.dateFrom, dateTo: bookingRequests.dateTo,
    })
      .from(bookingRequests)
      .leftJoin(listings, eq(listings.id, bookingRequests.listingId))
      .where(and(eq(bookingRequests.customerUserId, userId), inWindow(bookingRequests.createdAt)))
      .orderBy(asc(bookingRequests.createdAt))
      .limit(CARD_ACTIONS_MAX),
    db.select({ id: chatThreads.id, at: chatThreads.createdAt, listingTitle: listings.title })
      .from(chatThreads)
      .leftJoin(listings, eq(listings.id, chatThreads.listingId))
      .where(and(eq(chatThreads.customerUserId, userId), inWindow(chatThreads.createdAt)))
      .orderBy(asc(chatThreads.createdAt))
      .limit(CARD_ACTIONS_MAX),
    db.select({ id: listings.id, at: listings.createdAt, listingTitle: listings.title })
      .from(listings)
      .where(and(eq(listings.ownerUserId, userId), inWindow(listings.createdAt)))
      .orderBy(asc(listings.createdAt))
      .limit(CARD_ACTIONS_MAX),
    db.select({ n: sql<number>`count(*)::int` }).from(visitors)
      .where(and(eq(visitors.userId, userId), ne(visitors.id, visitorId))),
  ]);
  const actions: AccountAction[] = [
    ...requests.map((r) => ({ kind: "request" as const, ...r })),
    ...chats.map((r) => ({ kind: "chat" as const, ...r })),
    ...placed.map((r) => ({ kind: "listing" as const, ...r })),
  ];
  return {
    providers: providers.map((p) => p.provider),
    firstLogin: firstLogin[0] ?? null,
    actions,
    otherDevices: others[0]?.n ?? 0,
  };
}

export async function adminVisitorCard(id: string): Promise<VisitorCard | null> {
  await adminRead();
  if (!isVisitorId(id)) return null;
  const visitorId = id.toLowerCase();
  const db = getDb();

  const [row] = await db
    .select({
      id: visitors.id,
      firstSeenAt: visitors.firstSeenAt,
      lastSeenAt: visitors.lastSeenAt,
      firstSource: visitors.firstSource,
      device: visitors.device,
      ymClientId: visitors.ymClientId,
      isBot: visitors.isBot,
      isInternal: visitors.isInternal,
      personFirstSeenAt: personFirstSeen.mapWith(visitors.firstSeenAt),
      continued: startedBySwitch,
      days: activeDays,
      userId: visitors.userId,
      userName: users.name,
      userEmail: users.email,
      userCreatedAt: users.createdAt,
      hasPassword: sql<boolean>`users.password_hash is not null`,
    })
    .from(visitors)
    .leftJoin(users, eq(users.id, visitors.userId))
    .where(eq(visitors.id, visitorId))
    .limit(1);
  if (!row) return null;

  const eventRows = await db
    .select({
      id: visitorEvents.id,
      type: visitorEvents.type,
      at: visitorEvents.createdAt,
      path: visitorEvents.path,
      listingId: visitorEvents.listingId,
      q: visitorEvents.q,
      total: visitorEvents.total,
      props: visitorEvents.props,
      userId: visitorEvents.userId,
    })
    .from(visitorEvents)
    .where(eq(visitorEvents.visitorId, visitorId))
    .orderBy(desc(visitorEvents.createdAt), desc(visitorEvents.id))
    .limit(CARD_EVENTS_MAX + 1);
  const truncated = eventRows.length > CARD_EVENTS_MAX;
  const recent = eventRows.slice(0, CARD_EVENTS_MAX).reverse();

  const userId = row.userId;
  // Лента обрезана — шаги сделки только с первого показанного события: более
  // ранним нет визита на экране, и они встали бы в «на других устройствах».
  const actionsFrom = truncated && recent.length > 0 ? recent[0].at : row.firstSeenAt;
  const extras = userId
    ? await accountExtras(userId, visitorId, actionsFrom, new Date(row.lastSeenAt.getTime() + VISIT_GAP_MS))
    : null;

  const listingIds = [
    ...new Set([
      ...listingIdsInPaths(recent.map((e) => e.path)),
      ...recent.map((e) => e.listingId).filter((x): x is string => x !== null),
    ]),
  ];
  const [cityRows, categoryRows, titleRows] = await Promise.all([
    db.select({ slug: cities.slug, name: cities.name }).from(cities),
    db.select({ slug: categories.slug, name: categories.name }).from(categories),
    listingIds.length > 0
      ? db.select({ id: listings.id, title: listings.title }).from(listings).where(inArray(listings.id, listingIds))
      : Promise.resolve([] as { id: string; title: string }[]),
  ]);
  const directory: Directory = {
    cities: new Map(cityRows.map((c) => [c.slug, c.name])),
    categories: new Map(categoryRows.map((c) => [c.slug, c.name])),
    listings: new Map(titleRows.map((l) => [l.id, l.title])),
  };

  const login = extras?.firstLogin;
  const signupLoginId = login && row.userCreatedAt && isSignupLogin(login.at, row.userCreatedAt) ? login.id : null;

  return {
    visitor: {
      id: row.id,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      firstSource: (row.firstSource as Source | null) ?? null,
      device: row.device,
      ymClientId: row.ymClientId,
      isBot: row.isBot,
      isInternal: row.isInternal,
      personFirstSeenAt: row.personFirstSeenAt,
      continued: row.continued === true,
      days: row.days,
    },
    user: userId && row.userEmail && row.userCreatedAt
      ? {
        id: userId,
        name: row.userName,
        email: row.userEmail,
        createdAt: row.userCreatedAt,
        providers: extras?.providers ?? [],
        hasPassword: row.hasPassword === true,
        otherDevices: extras?.otherDevices ?? 0,
      }
      : null,
    events: recent.map((e) => ({
      ...e,
      props: e.props ?? {},
      listingTitle: e.listingId ? directory.listings.get(e.listingId) ?? null : null,
    })),
    truncated,
    actions: extras?.actions ?? [],
    signupLoginId,
    directory,
  };
}

// type, а не interface: строки db.execute обязаны быть Record<string, unknown>.
export type SearchRow = {
  /** Запрос в нижнем регистре; null — выдача без запроса (весь каталог). */
  q: string | null;
  people: number;
  /** Разных пар «браузер · день»: листание и смена сортировки повтором не считаются. */
  times: number;
};

export interface SearchStats {
  since: string;
  top: (SearchRow & { lastTotal: number | null })[];
  zero: (SearchRow & { reason: string })[];
  partial: (SearchRow & { usedQuery: string | null; lastTotal: number | null })[];
}

export async function adminSearchStats(f: AnalyticsFilters, now: Date = new Date()): Promise<SearchStats> {
  await adminRead();
  const db = getDb();
  const since = periodStartDay(f.period, now);
  const scope = sql`e.type = 'search' and e.created_at >= ${moscowMidnightUtc(since)} ${humansOnly(f.all)}`;
  const people = sql`count(distinct coalesce(v.user_id, v.id::text))::int as people`;
  const times = sql`count(distinct (e.visitor_id, ${moscowDate(sql`e.created_at`)}))::int as times`;
  const lastTotal = sql`(array_agg(e.total order by e.created_at desc, e.id desc))[1] as "lastTotal"`;

  const [top, zero, partial] = await Promise.all([
    db.execute<SearchStats["top"][number]>(sql`
      select lower(e.q) as q, ${people}, ${times}, ${lastTotal}
      from visitor_events e join visitors v on v.id = e.visitor_id
      where ${scope} and e.q is not null
      group by lower(e.q)
      order by people desc, times desc, q
      limit ${SEARCH_ROWS_MAX}
    `),
    db.execute<SearchStats["zero"][number]>(sql`
      select lower(e.q) as q, e.props->>'reason' as reason, ${people}, ${times}
      from visitor_events e join visitors v on v.id = e.visitor_id
      where ${scope} and ${ZERO_RESULT}
      group by lower(e.q), e.props->>'reason'
      order by people desc, times desc, q nulls last
      limit ${SEARCH_ROWS_MAX}
    `),
    // Нашлось по части слов и выдача не пуста: человек увидел похожее. Пустая
    // (фильтры отсекли и это) — уже в «не нашли».
    db.execute<SearchStats["partial"][number]>(sql`
      select lower(e.q) as q, lower(e.props->>'usedQuery') as "usedQuery", ${people}, ${times}, ${lastTotal}
      from visitor_events e join visitors v on v.id = e.visitor_id
      where ${scope} and e.q is not null and e.props->>'partial' = 'true' and e.props->>'reason' is null
      group by lower(e.q), lower(e.props->>'usedQuery')
      order by people desc, times desc, q
      limit ${SEARCH_ROWS_MAX}
    `),
  ]);

  return { since, top: top.rows, zero: zero.rows, partial: partial.rows };
}
