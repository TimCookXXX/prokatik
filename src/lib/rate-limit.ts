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
  | "search" | "geo"
  | "track" | "track_vid" | "track_new"
  | "lead_draft" | "lead_draft_ip" | "lead_form" | "lead_form_ip" | "lead_phone" | "lead_form_daily"
  | "tg_user";

// Потолок отправки на весь сервис за сутки. Яндекс даёт 300 писем в сутки по
// SMTP и режет раньше, если письма однотипные, — упереться хочется в свой
// счётчик, а не в блокировку ящика, из которой сервис сам не выберется.
export const MAIL_DAILY_CAP = 250;
// Общий ключ: лимит один на всех, отправитель значения не имеет.
export const MAIL_DAILY_KEY = "service";
// Потолок заявок запасной формы на весь сервис за сутки, по образцу
// MAIL_DAILY_CAP. Сверх него заявка сохраняется, но в группу не идёт: поток
// от скрипта не должен заваливать чат, где основатель работает руками.
export const LEAD_FORM_DAILY_CAP = 100;
export const LEAD_FORM_DAILY_KEY = "service";
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
  // Роут сбора своей статистики (/api/analytics). Пачка событий уходит на
  // каждой странице и при уходе с неё, поэтому по IP потолок как у подсказок:
  // за одним адресом бывает целая сеть мобильного оператора.
  track: { windowMs: 60 * 1000, maxInWindow: 300, gapMs: 0, store: "public" },
  // Тот же поток по id браузера: человеку столько страниц в минуту не открыть,
  // а скрипт с одной кукой иначе писал бы во всю ширину лимита по IP.
  track_vid: { windowMs: 60 * 1000, maxInWindow: 60, gapMs: 0, store: "public" },
  // Заведение нового гостя — строка в visitors. Кука id ничего не стоит, и
  // без этого контура скрипт заводил бы гостя на каждый запрос.
  track_new: { windowMs: 60 * 60 * 1000, maxInWindow: 20, gapMs: 0, store: "public" },
  // Черновик заявки в Telegram (/api/leads/draft): маяк на каждый клик по
  // ссылке на бота. Человек перебирает даты и жмёт снова — тридцать в час
  // хватает с запасом, скрипту с одной кукой этого мало.
  lead_draft: { windowMs: 60 * 60 * 1000, maxInWindow: 30, gapMs: 0, store: "public" },
  // Тот же поток по IP. За одним адресом мобильного оператора сидит много
  // людей, поэтому потолок высокий: он против скрипта, меняющего куку.
  lead_draft_ip: { windowMs: 60 * 60 * 1000, maxInWindow: 200, gapMs: 0, store: "public" },
  // Запасная форма «Имя + телефон»: каждая заявка — карточка в группе и
  // ручная работа основателя. Пауза ловит двойное нажатие и долбёжку.
  lead_form: { windowMs: 60 * 60 * 1000, maxInWindow: 5, gapMs: 10_000, store: "public" },
  lead_form_ip: { windowMs: 60 * 60 * 1000, maxInWindow: 30, gapMs: 0, store: "public" },
  // По номеру: смена куки и IP не даёт засыпать заявками один чужой телефон.
  lead_phone: { windowMs: 24 * 60 * 60 * 1000, maxInWindow: 3, gapMs: 0, store: "public" },
  // Общий ключ LEAD_FORM_DAILY_KEY — потолок на весь сервис. Лежит в общем
  // хранилище, как mail_daily: в публичном его вытеснил бы поток ключей
  // lead_phone с разными номерами, и потолок молча обнулился бы.
  lead_form_daily: { windowMs: 24 * 60 * 60 * 1000, maxInWindow: LEAD_FORM_DAILY_CAP, gapMs: 0 },
  // Входящие апдейты бота по Telegram id. Отказ — молчаливый 200: на 429
  // Telegram стал бы повторять доставку.
  tg_user: { windowMs: 60 * 1000, maxInWindow: 30, gapMs: 0, store: "public" },
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

// Хранилища. В общем — вход, почта, заявки, чат: ключей немного, и
// вытеснение самого давнего при заполнении их не трогает. Публичные ручки
// заводят ключ на каждый анонимный IP; в общем хранилище такой поток вытеснял
// бы ключи `login`, `reset`, `mail_daily`, `lead_form_daily` и молча обнулял их. Поэтому у них
// свои хранилища, побольше, с чисткой просроченных ключей при заполнении, —
// по одному на длину окна (см. sweepExpired).
const MAX_KEYS = 10_000;
const MAX_PUBLIC_KEYS = 20_000;
const store = new Map<string, number[]>();
const publicStores = new Map<number, Map<string, number[]>>();

function publicStoreFor(windowMs: number): Map<string, number[]> {
  let map = publicStores.get(windowMs);
  if (!map) {
    map = new Map();
    publicStores.set(windowMs, map);
  }
  return map;
}

// Ключ при каждом успешном обращении переставляется в конец, так что порядок
// Map — порядок последней отметки. Просроченные поэтому лежат в начале подряд:
// чистка идёт с начала и останавливается на первом живом. Это верно, только
// пока окна в хранилище одинаковые, — поэтому публичные виды разложены по
// хранилищам по длине окна. Общий Map с часовым track_new и минутными search
// и geo останавливал бы чистку на живом часовом ключе, и вытеснение снимало бы
// именно его — лимит заведения гостей обнулялся бы под нагрузкой.
function sweepExpired(map: Map<string, number[]>, windowMs: number, now: number): void {
  for (const [key, stamps] of map) {
    const last = stamps[stamps.length - 1];
    if (last !== undefined && now - last < windowMs) return;
    map.delete(key);
  }
}

function evictIfFull(map: Map<string, number[]>, max: number, now: number, sweepWindowMs?: number): void {
  if (map.size < max) return;
  if (sweepWindowMs !== undefined) {
    sweepExpired(map, sweepWindowMs, now);
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
  const isPublic = rule.store === "public";
  const map = isPublic ? publicStoreFor(rule.windowMs) : store;
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
  if (isPublic) evictIfFull(map, MAX_PUBLIC_KEYS, now, rule.windowMs);
  else evictIfFull(map, MAX_KEYS, now);
  map.set(key, fresh);
  return { ok: true };
}

export function _resetForTests(): void { store.clear(); publicStores.clear(); }
export function _storeSizesForTests(): { private: number; public: number } {
  let pub = 0;
  for (const map of publicStores.values()) pub += map.size;
  return { private: store.size, public: pub };
}
