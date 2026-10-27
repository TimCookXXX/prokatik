// Статусы заявки без аккаунта и кнопки бота (ADR 0028).
//
// draft → sent — отправка клиентом (бот или форма), не кнопкой карточки.
// Дальше отмечает основатель кнопками в группе: «Передал прокату», затем
// «Взял» или «Отказ». taken и declined конечные, отмены нажатия нет.
//
// callback_data двух видов, и область у каждого своя:
// - `st:<id>:<to>` — смена статуса, только из админского чата и только с
//   карточки этого лида (message_id сверяется: участник группы может прислать
//   произвольный callback_data через MTProto);
// - `send:<id>` — отправка черновика, только из лички его владельца.
// Проверка — authorizeCallback; сервер вызывает её с прочитанным лидом.

import { content } from "@theme/content";

export const LEAD_STATUSES = ["draft", "sent", "handed", "taken", "declined"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_CHANNELS = ["telegram", "form"] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

/** Статусы, в которые переводят кнопки карточки. */
export type LeadMarkStatus = "handed" | "taken" | "declined";
const MARK_STATUSES: readonly LeadMarkStatus[] = ["handed", "taken", "declined"];

const TRANSITIONS: Record<LeadStatus, readonly LeadMarkStatus[]> = {
  draft: [],
  sent: ["handed", "declined"],
  handed: ["taken", "declined"],
  taken: [],
  declined: [],
};

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return (TRANSITIONS[from] as readonly LeadStatus[]).includes(to);
}

/** Из каких статусов можно прийти в `to` — для условного UPDATE … WHERE status IN (…). */
export function leadSourcesOf(to: LeadMarkStatus): LeadStatus[] {
  return LEAD_STATUSES.filter((s) => canTransitionLead(s, to));
}

export function isFinalLead(status: LeadStatus): boolean {
  return status === "taken" || status === "declined";
}

/** Отправлена ли заявка: всё, кроме черновика. */
export function isSentLead(status: LeadStatus): boolean {
  return status !== "draft";
}

// ---------------------------------------------------------------- callback_data

// id лида — ULID (newId): 26 символов Crockford base32.
const LEAD_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type LeadCallback =
  | { kind: "status"; leadId: string; to: LeadMarkStatus }
  | { kind: "send"; leadId: string };

export function statusCallbackData(leadId: string, to: LeadMarkStatus): string {
  return `st:${leadId}:${to}`;
}

export function sendCallbackData(leadId: string): string {
  return `send:${leadId}`;
}

/** Разбор callback_data; null — чужой формат, неизвестный статус или id. */
export function parseLeadCallback(data: string | null): LeadCallback | null {
  if (!data) return null;
  const parts = data.split(":");
  if (parts[0] === "st" && parts.length === 3) {
    const [, leadId, to] = parts;
    if (!LEAD_ID_RE.test(leadId) || !(MARK_STATUSES as readonly string[]).includes(to)) return null;
    return { kind: "status", leadId, to: to as LeadMarkStatus };
  }
  if (parts[0] === "send" && parts.length === 2) {
    const leadId = parts[1];
    return LEAD_ID_RE.test(leadId) ? { kind: "send", leadId } : null;
  }
  return null;
}

export interface CallbackOrigin {
  chatId: number;
  chatType: string;
  messageId: number;
  fromId: number;
}

export interface CallbackLead {
  tgUserId: number | null;
  groupMessageId: number | null;
}

/**
 * Можно ли выполнить нажатие. `st:` — только в админском чате и только на
 * карточке этого лида; `send:` — только в личке того, к кому черновик привязан.
 * Нажатие без сообщения (Telegram его не прислал) не проходит никогда.
 */
export function authorizeCallback(
  cb: LeadCallback,
  origin: CallbackOrigin | null,
  lead: CallbackLead,
  adminChatId: number,
): boolean {
  if (!origin) return false;
  if (cb.kind === "status") {
    return origin.chatId === adminChatId
      && lead.groupMessageId !== null
      && origin.messageId === lead.groupMessageId;
  }
  return origin.chatType === "private"
    && lead.tgUserId !== null
    && origin.fromId === lead.tgUserId
    && origin.chatId === lead.tgUserId;
}

// ------------------------------------------------------------------- клавиатуры

export interface InlineButton {
  text: string;
  callback_data: string;
}

/** Кнопки карточки в группе на текущий статус; у конечных — пусто. */
export function cardButtons(leadId: string, status: LeadStatus): InlineButton[][] {
  const targets = TRANSITIONS[status];
  if (targets.length === 0) return [];
  return [targets.map((to) => ({ text: content.bot.buttons[to], callback_data: statusCallbackData(leadId, to) }))];
}

/** reply_markup карточки: без кнопок — пустая клавиатура, чтобы правка их сняла. */
export function cardReplyMarkup(leadId: string, status: LeadStatus): { inline_keyboard: InlineButton[][] } {
  return { inline_keyboard: cardButtons(leadId, status) };
}

/** Inline-кнопка «Отправить заявку» под сводкой — только при username. */
export function sendReplyMarkup(leadId: string): { inline_keyboard: InlineButton[][] } {
  return { inline_keyboard: [[{ text: content.bot.buttons.send, callback_data: sendCallbackData(leadId) }]] };
}

/** Reply-клавиатура «📱 Отправить с номером» под полем ввода. */
export function contactReplyMarkup() {
  return {
    keyboard: [[{ text: content.bot.buttons.sendWithPhone, request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

/** Снимает reply-клавиатуру после отправки. */
export function removeKeyboardMarkup() {
  return { remove_keyboard: true as const };
}
