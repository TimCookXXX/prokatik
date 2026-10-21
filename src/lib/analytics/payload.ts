// Тело POST /api/analytics: пачка событий от трекера (components/analytics/
// track.ts). Приходит извне и типу не соответствует сама — каждое поле здесь
// ограничено длиной, лишние поля и неизвестные типы отклоняют пачку целиком.
// Что событие значит, решает сервер: путь и referrer чистит sanitize.ts.

import { z } from "zod";
import { TRACK_BATCH_MAX, TRACK_RAW_PATH_MAX, TRACK_TOKEN_MAX } from "./limits";

/** Адрес страницы, как его видит браузер: путь и query. Чистит сервер. */
const rawPath = z.string().min(1).max(TRACK_RAW_PATH_MAX);

const pageview = z.object({
  type: z.literal("pageview"),
  path: rawPath,
  /** Первая страница загрузки документа: у неё есть вход — referrer и метки. */
  doc: z.literal(true).optional(),
  /** document.referrer первой страницы. */
  ref: z.string().max(TRACK_RAW_PATH_MAX).optional(),
}).strict();

/** ClientID Метрики — раз на загрузку документа, если счётчик поднят. */
const ymClient = z.object({
  type: z.literal("ym_client"),
  cid: z.string().regex(/^\d{1,32}$/),
}).strict();

/** Подписанные данные страницы (lib/analytics/token.ts); проверяет роут. */
const token = z.string().min(1).max(TRACK_TOKEN_MAX);

/** Показ выдачи /search: что искали и что нашлось — в токене. */
const search = z.object({ type: z.literal("search"), path: rawPath, token }).strict();

/** Показ чужого объявления: какое — в токене. */
const viewListing = z.object({ type: z.literal("view_listing"), path: rawPath, token }).strict();

/** «Забронировать»: объявление — из токена страницы, «в аккаунте ли» знает роут. */
const bookingClick = z.object({ type: z.literal("booking_click"), path: rawPath, token }).strict();

export const clientEventSchema = z.discriminatedUnion("type", [pageview, ymClient, search, viewListing, bookingClick]);

export const batchSchema = z.object({
  events: z.array(clientEventSchema).min(1).max(TRACK_BATCH_MAX),
  /** navigator.webdriver: браузером управляет скрипт — гость помечается ботом. */
  bot: z.literal(true).optional(),
}).strict();

export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ClientEventType = ClientEvent["type"];
export type Batch = z.infer<typeof batchSchema>;
