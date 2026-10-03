// In-memory rate limiter — рассчитан на одноинстансный деплой.
// TODO: persistent backend (Redis/Postgres) при scale-out.
//
// Ключ — произвольная строка: для доменных действий это userId, для входа и
// писем — почта, IP или их пара.

export type LimitKind =
  | "booking" | "booking_listing" | "login" | "register" | "resend" | "reset"
  | "mail_ip" | "mail_daily" | "mail_booking" | "password_change"
  | "chat_message" | "chat_thread" | "chat_read"
  | "realtime_sync"
  | "search" | "geo";

// Потолок отправки на весь сервис за сутки. Яндекс даёт 300 писем в сутки по
// SMTP и режет раньше, если письма однотипные, — упереться хочется в свой
// счётчик, а не в блокировку ящика, из которой сервис сам не выберется.
export const MAIL_DAILY_CAP = 250;
// Общий ключ: лимит один на всех, отправитель значения не имеет.
export const MAIL_DAILY_KEY = "service";
export type LimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number; reason: "gap" | "window" };

interface Rule {
  windowMs: number;
  maxInWindow: number;
  gapMs: number;
  /** Публичные ручки с ключом по IP живут в своём хранилище (см. ниже). */
  store?: "public";
}

const RULES: Record<LimitKind, Rule> = {
  // Антиспам заявок вместо СМС-верификации: потолок в окно плюс пауза.
  // Ключ — человек, и это важно: по объявлению его делать нельзя, иначе один
  // злоумышленник выжигает квоту популярной вещи и закрывает её для всех
  // остальных на час.
  booking: { windowMs: 60 * 60 * 1000, maxInWindow: 15, gapMs: 30_000 },
  /* Второй контур — пара (человек, объявление). Общий потолок в пять заявок
   * бил по честному сценарию: присматривать шесть вещей за вечер нормально, а
   * шестая заявка не уходила. Потолок поэтому поднят, а от долбёжки в одну
   * вещь защищает уже этот ключ. Паузы здесь нет — её держит общий контур.
   *
   * Пять, а не три: checkLimit расходует слот ДО проверок мутации, и подряд
   * идущие отказы — занято, даты устарели, дубль — тоже его тратят. С тремя
   * слотами человек, перебирающий даты у занятой вещи, запирался бы на час. */
  booking_listing: { windowMs: 60 * 60 * 1000, maxInWindow: 5, gapMs: 0 },
  // Вход: паузы нет, работает счётчик попыток.
  login:    { windowMs: 15 * 60 * 1000, maxInWindow: 10, gapMs: 0 },
  register: { windowMs: 60 * 60 * 1000, maxInWindow: 5,  gapMs: 5_000 },
  resend:   { windowMs: 60 * 60 * 1000, maxInWindow: 5,  gapMs: 60_000 },
  reset:    { windowMs: 60 * 60 * 1000, maxInWindow: 3,  gapMs: 60_000 },
  // Второй контур для всего, что шлёт письма: лимит по почте не мешает бомбить
  // разные ящики, а смена IP снимала бы лимит по почте.
  mail_ip:  { windowMs: 60 * 60 * 1000, maxInWindow: 10, gapMs: 0 },
  // Третий контур, общий: и почта, и IP считаются по своему ключу, поэтому
  // рассылка с десятка адресов проходит оба и выедает суточную квоту провайдера.
  mail_daily: { windowMs: 24 * 60 * 60 * 1000, maxInWindow: MAIL_DAILY_CAP, gapMs: 0 },
  /* Письма брони — по получателю: десятка событий в сутки одному человеку
   * достаточно, а больше — это уже цикл «создал → отменил», бомбящий ящик.
   * Общую суточную квоту сервиса (mail_daily) списывает sendMail: провайдер
   * считает все письма вместе, и письма входа защищены именно ею. */
  mail_booking: { windowMs: 24 * 60 * 60 * 1000, maxInWindow: 10, gapMs: 0 },
  // Ключ — userId. Без лимита поле «текущий пароль» — оракул для перебора.
  password_change: { windowMs: 15 * 60 * 1000, maxInWindow: 5, gapMs: 0 },
  // Переписка идёт очередями коротких реплик, поэтому паузы нет — как у login,
  // работу делает счётчик. Пауза booking (30с) здесь резала бы живой разговор.
  chat_message: { windowMs: 60 * 60 * 1000, maxInWindow: 60, gapMs: 0 },
  // Второй контур: бот, пишущий первым сотне владельцев, потолок сообщений
  // прошёл бы — по одному в каждый тред. Считается заведение новых тредов.
  chat_thread: { windowMs: 60 * 60 * 1000, maxInWindow: 10, gapMs: 0 },
  // Чтения, вызываемые с клиента (отметка прочтения, догрузка истории). Каждое
  // стоит несколько запросов к базе, а лимита у них иначе нет вовсе. Потолок
  // высокий: обычной работе с интерфейсом он не мешает.
  chat_read: { windowMs: 60 * 60 * 1000, maxInWindow: 300, gapMs: 0 },
  // Догон после разрыва и перечитывание счётчиков по событию сокета. Свой
  // бакет, а не chat_read: событие тела сообщения не несёт, поэтому каждое
  // доставленное сообщение стоит одного чтения — расходуется это ОБЫЧНЫМ
  // разговором, а не только флапающей сетью, и потолок chat_read такую
  // нагрузку выел бы, после чего чат молча перестал бы догонять.
  realtime_sync: { windowMs: 60 * 60 * 1000, maxInWindow: 1200, gapMs: 0 },
  // Публичные GET-ручки без входа, ключ — IP. Подсказки «Что» идут на каждое
  // нажатие с дебаунсом, поэтому потолок высокий: он против выкачивания и
  // долбёжки, а не против быстрого набора.
  search: { windowMs: 60 * 1000, maxInWindow: 300, gapMs: 0, store: "public" },
  // Подсказки адресов и обратный геокодер — тот же поток нажатий, тот же
  // потолок; он же мешает выкачать базу адресов перебором.
  geo: { windowMs: 60 * 1000, maxInWindow: 300, gapMs: 0, store: "public" },
};

// Аварийный выключатель на время ручных проверок. Читается один раз при старте
// процесса: смена значения требует перезапуска, и это намеренно — так его
// нельзя выключить незаметно на живом сервисе.
//
// ВНИМАНИЕ: снимает ВСЕ лимиты сразу, включая вход, регистрацию и отправку
// писем. Держать включённым в проде нельзя — без него перебор пароля и рассылка
// с сайта ничем не ограничены.
const DISABLED = process.env.RATE_LIMIT_DISABLED === "1";
if (DISABLED) {
  console.warn("[rate-limit] ВЫКЛЮЧЕН через RATE_LIMIT_DISABLED — только для проверок");
}

// Два хранилища. В общем — вход, почта, заявки, чат: ключей немного, и
// вытеснение самого давнего при заполнении их не трогает. Публичные ручки
// заводят ключ на каждый анонимный IP; в общем хранилище такой поток вытеснял
// бы ключи `login`, `reset`, `mail_daily` и молча обнулял их. Поэтому у них
// своё хранилище, побольше, с чисткой просроченных ключей при заполнении.
const MAX_KEYS = 10_000;
const MAX_PUBLIC_KEYS = 20_000;
const store = new Map<string, number[]>();
const publicStore = new Map<string, number[]>();

// Ключ при каждом успешном обращении переставляется в конец, так что порядок
// Map — порядок последней отметки. Просроченные поэтому лежат в начале подряд:
// чистка идёт с начала и останавливается на первом живом. Окна у публичных
// видов одинаковые; разойдутся — чистка лишь станет менее полной, вытеснение
// давнего всё равно держит потолок.
function sweepExpired(map: Map<string, number[]>, now: number): void {
  for (const [key, stamps] of map) {
    const kind = key.slice(key.lastIndexOf(":") + 1) as LimitKind;
    const last = stamps[stamps.length - 1];
    if (last !== undefined && now - last < (RULES[kind]?.windowMs ?? 0)) return;
    map.delete(key);
  }
}

function evictIfFull(map: Map<string, number[]>, max: number, now: number): void {
  if (map.size < max) return;
  if (map === publicStore) {
    sweepExpired(map, now);
    if (map.size < max) return;
  }
  const firstKey = map.keys().next().value;
  if (firstKey !== undefined) map.delete(firstKey);
}

export function checkLimit(subject: string, kind: LimitKind): LimitResult {
  if (DISABLED) return { ok: true };
  const rule = RULES[kind];
  const now = Date.now();
  const key = `${subject}:${kind}`;
  const map = rule.store === "public" ? publicStore : store;
  const arr = map.get(key) ?? [];

  const fresh = arr.filter((t) => now - t < rule.windowMs);

  if (fresh.length > 0) {
    const last = fresh[fresh.length - 1];
    if (now - last < rule.gapMs) {
      return { ok: false, retryAfterSec: Math.ceil((rule.gapMs - (now - last)) / 1000), reason: "gap" };
    }
  }

  if (fresh.length >= rule.maxInWindow) {
    const oldest = fresh[0];
    return { ok: false, retryAfterSec: Math.ceil((rule.windowMs - (now - oldest)) / 1000), reason: "window" };
  }

  fresh.push(now);
  if (map.has(key)) map.delete(key);
  evictIfFull(map, rule.store === "public" ? MAX_PUBLIC_KEYS : MAX_KEYS, now);
  map.set(key, fresh);
  return { ok: true };
}

export function _resetForTests(): void { store.clear(); publicStore.clear(); }
export function _storeSizesForTests(): { private: number; public: number } {
  return { private: store.size, public: publicStore.size };
}
