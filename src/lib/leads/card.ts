// Тексты бота заявок и карточки в админской группе — чистые функции без БД.
// Разметка — HTML parse_mode Telegram: каждое значение, пришедшее извне
// (название вещи, имена, ник, метки кампании), экранируется. Все функции
// возвращают готовый HTML.
//
// Карточка собирается из снимка в строке booking_leads целиком, без join:
// её перерисовывает каждое нажатие кнопки статуса, и ссылка на объявление
// переживает его удаление. Формат согласован с владельцем продукта:
//
//   <b>INR-4821</b> · новая
//   🚲 <a href="…">Kugoo Kirin V3 Pro</a>
//   🏪 ПикаВел · +7 928 221-87-54
//   📅 28.10 – 03.11 (7 дней)
//   💰 ≈ 2 250 ₽ · без залога
//   👤 Иван · @ivan_courier · +7 900 000-00-00
//   📨 через Telegram
//   📈 Директ · velo · «ключевая фраза»
//   ✅ Передал прокату — Тимур, 27.10 14:05

import { content } from "@theme/content";
import { APP_TIME_ZONE, formatDayMonthNum, rangeDaysCount } from "@/lib/catalog/dates";
import { formatDeposit, formatPrice, type DepositType } from "@/lib/catalog/format";
import { daysLabel, formatUnitPrice, primaryPrice, quote } from "@/lib/catalog/tariff";
import type { LeadChannel, LeadStatus } from "./status";
import { leadReply } from "./reply";

const b = content.bot;
const SEP = " · ";

/** Поля строки booking_leads, из которых собираются тексты. */
export interface LeadText {
  code: string | null;
  status: LeadStatus;
  channel: LeadChannel;
  internal: boolean;
  listingTitle: string | null;
  /** Путь без хоста; null — объявление не нашлось при создании черновика. */
  listingPath: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  dateFrom: string;
  dateTo: string;
  qty: number;
  priceDay: number | null;
  priceWeek: number | null;
  priceMonth: number | null;
  depositType: DepositType;
  depositAmount: number | null;
  total: number | null;
  customerName: string | null;
  customerPhone: string | null;
  tgUsername: string | null;
  tgName: string | null;
  utm: Record<string, string> | null;
  statusChangedAt: Date | null;
  statusChangedBy: string | null;
}

/** Экранирование для HTML parse_mode: Telegram понимает ровно эти сущности. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** «+7 928 221-87-54» из нормализованного +7XXXXXXXXXX; другие номера — как есть. */
export function formatPhone(phone: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}

/** Абсолютная ссылка на объявление; null — пути нет. */
export function listingUrl(siteUrl: string, path: string | null): string | null {
  return path ? `${siteUrl.replace(/\/+$/, "")}${path}` : null;
}

/** «28.10 – 03.11», один день — «28.10». */
export function leadRange(from: string, to: string): string {
  return from === to ? formatDayMonthNum(from) : `${formatDayMonthNum(from)} – ${formatDayMonthNum(to)}`;
}

/** «28.10 – 03.11 (7 дней)», при количестве больше одного — « · 2 шт.». */
export function leadDates(lead: Pick<LeadText, "dateFrom" | "dateTo" | "qty">): string {
  const days = daysLabel(rangeDaysCount(lead.dateFrom, lead.dateTo));
  const qty = lead.qty > 1 ? `${SEP}${b.card.qty(lead.qty)}` : "";
  return `${leadRange(lead.dateFrom, lead.dateTo)} (${days})${qty}`;
}

/** «≈ 2 250 ₽ · без залога». Суммы нет в снимке — считается по тарифам снимка. */
export function leadPrice(lead: LeadText): string {
  let total = lead.total;
  if (total === null) {
    const q = quote(lead, rangeDaysCount(lead.dateFrom, lead.dateTo), lead.qty);
    total = q.ok ? q.total : null;
  }
  const primary = primaryPrice(lead);
  const price = total !== null ? `≈ ${formatPrice(total)}` : primary ? formatUnitPrice(primary) : b.card.noPrice;
  return `${price}${SEP}${formatDeposit(lead.depositType, lead.depositAmount)}`;
}

let markFormat: Intl.DateTimeFormat | undefined;

/** «27.10 14:05» в деловой зоне сервиса. */
export function formatMarkTime(date: Date): string {
  markFormat ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    calendar: "gregory",
    numberingSystem: "latn",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = markFormat.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")} ${part("hour")}:${part("minute")}`;
}

/** Ссылка на вещь: `<a>` при известном пути, иначе только название. */
function titleHtml(lead: LeadText, siteUrl: string): string {
  const title = escapeHtml(lead.listingTitle ?? "—");
  const url = listingUrl(siteUrl, lead.listingPath);
  return url ? `<a href="${escapeHtml(url)}">${title}</a>` : title;
}

/** Клиент: имя, @ник, телефон — что есть. */
function clientLine(lead: LeadText): string {
  const parts = [
    lead.customerName ?? lead.tgName,
    lead.tgUsername ? `@${lead.tgUsername}` : null,
    lead.customerPhone ? formatPhone(lead.customerPhone) : null,
  ].filter((p): p is string => !!p && p.trim() !== "");
  return parts.length > 0 ? parts.map(escapeHtml).join(SEP) : "—";
}

// utm_source Директа: так их ставит шаблон ссылок кампании.
const DIRECT_SOURCES = /^(yandex|direct|ya|yandex[-_.]?direct)$/i;

/** «Директ · velo · «ключевая фраза»»; null — меток нет. */
export function utmLine(utm: Record<string, string> | null): string | null {
  if (!utm) return null;
  const source = utm.utm_source;
  const parts = [
    source ? (DIRECT_SOURCES.test(source) ? b.card.direct : source) : null,
    utm.utm_campaign ?? null,
    utm.utm_term ? `«${utm.utm_term}»` : null,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.map(escapeHtml).join(SEP) : null;
}

/** Строка отметки: «✅ Передал прокату — Тимур, 27.10 14:05». */
export function markLine(lead: Pick<LeadText, "status" | "statusChangedAt" | "statusChangedBy">): string | null {
  if (lead.status !== "handed" && lead.status !== "taken" && lead.status !== "declined") return null;
  const who = [lead.statusChangedBy, lead.statusChangedAt ? formatMarkTime(lead.statusChangedAt) : null]
    .filter((p): p is string => !!p);
  const tail = who.length > 0 ? ` — ${escapeHtml(who.join(", "))}` : "";
  return `${b.mark[lead.status]}${tail}`;
}

/** Карточка заявки в админской группе. */
export function leadCardText(lead: LeadText, siteUrl: string): string {
  const head = [`<b>${escapeHtml(lead.code ?? "—")}</b>`, b.status[lead.status]];
  if (lead.internal) head.push(b.card.internal);
  const shop = [lead.ownerName, lead.ownerPhone ? formatPhone(lead.ownerPhone) : null]
    .filter((p): p is string => !!p && p.trim() !== "");
  const utm = utmLine(lead.utm);
  const mark = markLine(lead);
  const lines = [
    head.join(SEP),
    `${b.card.item} ${titleHtml(lead, siteUrl)}`,
    shop.length > 0 ? `${b.card.shop} ${shop.map(escapeHtml).join(SEP)}` : null,
    `${b.card.dates} ${escapeHtml(leadDates(lead))}`,
    `${b.card.price} ${escapeHtml(leadPrice(lead))}`,
    `${b.card.client} ${clientLine(lead)}`,
    `${b.card.channel} ${lead.channel === "telegram" ? b.card.channelTelegram : b.card.channelForm}`,
    utm ? `${b.card.source} ${utm}` : null,
    mark,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/**
 * Сводка черновика в личке перед отправкой: вещь, прокат, даты, сумма, залог.
 * Телефона проката здесь нет — заявку прокату передаёт основатель.
 * `hasUsername` выбирает подсказку: без username номер обязателен.
 */
export function leadSummaryText(lead: LeadText, siteUrl: string, hasUsername: boolean): string {
  const lines = [
    b.summaryTitle,
    "",
    `<b>${titleHtml(lead, siteUrl)}</b>`,
    lead.ownerName ? escapeHtml(b.summaryShop(lead.ownerName)) : null,
    `${b.card.dates} ${escapeHtml(leadDates(lead))}`,
    `${b.card.price} ${escapeHtml(leadPrice(lead))}`,
    "",
    b.summaryHold,
    "",
    hasUsername ? b.promptWithUsername : b.promptPhoneRequired,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/**
 * «✅ Заявка принята», модель и даты — ошибка видна сразу, — и обещание по
 * времени суток. Кода нет: прокату его называет основатель, не клиент.
 */
export function leadAcceptedText(
  lead: Pick<LeadText, "listingTitle" | "dateFrom" | "dateTo">,
  now: Date = new Date(),
): string {
  return [
    `<b>${escapeHtml(b.acceptedTitle)}</b>`,
    escapeHtml(`${lead.listingTitle ?? "—"}${SEP}${leadRange(lead.dateFrom, lead.dateTo)}`),
    "",
    escapeHtml(leadReply(now)),
  ].join("\n");
}

/**
 * Почему черновик не отправить — по коду checkBookingSelection (те же коды,
 * что у createBookingRequest). Незнакомый код — общий текст: сырой код
 * человеку не показывается.
 */
export function leadReasonText(code: string): string {
  const r = b.reasons;
  if (code.startsWith("min_days:")) {
    const n = Number(code.split(":")[1]);
    return escapeHtml(Number.isInteger(n) && n > 1 ? r.minDays(daysLabel(n)) : r.generic);
  }
  if (code.startsWith("dates_taken")) return r.datesTaken;
  if (code.startsWith("rate_limited")) return r.rateLimited;
  const known: Record<string, string> = {
    listing_not_found: r.listingNotFound,
    own_listing: r.ownListing,
    banned: r.banned,
    dates_stale: r.datesStale,
    qty_stale: r.qtyStale,
    price_stale: r.priceStale,
  };
  return escapeHtml(known[code] ?? r.generic);
}

/** Inline-кнопка-ссылка: на объявление или на сайт. */
export function linkReplyMarkup(text: string, url: string) {
  return { inline_keyboard: [[{ text, url }]] };
}
