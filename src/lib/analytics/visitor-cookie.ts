// Куки своей статистики посещений: имена, атрибуты и формат id в одном месте.
//
// Leaf-модуль по образцу city-cookie.ts, без getEnv: его берёт edge-middleware,
// где окружение не валидируется, и клиентский код, которому нужно только имя.
// Поэтому признак https приходит аргументом — у каждого вызывающего свой
// способ его узнать.

/** id браузера для своей статистики: UUID, выдаёт middleware. */
export const VISITOR_COOKIE = "vid";

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
