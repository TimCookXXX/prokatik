import {
  pgTable, text, varchar, integer, bigint, timestamp, pgEnum, jsonb, check,
  boolean, date, doublePrecision, index, primaryKey, uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRole = pgEnum("user_role", ["user", "moderator", "admin"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: timestamp("email_verified"),
  name: varchar("name", { length: 100 }),
  // Телефон запрашивается в первой заявке на бронь и служит контактом продавца.
  // СМС-верификации нет: phone_verified_at заложен, всегда NULL.
  phone: varchar("phone", { length: 20 }),
  phoneVerifiedAt: timestamp("phone_verified_at"),
  image: text("image"),
  // Обложка профиля: широкая фотография над шапкой кабинета и над публичной
  // страницей продавца. Грузит сам владелец, рекомендуемая пропорция 4:1.
  coverUrl: text("cover_url"),
  bio: text("bio"),
  // «Мой город» — где человек живёт, а НЕ где лежит его вещь: у объявления свой
  // city_id, и они не обязаны совпадать (переехал, сдаёт дачный инвентарь в
  // другом городе). Отсюда берётся город в публичном профиле и предзаполнение
  // формы объявления. NULL у всех, кто его не указывал: спрашивать город при
  // регистрации ради строки в байлайне — плохая сделка.
  cityId: text("city_id").references(() => cities.id, { onDelete: "set null" }),
  // argon2id. NULL у OAuth-юзеров: пароль есть только у тех, кто регистрировался почтой.
  passwordHash: text("password_hash"),
  role: userRole("role").notNull().default("user"),
  // «Проверен» — ставится вручную админом (см. Фаза 6).
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  banReason: text("ban_reason"),
  bannedAt: timestamp("banned_at"),
});

// NB: TS-keys в `accounts` намеренно mixed case (camelCase для userId/providerAccountId,
// snake_case для refresh_token/access_token/etc) — этого требует @auth/drizzle-adapter,
// он обращается к property-names напрямую.
export const accounts = pgTable("accounts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (t) => ({
  pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
}));

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires").notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.identifier, t.token] }),
}));

export const emailTokenPurpose = pgEnum("email_token_purpose", ["verify", "reset"]);

// Одноразовые ссылки из писем. В БД лежит sha256 от токена, оригинал уходит в письмо:
// дамп базы не должен давать вход в чужие аккаунты.
export const emailTokens = pgTable("email_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: emailTokenPurpose("purpose").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  // Штамп предъявления. Токены, отменённые выпуском нового письма, не штампуются,
  // а удаляются — иначе льготное окно на повторный клик оживляло бы их.
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userPurposeIdx: index("email_tokens_user_purpose_idx").on(t.userId, t.purpose),
}));

// uploads — изображения, нормализованные через /api/upload (webp) и положенные в S3.
export const uploads = pgTable("uploads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull().unique(),
  publicUrl: text("public_url").notNull(),
  mime: varchar("mime", { length: 60 }).notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("uploads_user_idx").on(t.userId, t.createdAt),
}));

// ============================== Каталог ==============================
// URL-структура публичной части: /{city}/{category}[/{sub}]/ (списки),
// /{city}/{categorySlug}/{slug}-{id}/ (карточка товара), /u/{id}/ (продавец).

export const cities = pgTable("cities", {
  id: text("id").primaryKey(),                        // ULID, newId()
  name: varchar("name", { length: 100 }).notNull(),
  // Предложный падеж без предлога: «Казани» для «в Казани». Заголовки каталога
  // клеят к названию предлог, а из именительного его не собрать — выходило
  // «Аренда: дрели в Казань». Правилом это не решается: «в Нижнем Новгороде»,
  // «в Ростове-на-Дону», «в Набережных Челнах» — не редкие исключения, а
  // города-миллионники. Поэтому поле хранимое, а правило лишь подсказывает
  // значение в админке. NULL допустим: пока пусто, заголовок собирается без
  // предлога, но неверный падеж не показывается никогда.
  nameLocative: varchar("name_locative", { length: 100 }),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  region: varchar("region", { length: 100 }),
  // Центр города: от него ранжируются подсказки адресов, пока человек не
  // выбрал своей точки. Задаётся вместе с geo_region.
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
  // Ключ геоданных в geo_* — регион, а не город: город и его пригороды делят
  // один индекс адресов (krasnodar и yablonovskiy — оба `krasnodar`). NULL —
  // у города геоданных нет: «Где» не показывается, адрес вводится текстом.
  // Это же аварийный выключатель геокодера для города.
  geoRegion: varchar("geo_region", { length: 40 }),
  isActive: boolean("is_active").notNull().default(true),
});

// Дерево 2 уровня: parent_id NULL = корневая категория, иначе — подкатегория.
// vertical — грубая группировка ниш (tools / sport / dresses / photo / kids ...).
export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  vertical: varchar("vertical", { length: 40 }),
}, (t) => ({
  parentIdx: index("categories_parent_idx").on(t.parentId),
}));

export const depositType = pgEnum("deposit_type", ["money", "document", "none"]);
export const listingStatus = pgEnum("listing_status", ["active", "hidden", "archived"]);
// Точность точки адреса объявления: дом, до улицы, до пункта (микрорайон,
// посёлок, ЖК) или точки нет вовсе — город без геоданных или адрес не нашёлся.
// Значения — GEO_PRECISIONS в src/lib/geo/precision.ts.
export const listingGeoPrecision = pgEnum("listing_geo_precision", ["house", "street", "place", "city"]);

// Товар принадлежит юзеру напрямую. Город и категория — атрибуты товара.
// slug читаемый и НЕ уникальный: уникальность URL даёт id в хвосте пути.
// Цены в рублях за период; NULL = не сдаётся на этот период.
export const listings = pgTable("listings", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  cityId: text("city_id").notNull().references(() => cities.id),
  categoryId: text("category_id").notNull().references(() => categories.id),
  title: varchar("title", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull(),
  description: text("description"),
  // Адрес получения. address — полная подпись, выбранная владельцем (может
  // быть с номером дома), её видит только он сам в форме. location — публичная
  // подпись без номера дома: её показывает страница объявления. Точку и
  // address публичные чтения не выбирают вовсе (publicListingColumns в
  // src/server/catalog.ts). NULL в address — только у строк до backfill.
  location: varchar("location", { length: 120 }),
  address: varchar("address", { length: 200 }),
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
  geoPrecision: listingGeoPrecision("geo_precision").notNull().default("city"),
  // Цена одна: аренда посуточная — см. docs/BACKLOG.md о снятых тарифах.
  priceDay: integer("price_day").notNull(),
  depositAmount: integer("deposit_amount"),
  depositType: depositType("deposit_type").notNull().default("none"),
  quantity: integer("quantity").notNull().default(1),
  // Способ получения — два независимых флага, а не enum: «и самовывоз, и
  // доставка» это пересечение двух фактов, и в enum оно стало бы третьим
  // значением, а с появлением третьего способа — пятым. Дефолт «самовывоз без
  // доставки» достаётся и всем объявлениям, созданным до этой колонки:
  // платежей и логистики в сервисе нет, доставку люди обсуждают между собой.
  handoverPickup: boolean("handover_pickup").notNull().default(true),
  handoverDelivery: boolean("handover_delivery").notNull().default(false),
  photosJson: jsonb("photos_json").notNull().default([]),  // { url, width, height }[]
  status: listingStatus("status").notNull().default("active"),
  // Объявление ушло в hidden не по воле владельца, а из-за бана. Нужен, чтобы
  // разбан вернул в active ровно погашенное баном и не поднял то, что владелец
  // скрыл сам: по одному лишь статусу эти два случая неотличимы.
  hiddenByBan: boolean("hidden_by_ban").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  cityCategoryStatusIdx: index("listings_city_category_status_idx").on(t.cityId, t.categoryId, t.status),
  ownerIdx: index("listings_owner_idx").on(t.ownerUserId),
  // Точка — пара, а не половина: расстояние считается только по обеим.
  pointPair: check("listings_point_pair", sql`(${t.lat} is null) = (${t.lon} is null)`),
}));

// availability — по строке на (listing, дата). Свободно = quantity - booked - blocked.
// Строки создаются лениво: отсутствие строки = день полностью свободен.
// blocked_qty — ручные закрытия владельцем («сдал по телефону», «в ремонте»).
export const availability = pgTable("availability", {
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  bookedQty: integer("booked_qty").notNull().default(0),
  blockedQty: integer("blocked_qty").notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.listingId, t.date] }),
}));

export const bookingStatus = pgEnum("booking_status", [
  "new", "confirmed", "declined", "expired", "completed", "cancelled",
]);

// Заявка на бронь. Денег сервис не проводит; подтверждение — за владельцем.
// owner_user_id денормализован из listing.owner_user_id ради индекса «входящие
// заявки владельцу» без join; владелец неизменен — рассинхрона нет.
// expires_at — протухание new-заявки (по умолчанию +24ч от created_at).
export const bookingRequests = pgTable("booking_requests", {
  id: text("id").primaryKey(),
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  customerUserId: text("customer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  qty: integer("qty").notNull().default(1),
  /* Условия сделки НА МОМЕНТ ЗАЯВКИ. Денормализованы из объявления по той же
   * причине, что owner_user_id, но с обратным знаком: владелец не меняется, а
   * цена и залог меняются в любой момент.
   *
   * Без снимка «стоимость» пересчитывалась из текущей цены вещи, и заявка
   * недельной давности дорожала задним числом — человек видел не ту сумму, на
   * которую соглашался. Считать нужно по тому, что показали в момент выбора
   * дат; смотреть на вещь вправе только чип «вот эта вещь стоит столько».
   *
   * Сервис денег не проводит, так что это не договор, а честная запись о том,
   * из чего человек исходил. Она же уезжает копией в журнал сделки. */
  priceDay: integer("price_day").notNull(),
  depositType: depositType("deposit_type").notNull().default("none"),
  depositAmount: integer("deposit_amount"),
  status: bookingStatus("status").notNull().default("new"),
  customerPhone: varchar("customer_phone", { length: 20 }).notNull(),
  /* Комментарий клиента к заявке. Живёт колонкой, потому что читается в
   * момент решения — в шторке прямо над кнопками, — и тянуть его туда из
   * переписки значило бы джойнить чат ради одной строки. В журнал сделки он
   * попадает копией, в meta системной записи: у читателей разные экраны.
   *
   * Комментария владельца здесь больше нет. Он появился, когда у владельца не
   * было канала к клиенту вовсе, и снят вместе с этой причиной: решения
   * объясняются в переписке. Цена снятия названа в ADR 0017 — у владельца
   * скрытой вещи канала снова нет, отказ приходит без причины. */
  customerComment: text("customer_comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  respondedAt: timestamp("responded_at"),
  /* Когда бронь подтвердили. Не то же, что responded_at: та перезаписывается
   * КАЖДЫМ решением, и после отмены или автозакрытия времени подтверждения в
   * ней уже нет. А правило раскрытия телефона спрашивает именно «подтверждали
   * ли когда-нибудь»: по текущему статусу этого не узнать — cancelled бывает и
   * у новой заявки, которую арендатор отозвал, не получив ничьего согласия. */
  confirmedAt: timestamp("confirmed_at"),
  expiresAt: timestamp("expires_at").notNull(),
}, (t) => ({
  ownerStatusIdx: index("booking_requests_owner_status_idx").on(t.ownerUserId, t.status, t.createdAt),
  customerIdx: index("booking_requests_customer_idx").on(t.customerUserId, t.createdAt),
  listingIdx: index("booking_requests_listing_idx").on(t.listingId),
  /* Под ленивую уборку: без него expireStaleRequests идёт сиквеншл-сканом с
   * записью — а дёргается она теперь и при каждом обновлении счётчиков по
   * событию сокета.
   *
   * Уборок в ней две, и вторая, закрытие аренды по прошедшим датам, ходит по
   * (status, date_to) — этим индексом она пользуется только префиксом
   * `status`. Своего ей пока не заводим: подтверждённых броней на порядки
   * меньше, чем заявок, и префикс отсекает почти всё. */
  staleIdx: index("booking_requests_stale_idx").on(t.status, t.expiresAt),
  /* Двойное нажатие «Забронировать» давало владельцу две одинаковые заявки:
   * подтвердит одну, вторая сутки висит и протухает. Индексом, а не проверкой
   * перед записью, — та от гонки не защищает, между чтением и вставкой
   * помещается вторая вкладка.
   *
   * Ровно те же даты, а не пересечение: пересечение запретило бы взять вторую
   * единицу вещи, у которой quantity больше одной, и стык «1–5, потом 5–8» —
   * границы диапазона включительные. Только среди ждущих ответа: отклонённую
   * заявку человек вправе отправить заново. */
  liveDupUq: uniqueIndex("booking_requests_live_dup_uq")
    .on(t.listingId, t.customerUserId, t.dateFrom, t.dateTo)
    .where(sql`${t.status} = 'new'`),
}));

// events — сырые продуктовые события (view_listing, view_phone, submit_request...).
// Основа статистики для владельца; агрегатов в v1 нет.
export const events = pgTable("events", {
  id: text("id").primaryKey(),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: text("entity_id").notNull(),
  event: varchar("event", { length: 60 }).notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  metaJson: jsonb("meta_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  entityIdx: index("events_entity_idx").on(t.entityType, t.entityId, t.createdAt),
}));

// chat_threads — переписка по конкретному объявлению между его владельцем и
// одним арендатором. Ключ (listing_id, customer_user_id): у владельца с десятком
// вещей переписки не смешиваются, а контекст разговора виден без вопросов.
//
// owner_user_id денормализован из listings по той же причине, что и в
// booking_requests: список «мои переписки» читается по индексу без join.
// Владелец объявления неизменен — рассинхрона не будет.
//
// Превью последнего сообщения намеренно НЕ денормализовано: колонка под него
// породила бы гонку записи при двух почти одновременных сообщениях, а на
// текущих объёмах LATERAL-джойн к chat_messages ничего не стоит. last_message_at
// остаётся — по нему сортируется список, и без колонки в индексе сортировать нечем.
export const chatThreads = pgTable("chat_threads", {
  id: text("id").primaryKey(),
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  customerUserId: text("customer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  // Курсоры прочтения — id последнего прочитанного сообщения, а не timestamp:
  // индекс chat_messages идёт по id (ULID), и timestamp с ним не сравнить.
  ownerLastReadMessageId: text("owner_last_read_message_id"),
  customerLastReadMessageId: text("customer_last_read_message_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  pairUq: uniqueIndex("chat_threads_listing_customer_uq").on(t.listingId, t.customerUserId),
  ownerIdx: index("chat_threads_owner_idx").on(t.ownerUserId, t.lastMessageAt),
  customerIdx: index("chat_threads_customer_idx").on(t.customerUserId, t.lastMessageAt),
}));

// notifications — персистентный список получателя: одно место с историей вместо
// трёх разрозненных бейджей, и точка, куда поедут события сокета.
//
// entity_type нет намеренно: kind однозначно задаёт тип сущности, а вторая
// колонка могла бы с ним разъехаться. Внешнего ключа на entity_id тоже нет —
// связь полиморфная (тред или заявка). Это отклонение от остальной схемы, где
// всё связано FK; прецедент — events. Каскад тут не работает, и UI обязан
// пережить запись, чья сущность недоступна.
//
// created_at означает не «когда создано», а «последняя активность»: ON CONFLICT
// DO UPDATE двигает его. Без бампа схлопнутое уведомление не всплывало бы в
// списке, а снимок в markThreadRead гасил бы его вместе со свежим сообщением.
//
// Список видов продублирован из src/lib/notifications/kinds.ts: слой db не
// импортирует из lib. От расхождения страхует тест.
export const notificationKind = pgEnum("notification_kind", [
  "chat_message",
  "request_created",
  "request_cancelled",
  "request_confirmed",
  "request_declined",
  "request_completed",
]);

// Сторона получателя в событии по заявке. Хранится, а не выводится из вида,
// потому что вид её не задаёт: `request_cancelled` адресован владельцу, когда
// отменил арендатор, и арендатору, когда отменит владелец.
//
// Второй случай кода пока не имеет — отменять умеет только арендатор, — и
// именно поэтому бэкфил по старому правилу верен: неправильных строк в базе
// никогда не было. Право владельца отменять бронь появится следующим этапом, и
// с ним прежнее правило перестало бы работать молча.
export const notificationSide = pgEnum("notification_side", ["owner", "customer"]);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: notificationKind("kind").notNull(),
  /** Пусто у `chat_message`: у сообщения сторон сделки нет. */
  side: notificationSide("side"),
  entityId: text("entity_id").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // Дедупликация среди непрочитанных: пятьдесят сообщений треда схлопываются в
  // одну строку. Он же обслуживает счётчик — отдельный индекс (user_id) where
  // read_at is null был бы его префиксом и ничего не добавил.
  unreadUq: uniqueIndex("notifications_unread_uq")
    .on(t.userId, t.kind, t.entityId)
    .where(sql`${t.readAt} is null`),
  // id третьей колонкой: сортировка идёт по (created_at desc, id desc), и без
  // него страница обходится сортировкой всего, что старше курсора.
  listIdx: index("notifications_user_created_idx")
    .on(t.userId, t.createdAt.desc(), t.id.desc()),
  // Под ленивую чистку. Критерий именно read_at: по created_at этот индекс не
  // зайдёт, и удаление пойдёт сиквеншл-сканом.
  cleanupIdx: index("notifications_cleanup_idx")
    .on(t.readAt)
    .where(sql`${t.readAt} is not null`),
}));

// chat_messages — id это ULID, он лексикографически сортируется по времени.
// Поэтому история листается курсором (WHERE thread_id = ? AND id < ?), без
// OFFSET, который деградирует на длинных переписках.
// Вид сообщения. `user` — реплика человека, остальное — запись о событии
// сделки: тред по вещи служит её журналом. Текст системной записи НЕ хранится,
// он собирается из вида и meta при выводе — иначе правка формулировки
// потребовала бы переписывать историю.
//
// Ленивой уборки в списке нет намеренно: `expireStaleRequests` — массовый
// UPDATE, который зовут перед чтением списков, и запись в треды превратила бы
// его в N+1 внутри чужого рендера. Оба её исхода — протухание и закрытие
// аренды по прошедшим датам — остаются вне журнала; цена названа в ADR 0017.
export const chatMessageKind = pgEnum("chat_message_kind", [
  "user",
  "request_created",
  "request_confirmed",
  "request_declined",
  "request_cancelled",
  "request_completed",
]);

export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  /** Пусто у системной записи: её пишет сделка, а не человек. */
  senderUserId: text("sender_user_id").references(() => users.id, { onDelete: "cascade" }),
  kind: chatMessageKind("kind").notNull().default("user"),
  // Предел длины держит zod в lib/chat/validation, а не БД: сообщение приходит
  // извне, и отказать надо до похода в базу.
  /** Пусто у системной записи — её текст собирается из kind и meta. */
  body: text("body"),
  /** Данные системной записи: id заявки, даты, количество. */
  metaJson: jsonb("meta_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  /* Форма строки определена видом: у реплики есть автор и текст, у записи о
   * сделке нет ни того, ни другого. Констрейнтом, а не договорённостью,
   * потому что на «реплике без автора» две половины одного правила расходятся:
   * в JS `null === viewerId` ложно и сообщение считается непрочитанным, в SQL
   * `sender_user_id <> $1` при NULL даёт NULL и строка выпадает. Пока такое
   * состояние невозможно, расхождению неоткуда взяться. */
  kindShape: check("chat_messages_kind_shape", sql`
    (${t.kind} = 'user' and ${t.senderUserId} is not null and ${t.body} is not null)
    or (${t.kind} <> 'user' and ${t.senderUserId} is null and ${t.body} is null)`),
  threadIdx: index("chat_messages_thread_idx").on(t.threadId, t.id),
  // Без него каскад при удалении пользователя пойдёт сиквеншл-сканом.
  senderIdx: index("chat_messages_sender_idx").on(t.senderUserId),
}));

// ============================== Геоданные ==============================
// Адреса региона для своего геокодера: OpenStreetMap (© участники OSM, ODbL) и
// ГАР ФНС (открытые данные). Таблицы — ровно то, что читает загрузчик движка
// (src/server/geocoder-index.ts), в форме контракта GeoIndexData
// (src/lib/geocoder/types.ts). Пишет их только `pnpm geo:import`: удаляет
// строки региона и вставляет новые одной транзакцией.
//
// Ключ — регион (cities.geo_region), FK на cities нет: один регион обслуживает
// несколько городов. FK между самими гео-таблицами тоже нет — регион
// заменяется целиком, и целостность держит импорт. Индексы составные
// (region, id): загрузчик читает регион с `order by id`, и с индексом по
// одному region полмиллиона домов сортировались бы на диске.
//
// id мест, улиц и объектов — стабильные ключи выгрузки (p_…, s_…), уникальны в
// пределах региона.

// Населённые пункты, округа, микрорайоны и СНТ (PlaceKind).
export const geoPlaces = pgTable("geo_places", {
  id: text("id").notNull(),
  region: varchar("region", { length: 40 }).notNull(),
  kind: varchar("kind", { length: 20 }).notNull(),                          // city|town|village|…|okrug
  name: varchar("name", { length: 160 }).notNull(),                         // «Яблоновский», «СНТ Кубаночка»
  aliases: text("aliases").array().notNull(),                               // «пгт Яблоновский», «ЮМР»
  parentId: text("parent_id"),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.region, t.id] }),
}));

// Улицы: одна строка — одна улица одного пункта.
export const geoStreets = pgTable("geo_streets", {
  id: text("id").notNull(),
  region: varchar("region", { length: 40 }).notNull(),
  placeId: text("place_id"),
  name: varchar("name", { length: 200 }).notNull(),                         // «улица Красная»
  type: varchar("type", { length: 30 }).notNull(),                          // улица, проспект… ('' — без типа)
  aliases: text("aliases").array().notNull(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  houses: integer("houses").notNull(),                                      // домов в индексе — вес ранжирования
  // Линия улицы — куски [[lon, lat], …]; NULL — линии в OSM нет.
  line: jsonb("line").$type<[number, number][][]>(),
}, (t) => ({
  pk: primaryKey({ columns: [t.region, t.id] }),
}));

// Дома. Своего ключа в выгрузке у них нет, поэтому id — identity: он же хранит
// порядок файла (выгрузка отсортирована по улице и номеру), и загрузчик читает
// дома в том же порядке, в каком их отдал бы JSON.
export const geoHouses = pgTable("geo_houses", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  region: varchar("region", { length: 40 }).notNull(),
  streetId: text("street_id"),                                              // NULL — адрес по пункту
  placeId: text("place_id"),
  number: varchar("number", { length: 40 }).notNull(),                      // «21к1», «7Б», «21/1»
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  precision: varchar("precision", { length: 12 }).notNull(),                // AddrPrecision
  source: varchar("source", { length: 10 }).notNull(),                      // AddrSource
  postcode: varchar("postcode", { length: 6 }),
}, (t) => ({
  regionIdx: index("geo_houses_region_idx").on(t.region, t.id),
}));

// Объекты, которые вводят вместо адреса: ТЦ, рынки, ЖК, вузы, вокзалы.
export const geoPois = pgTable("geo_pois", {
  id: text("id").notNull(),
  region: varchar("region", { length: 40 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),                         // «ТЦ Красная Площадь»
  kind: varchar("kind", { length: 30 }).notNull(),                          // mall|market|residential_complex…
  aliases: text("aliases").array().notNull(),
  placeId: text("place_id"),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  address: varchar("address", { length: 200 }),                             // «улица Дзержинского, 100»
}, (t) => ({
  pk: primaryKey({ columns: [t.region, t.id] }),
}));

// Импорт региона: какая выгрузка сейчас в таблицах. Строка на регион — импорт
// заменяет и её. Версия и время сборки — из файла; по ним сервер узнаёт, что
// данные сменились, и собирает движок заново. built_at с зоной: импорт идёт с
// машины разработчика, и время без зоны съехало бы на разницу поясов.
export const geoImports = pgTable("geo_imports", {
  id: text("id").primaryKey(),                                              // ULID, newId()
  region: varchar("region", { length: 40 }).notNull(),
  version: varchar("version", { length: 64 }).notNull(),                    // «osm-2026-09-28+gar-2026-09-28»
  builtAt: timestamp("built_at", { withTimezone: true }).notNull(),
  counts: jsonb("counts").$type<Record<string, number>>().notNull(),        // мест, улиц, домов, объектов
}, (t) => ({
  regionIdx: index("geo_imports_region_idx").on(t.region, t.id),
}));
