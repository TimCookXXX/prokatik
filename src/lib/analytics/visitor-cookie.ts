// Куки своей статистики посещений: имена, атрибуты и формат id в одном месте.
//
// Leaf-модуль по образцу city-cookie.ts, без getEnv: его берёт edge-middleware,
// где окружение не валидируется, и клиентский код, которому нужно только имя.
// Поэтому признак https приходит аргументом — у каждого вызывающего свой
// способ его узнать.

import { VISITOR_RETENTION_DAYS } from "./limits";

/** id браузера для своей статистики: UUID, выдаёт middleware. */
export const VISITOR_COOKIE = "vid";

/**
 * Прежние id этого браузера: при входе, выходе и смене аккаунта браузер
 * получает новый vid, а старый уходит сюда. Нужны они только отказу от учёта —
 * удалить и ту статистику, что велась под ними. Связь старого id с новым живёт
 * только в браузере: в базу роут её не пишет (история до входа с аккаунтом не
 * связывается).
 */
export const PREVIOUS_VISITORS_COOKIE = "vid_prev";
/** Сколько прежних id помнит браузер; более давние доживают до срока хранения. */
export const PREVIOUS_VISITORS_MAX = 10;
const PREVIOUS_SEPARATOR = ".";

/** Отказ от учёта на этом устройстве. Выключает и свою статистику, и Метрику. */
export const OPT_OUT_COOKIE = "noanalytics";
export const OPT_OUT_VALUE = "1";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

// Только UUID: всё прочее в куке — мусор или подделка, и строкой в базе оно не
// становится. Регистр любой, как у crypto.randomUUID и у Postgres uuid.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isVisitorId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Прежние id из куки: только UUID, в нижнем регистре, без повторов. */
export function parsePreviousVisitors(value: string | undefined): string[] {
  if (!value) return [];
  const ids = value.split(PREVIOUS_SEPARATOR).filter(isVisitorId).map((id) => id.toLowerCase());
  return [...new Set(ids)].slice(0, PREVIOUS_VISITORS_MAX);
}

/** Значение куки, когда браузер уходит с id `left`: он первым, самые давние отпадают. */
export function withPreviousVisitor(previous: readonly string[], left: string): string {
  const id = left.toLowerCase();
  return [id, ...previous.filter((p) => p !== id)].slice(0, PREVIOUS_VISITORS_MAX).join(PREVIOUS_SEPARATOR);
}

// httpOnly: id браузера читает только сервер, скрипту на странице он не нужен.
// Год, продлевается на каждой загрузке документа (middleware).
export function visitorCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: YEAR_SECONDS,
  };
}

// Как vid, но на срок хранения карточки браузера: строка прежнего id живёт до
// VISITOR_RETENTION_DAYS после последнего захода, и всё это время отказ должен
// до неё дотянуться.
export function previousVisitorsCookieOptions(secure: boolean) {
  return { ...visitorCookieOptions(secure), maxAge: VISITOR_RETENTION_DAYS * 24 * 60 * 60 };
}

// НЕ httpOnly: отказ читает и клиент — трекер, очередь целей и инлайн-сниппет
// Метрики, который решает до гидрации. Секрета в нём нет.
export function optOutCookieOptions(secure: boolean) {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: YEAR_SECONDS,
  };
}
