// Бот заявок @inrenta_bot (ADR 0028): обработчики входящих апдейтов вебхука.
//
// Обработчик меняет базу сразу, а исходящие вызовы Bot API складывает в
// BotOutbox: вебхук исполняет их в after(), уже ответив Telegram. Ошибка базы
// уходит наверх — вебхук ответит 500, Telegram повторит апдейт, и обработчики
// к повтору готовы: все переходы условные (server/leads.ts).
//
// Личка клиента:
// - /start <token> — ветвление по состоянию черновика (onStart);
// - кнопка «Отправить заявку» (send:<id>) и контакт — отправка draft → sent;
// - прочий текст — подсказка.
// Админская группа: только кнопки статусов карточки (st:<id>:<to>) и отметка
// о переходе в супергруппу. Команды и текст там игнорируются.

import { content } from "@theme/content";
import { getEnv } from "@/lib/env";
import { siteUrl } from "@/lib/site-config";
import { normalizePhone } from "@/lib/booking/validation";
import {
  displayName, startPayload, type BotUpdate, type TgCallback, type TgMessage, type TgUser,
} from "@/lib/telegram/update";
import {
  leadAcceptedText, leadCardText, leadReasonText, leadSummaryText, escapeHtml, linkReplyMarkup, listingUrl,
} from "@/lib/leads/card";
import {
  authorizeCallback, cardReplyMarkup, contactReplyMarkup, parseLeadCallback, removeKeyboardMarkup,
  sendReplyMarkup, type LeadCallback,
} from "@/lib/leads/status";
import { checkBookingSelection } from "@/server/booking-check";
import {
  DRAFT_TTL_MS, activeDraftOf, bindDraft, findDraftByToken, findLeadById, markLeadSent, releaseDraftsOf,
  setLeadStatus, type LeadRow,
} from "@/server/leads";

const b = content.bot;

export interface BotCall {
  method: string;
  params: Record<string, unknown>;
}

/** Что сделать после ответа Telegram: вызовы по порядку и карточки к доставке. */
export interface BotOutbox {
  calls: BotCall[];
  /** id лидов, чьи карточки уходят в группу. */
  cards: string[];
}

export const newOutbox = (): BotOutbox => ({ calls: [], cards: [] });

// Черновик пишет маяк со страницы, а /start приходит из Telegram — второй
// может обогнать первый. Бот ждёт черновик до ~2 с: три чтения с паузами.
let draftWaitsMs: readonly number[] = [900, 900];
let sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Только для тестов: паузы ожидания черновика. */
export function _setDraftWaitForTests(waits: readonly number[], fn?: (ms: number) => Promise<void>): void {
  draftWaitsMs = waits;
  if (fn) sleep = fn;
}

// ------------------------------------------------------------------ ответы

/** Кнопка-ссылка на сайт. Без https Telegram отклоняет URL-кнопку — в dev её нет. */
function siteButton(text: string, path: string | null = null) {
  const url = listingUrl(siteUrl(), path ?? "/");
  return url && url.startsWith("https://") ? linkReplyMarkup(text, url) : undefined;
}

function say(out: BotOutbox, chatId: number, html: string, replyMarkup?: unknown): void {
  out.calls.push({
    method: "sendMessage",
    params: {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    },
  });
}

function answer(out: BotOutbox, callbackId: string, text?: string, alert = false): void {
  out.calls.push({
    method: "answerCallbackQuery",
    params: { callback_query_id: callbackId, ...(text ? { text, show_alert: alert } : {}) },
  });
}

/** Выберите вещь на сайте. */
function sayNoDraft(out: BotOutbox, chatId: number): void {
  say(out, chatId, escapeHtml(b.noDraft), siteButton(b.openSite) ?? removeKeyboardMarkup());
}

function sayExpired(out: BotOutbox, chatId: number): void {
  say(out, chatId, escapeHtml(b.expired), siteButton(b.openSite) ?? removeKeyboardMarkup());
}

/** Почему черновик не отправить — и ссылка туда, где выбрать заново. */
function sayReason(out: BotOutbox, chatId: number, code: string, path: string | null): void {
  const toListing = path !== null && code !== "listing_not_found";
  const button = toListing ? siteButton(b.openListing, path) : siteButton(b.openSite);
  say(out, chatId, leadReasonText(code), button ?? removeKeyboardMarkup());
}

function sayAlreadySent(out: BotOutbox, chatId: number, lead: LeadRow): void {
  say(out, chatId, escapeHtml(b.alreadySent), removeKeyboardMarkup());
}

const isExpired = (lead: LeadRow, now: Date) => now.getTime() - lead.createdAt.getTime() > DRAFT_TTL_MS;

// ------------------------------------------------------------------- личка

async function waitDraft(token: string): Promise<LeadRow | null> {
  let lead = await findDraftByToken(token);
  for (const ms of draftWaitsMs) {
    if (lead) break;
    await sleep(ms);
    lead = await findDraftByToken(token);
  }
  return lead;
}

/**
 * Привязка черновика по токену из /start — по таблице состояний из плана (ADR
 * 0028). null — не привязан, ответ человеку уже в outbox.
 */
async function bindByToken(from: TgUser, chatId: number, token: string, out: BotOutbox, now: Date): Promise<LeadRow | null> {
  const lead = await waitDraft(token);
  // Чужой привязанный черновик и отправленная заявка проверяются раньше
  // возраста: «устарела» на отправленную заявку соврала бы, а чужому человеку
  // знать о ней незачем.
  if (!lead || (lead.status === "draft" && isExpired(lead, now))) {
    sayExpired(out, chatId);
    return null;
  }
  if (lead.invalidReason) {
    sayReason(out, chatId, lead.invalidReason, lead.listingPath);
    return null;
  }
  if (lead.tgUserId !== null && lead.tgUserId !== from.id) {
    say(out, chatId, escapeHtml(b.used), siteButton(b.openSite) ?? removeKeyboardMarkup());
    return null;
  }
  if (lead.status !== "draft") {
    sayAlreadySent(out, chatId, lead);
    return null;
  }

  const bound = await bindDraft(lead.id, { userId: from.id, username: from.username ?? null, name: displayName(from) }, now);
  if (!bound) {
    // Между чтением и привязкой черновик отправили или привязал другой.
    const fresh = await findLeadById(lead.id);
    if (fresh && fresh.status !== "draft" && fresh.tgUserId === from.id) sayAlreadySent(out, chatId, fresh);
    else say(out, chatId, escapeHtml(b.used), siteButton(b.openSite) ?? removeKeyboardMarkup());
  }
  return bound;
}

/** /start <token>: привязка черновика, сводка и кнопки отправки. */
async function onStart(from: TgUser, chatId: number, token: string, out: BotOutbox, now: Date): Promise<void> {
  if (token === "") return sayNoDraft(out, chatId);
  const bound = await bindByToken(from, chatId, token, out, now);
  if (!bound) {
    // Человек пришёл с новым выбором, а он не привязался. Прежний черновик
    // гасится: reply-клавиатура с номером от него остаётся под полем ввода
    // (ответ с кнопкой сайта её не снимает), и контакт с неё отправил бы
    // старые даты вместо тех, что человек выбрал последними.
    await releaseDraftsOf(from.id);
    return;
  }

  // С username номер по желанию: inline-кнопка под сводкой и reply-кнопка под
  // полем ввода — вторым сообщением, у сообщения клавиатура одна. Без
  // username — только номер: иначе с человеком не связаться.
  const hasUsername = !!from.username;
  if (hasUsername) {
    say(out, chatId, leadSummaryText(bound, siteUrl(), true), sendReplyMarkup(bound.id));
    say(out, chatId, escapeHtml(b.phoneKeyboard), contactReplyMarkup());
  } else {
    say(out, chatId, leadSummaryText(bound, siteUrl(), false), contactReplyMarkup());
  }
}

/** Телефон из контакта Telegram: цифры без «+» приводятся к +7…; чужой формат — как есть. */
function contactPhone(raw: string): string {
  const normalized = normalizePhone(raw);
  if (normalized) return normalized;
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `+${digits}`.slice(0, 20) : raw.slice(0, 20);
}

/**
 * Отправка черновика: повторная проверка выбора со снимком как «увиденным»,
 * условный переход draft → sent с кодом, ответ «принята», карточка в группу.
 */
async function submitDraft(
  lead: LeadRow,
  phone: string | null,
  chatId: number,
  out: BotOutbox,
  now: Date,
): Promise<boolean> {
  if (lead.status !== "draft") {
    sayAlreadySent(out, chatId, lead);
    return false;
  }
  if (isExpired(lead, now)) {
    sayExpired(out, chatId);
    return false;
  }
  const check = lead.listingId
    ? await checkBookingSelection({
      listingId: lead.listingId,
      from: lead.dateFrom,
      to: lead.dateTo,
      qty: lead.qty,
      priceDay: lead.priceDay,
      priceWeek: lead.priceWeek,
      priceMonth: lead.priceMonth,
    }, null)
    : ({ ok: false, error: "listing_not_found", snapshot: null } as const);
  if (!check.ok) {
    sayReason(out, chatId, check.error, check.snapshot?.path ?? lead.listingPath);
    return false;
  }
  const sent = await markLeadSent(lead.id, { customerPhone: phone, snapshot: check.snapshot, total: check.total }, now);
  if (!sent) {
    const fresh = await findLeadById(lead.id);
    if (fresh) sayAlreadySent(out, chatId, fresh);
    return false;
  }
  // В ответе названы модель и даты: ошибка, если она случилась, видна сразу.
  say(out, chatId, leadAcceptedText(sent), removeKeyboardMarkup());
  out.cards.push(sent.id);
  return true;
}

/** Контакт засчитывается только свой: чужой номер заявкой не становится. */
async function onContact(msg: TgMessage, from: TgUser, out: BotOutbox, now: Date): Promise<void> {
  const chatId = msg.chat.id;
  const contact = msg.contact!;
  if (contact.user_id !== from.id) return say(out, chatId, escapeHtml(b.foreignContact), contactReplyMarkup());
  const draft = await activeDraftOf(from.id, now);
  // Контакт без активного черновика пришёл с оставшейся клавиатуры — её
  // снимаем, иначе следующее нажатие кончится тем же.
  if (!draft) return say(out, chatId, escapeHtml(b.noDraft), removeKeyboardMarkup());
  await submitDraft(draft, contactPhone(contact.phone_number), chatId, out, now);
}

async function onText(from: TgUser, chatId: number, out: BotOutbox, now: Date): Promise<void> {
  const draft = await activeDraftOf(from.id, now);
  if (!draft) return sayNoDraft(out, chatId);
  // Текст вместо нажатия: подсказка и клавиатура с номером заново — reply-
  // клавиатура могла свернуться.
  say(out, chatId, escapeHtml(b.useButtons), contactReplyMarkup());
}

async function onPrivateMessage(msg: TgMessage, out: BotOutbox, now: Date): Promise<void> {
  const from = msg.from;
  if (!from || from.is_bot) return;
  const chatId = msg.chat.id;
  if (msg.contact) return onContact(msg, from, out, now);
  const payload = startPayload(msg.text);
  if (payload !== null) return onStart(from, chatId, payload, out, now);
  if (msg.text !== null) return onText(from, chatId, out, now);
}

// ------------------------------------------------------------------ кнопки

/** «Отправить заявку» под сводкой — только из лички того, к кому привязан черновик. */
async function onSend(cb: TgCallback, data: Extract<LeadCallback, { kind: "send" }>, out: BotOutbox, now: Date): Promise<void> {
  const msg = cb.message!;
  const lead = await findLeadById(data.leadId);
  const origin = { chatId: msg.chat.id, chatType: msg.chat.type, messageId: msg.messageId, fromId: cb.from.id };
  if (!lead || !authorizeCallback(data, origin, lead, adminChatId())) return answer(out, cb.id, b.callback.forbidden);
  // Без username номер обязателен: username мог пропасть после /start.
  if (lead.status === "draft" && !cb.from.username) return answer(out, cb.id, b.promptPhoneRequired, true);
  answer(out, cb.id);
  const sent = await submitDraft(lead, null, msg.chat.id, out, now);
  if (sent || lead.status !== "draft") {
    // Кнопка под сводкой больше не нужна.
    out.calls.push({
      method: "editMessageReplyMarkup",
      params: { chat_id: msg.chat.id, message_id: msg.messageId, reply_markup: { inline_keyboard: [] } },
    });
  }
}

/** Правка карточки под текущее состояние лида: текст статуса и следующие кнопки. */
function editCard(out: BotOutbox, chatId: number, messageId: number, lead: LeadRow): void {
  // «message is not modified» callBot считает успехом — повтор правки безвреден.
  out.calls.push({
    method: "editMessageText",
    params: {
      chat_id: chatId,
      message_id: messageId,
      text: leadCardText(lead, siteUrl()),
      parse_mode: "HTML",
      reply_markup: cardReplyMarkup(lead.id, lead.status),
      link_preview_options: { is_disabled: true },
    },
  });
}

/** Код заявки отдельным словом в тексте сообщения: INR-4821 не находится в INR-48210. */
function mentionsCode(text: string | null, code: string | null): boolean {
  if (!text || !code) return false;
  const at = text.indexOf(code);
  return at !== -1 && !/\d/.test(text.charAt(at + code.length));
}

/** Кнопка статуса карточки — только в админском чате и только на карточке этого лида. */
async function onStatus(cb: TgCallback, data: Extract<LeadCallback, { kind: "status" }>, out: BotOutbox, now: Date): Promise<void> {
  const msg = cb.message!;
  const lead = await findLeadById(data.leadId);
  const origin = { chatId: msg.chat.id, chatType: msg.chat.type, messageId: msg.messageId, fromId: cb.from.id };
  if (!lead) return answer(out, cb.id, b.callback.forbidden);
  if (!authorizeCallback(data, origin, lead, adminChatId())) {
    // Вторая карточка той же заявки: Telegram принял первую отправку, а ответ
    // не дошёл (таймаут, обрыв), и повтор прислал ещё одну. Кнопки живые
    // только у той, чей id записан; у этой их снимаем. Что это карточка
    // именно этого лида, видно по коду в тексте сообщения — данные кнопки
    // участник группы может подделать, текст сообщения бота нет.
    if (msg.chat.id === adminChatId() && mentionsCode(msg.text, lead.code)) {
      answer(out, cb.id, b.callback.staleCard, true);
      out.calls.push({
        method: "editMessageReplyMarkup",
        params: { chat_id: msg.chat.id, message_id: msg.messageId, reply_markup: { inline_keyboard: [] } },
      });
      return;
    }
    return answer(out, cb.id, b.callback.forbidden);
  }
  const by = displayName(cb.from) || (cb.from.username ? `@${cb.from.username}` : String(cb.from.id));
  const updated = await setLeadStatus(lead.id, data.to, msg.messageId, by, now);
  if (!updated) {
    answer(out, cb.id, b.callback.alreadyChanged);
    // Статус уже сменили — может быть, этим же нажатием, чья правка карточки
    // не прошла (429, сеть). Карточка перерисовывается по строке, иначе она
    // так и осталась бы со старым статусом и кнопками.
    const fresh = await findLeadById(lead.id);
    if (fresh && fresh.groupMessageId === msg.messageId) editCard(out, msg.chat.id, msg.messageId, fresh);
    return;
  }
  editCard(out, msg.chat.id, msg.messageId, updated);
  answer(out, cb.id, b.callback.done);
}

async function onCallback(cb: TgCallback, out: BotOutbox, now: Date): Promise<void> {
  const data = parseLeadCallback(cb.data);
  // Нажатие без сообщения или с чужими данными — только снять часики.
  if (!data || !cb.message) return answer(out, cb.id, data ? b.callback.forbidden : undefined);
  if (data.kind === "send") return onSend(cb, data, out, now);
  return onStatus(cb, data, out, now);
}

// ------------------------------------------------------------------- вход

function adminChatId(): number {
  const id = getEnv().TELEGRAM_ADMIN_CHAT_ID;
  // Вебхук без бота не работает (404), так что сюда без id не дойти.
  if (id === undefined) throw new Error("TELEGRAM_ADMIN_CHAT_ID is not set");
  return id;
}

/** Откуда апдейт: чат и автор. null — апдейт без чата или автора. */
export function updateOrigin(u: BotUpdate): { chatId: number; chatType: string; userId: number | null } | null {
  if (u.kind === "message") {
    return { chatId: u.message.chat.id, chatType: u.message.chat.type, userId: u.message.from?.id ?? null };
  }
  if (u.kind === "callback") {
    const msg = u.callback.message;
    return msg ? { chatId: msg.chat.id, chatType: msg.chat.type, userId: u.callback.from.id } : null;
  }
  return null;
}

/**
 * Обработка апдейта, уже прошедшего фильтр вебхука (личка или админский чат).
 * Ошибки базы — наверх.
 */
export async function handleUpdate(u: BotUpdate, out: BotOutbox, now: Date = new Date()): Promise<void> {
  if (u.kind === "callback") return onCallback(u.callback, out, now);
  if (u.kind !== "message") return;
  const msg = u.message;
  if (msg.chat.type === "private") return onPrivateMessage(msg, out, now);
  if (msg.chat.id === adminChatId() && msg.migrateToChatId !== null) {
    // Группа стала супергруппой — у неё новый id, карточки в старый чат не
    // дойдут. Меняется руками в env (docs/DEPLOY.md).
    console.error("[telegram] chat migrated", msg.migrateToChatId);
  }
}
