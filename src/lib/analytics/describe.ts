// Лента гостя человеческими фразами: «Искал «каяк» — ничего: такого нет в
// каталоге», «Открыл объявление «Перфоратор Makita»». Чистые функции над уже
// прочитанным: события, справочник городов и разделов, названия объявлений.
// Слова — theme/content.ts (adminAnalytics), здесь — только сборка.
//
// Всё, что пришло от браузера, — уже очищенное (sanitize.ts) и выводится
// текстом, не ссылкой и не разметкой: хост referrer'а, метка кампании, путь.
// Название объявления берётся из базы, а не из адреса.

import { content } from "@theme/content";
import { APP_TIME_ZONE, formatDayMonthShort, shortRangeLabel, todayStr } from "@/lib/catalog/dates";
import { extractListingId } from "@/lib/catalog/listing-path";
import { ruPlural } from "@/lib/plural";
import type { Source } from "./source";
import type { AccountAction, TimelineEvent, VisitEntry } from "./visits";

const t = content.adminAnalytics;

/** Справочник для расшифровки путей: город и раздел по слагу, объявление по id. */
export interface Directory {
  cities: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, string>;
  listings: ReadonlyMap<string, string>;
}

export const EMPTY_DIRECTORY: Directory = { cities: new Map(), categories: new Map(), listings: new Map() };

const NBSP = " ";

/** «12 поисков». */
export function countLabel(n: number, forms: readonly [string, string, string]): string {
  return `${n}${NBSP}${ruPlural(n, ...forms)}`;
}

let timeFormat: Intl.DateTimeFormat | undefined;

/** «14:05» по Москве. */
export function clockLabel(at: Date): string {
  timeFormat ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return timeFormat.format(at);
}

/** «12 окт, 14:05» по Москве; другой год — с годом: «12 окт 2025, 14:05». */
export function momentLabel(at: Date, now: Date = new Date()): string {
  const day = todayStr(at);
  const year = day.slice(0, 4) === todayStr(now).slice(0, 4) ? "" : ` ${day.slice(0, 4)}`;
  return `${formatDayMonthShort(day)}${year}, ${clockLabel(at)}`;
}

/** «Гость 7F3K» — короткий код из id браузера: различать гостей глазами. */
export function guestCode(visitorId: string): string {
  return visitorId.replace(/-/g, "").slice(0, 4).toUpperCase();
}

export function visitorLabel(v: { id: string; userName?: string | null; userEmail?: string | null }): string {
  return v.userName || v.userEmail || t.visitor.guest(guestCode(v.id));
}

export function describeDevice(device: string | null | undefined): string {
  return (device && t.devices[device]) || t.devices.unknown;
}

/** Откуда пришёл: «из поиска Яндекса», «из Telegram», «с сайта example.ru». */
export function describeSource(source: Source | null | undefined): string {
  const s = t.sources;
  if (!source) return s.unknown;
  const { kind, label } = source;
  switch (kind) {
    case "direct": return s.direct;
    case "internal": return s.internal;
    case "search": return s.fromSearch(s.search[label] ?? label);
    case "social": return s.fromSocial(s.social[label] ?? label);
    case "ad": return label ? s.fromAd(s.ad[label] ?? s.search[label] ?? s.social[label] ?? label) : s.fromAdAny;
    case "campaign": return s.fromCampaign(label);
    case "referral": return s.fromSite(label);
    case "account": return s.account[label] ?? s.account.login;
  }
}

/** Начало визита: «из поиска Яндекса · кампания «осень»» или «продолжение». */
export function describeEntry(entry: VisitEntry): string {
  if (entry.kind === "continued") return t.sources.continued;
  const source = describeSource(entry.source);
  return entry.campaign ? `${source} · ${t.sources.campaign(entry.campaign)}` : source;
}

/** Заголовок визита: «12 окт, 14:05 · из поиска Яндекса · телефон». */
export function describeVisit(start: Date, entry: VisitEntry, device: string | null, now?: Date): string {
  return [momentLabel(start, now), describeEntry(entry), describeDevice(device)].join(" · ");
}

export function describeReason(reason: string): string {
  return t.reasons[reason] ?? reason;
}

const SECTION_PAGES: Record<string, string> = {
  search: t.pages.search,
  chat: t.pages.chat,
  cabinet: t.pages.cabinet,
  profile: t.pages.profile,
  login: t.pages.login,
  reset: t.pages.reset,
  privacy: t.pages.privacy,
  sources: t.pages.sources,
  banned: t.pages.banned,
};

/**
 * Страница по очищенному пути — винительным падежом, после «Открыл». Город,
 * раздел и объявление расшифровываются по справочнику; незнакомый путь
 * показывается как есть.
 */
export function describePage(path: string | null, dir: Directory): string {
  const p = t.pages;
  if (!path) return p.raw("?");
  const pathname = path.split("?", 1)[0];
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return p.home;
  const [first] = segments;
  if (segments.length === 1 && SECTION_PAGES[first]) return SECTION_PAGES[first];
  if (first === "u" && segments.length === 2) return p.seller;
  const city = dir.cities.get(first);
  if (city && segments.length <= 3) {
    if (segments.length === 1) return p.city(city);
    const last = segments[segments.length - 1];
    if (segments.length === 3) {
      const listing = extractListingId(last);
      if (listing) {
        const title = dir.listings.get(listing.id.toUpperCase());
        return title ? p.listing(title) : p.listingGone;
      }
    }
    const category = dir.categories.get(last);
    if (category) return p.category(category, city);
  }
  return p.raw(pathname);
}

const prop = <T>(props: Record<string, unknown>, key: string, check: (v: unknown) => v is T): T | null =>
  check(props[key]) ? (props[key] as T) : null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number";

/** «Искал «перфоратор» — нашлось 12 · с датами». */
export function describeSearch(ev: TimelineEvent, dir: Directory): string {
  const e = t.events;
  const reason = prop(ev.props, "reason", isString);
  const usedQuery = prop(ev.props, "usedQuery", isString);
  const categorySlug = prop(ev.props, "category", isString);
  const category = categorySlug ? dir.categories.get(categorySlug) ?? categorySlug : null;
  const page = prop(ev.props, "page", isNumber) ?? 1;
  const total = String(ev.total ?? 0);

  const what = ev.q
    ? category ? e.searchedIn(ev.q, category) : e.searched(ev.q)
    : category ? e.browsedCategory(category) : e.browsedAll;
  const result = reason
    ? e.nothing(describeReason(reason))
    : ev.props.partial === true && usedQuery ? e.foundPartial(total, usedQuery) : e.found(total);
  const extras: string[] = [];
  if (ev.props.dates === true) extras.push(e.withDates);
  if (ev.props.where === true) extras.push(e.withWhere);
  if (ev.props.filters === true) extras.push(e.withFilters);
  if (page > 1) extras.push(e.page(String(page)));
  return `${what} — ${result}${extras.length > 0 ? ` · ${extras.join(", ")}` : ""}`;
}

export interface DescribeContext {
  /**
   * Этот вход — регистрация аккаунта: способ входа словами («Яндекс ID»), ""
   * если неизвестен. undefined — обычный вход.
   */
  signup?: string;
  /** Объявление предыдущего события: «Забронировать» на нём не повторяет название. */
  previousListingId?: string | null;
}

/** Фраза одного события ленты. */
export function describeEvent(ev: TimelineEvent, dir: Directory, ctx: DescribeContext = {}): string {
  const e = t.events;
  switch (ev.type) {
    case "pageview":
      return e.opened(describePage(ev.path, dir));
    case "search":
      return describeSearch(ev, dir);
    case "view_listing": {
      const base = ev.listingTitle ? e.viewed(ev.listingTitle) : e.viewedGone;
      const extras: string[] = [];
      if (ev.props.dates === true) extras.push(e.withDates);
      if (ev.props.where === true) extras.push(e.withWhere);
      return extras.length > 0 ? `${base} · ${extras.join(", ")}` : base;
    }
    case "booking_click": {
      const sameListing = ev.listingId !== null && ev.listingId === ctx.previousListingId;
      const base = ev.listingTitle && !sameListing ? e.bookingClickOn(ev.listingTitle) : e.bookingClick;
      return ev.props.authed === false ? `${base}, ${e.notAuthed}` : base;
    }
    case "login":
      if (ev.userId === null) return e.guestLogin;
      if (ctx.signup !== undefined) return e.signup(ctx.signup);
      return ev.props.via === "create" ? e.alreadyIn : e.login;
    case "ym_client": {
      const cid = prop(ev.props, "cid", isString);
      return cid ? e.clientId(cid) : e.other(ev.type);
    }
    default:
      return e.other(ev.type);
  }
}

/** Шаг сделки: «Отправил заявку на «Палатка» · 10–12 окт». */
export function describeAction(action: AccountAction): string {
  const e = t.events;
  const title = action.listingTitle ?? e.untitled;
  switch (action.kind) {
    case "request":
      return e.request(title, action.dateFrom && action.dateTo ? shortRangeLabel(action.dateFrom, action.dateTo) : "");
    case "chat":
      return e.chat(title);
    case "listing":
      return e.listing(title);
  }
}

/** Способы входа аккаунта словами: «Яндекс ID, почта и пароль». */
export function describeSignIn(providers: readonly string[], hasPassword: boolean): string {
  const methods = t.visitor.signInMethods;
  const names = providers.map((p) => methods[p] ?? p);
  if (hasPassword) names.push(methods.password);
  return names.join(", ");
}
