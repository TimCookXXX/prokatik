// Разбор входящего Update Bot API. Схема — подмножество: только то, что читает
// бот заявок (src/server/telegram-bot.ts). Лишние поля Telegram отбрасываются,
// неизвестные виды апдейтов и всё, что не сошлось со схемой, становятся
// `ignored`: вебхук отвечает на них 200, иначе Telegram повторял бы доставку.
//
// id пользователей и чатов — числа: у Telegram они до 52 бит и в double
// помещаются (так обещает документация Bot API).

import { z } from "zod";

const id = z.number().int().safe();

const user = z.object({
  id,
  is_bot: z.boolean().optional(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

const chat = z.object({
  id,
  type: z.enum(["private", "group", "supergroup", "channel"]),
});

const contact = z.object({
  phone_number: z.string(),
  first_name: z.string().optional(),
  /** Есть, только если контакт — пользователь Telegram. */
  user_id: id.optional(),
});

const message = z.object({
  message_id: id,
  date: z.number().int(),
  chat,
  from: user.optional(),
  text: z.string().optional(),
  contact: contact.optional(),
  /** Группа стала супергруппой: у неё новый id. */
  migrate_to_chat_id: id.optional(),
});

const callbackQuery = z.object({
  id: z.string(),
  from: user,
  data: z.string().optional(),
  /* Сообщение с кнопкой. Старше 48 часов Telegram присылает его как
   * InaccessibleMessage: date = 0, без текста, но с chat и message_id. Схема
   * сообщения его принимает — нужные поля у них общие. */
  message: message.optional(),
});

const update = z.object({
  update_id: z.number().int(),
  message: message.optional(),
  callback_query: callbackQuery.optional(),
});

export type TgUser = z.infer<typeof user>;
export type TgChat = z.infer<typeof chat>;
export type TgContact = z.infer<typeof contact>;

export interface TgMessage {
  messageId: number;
  chat: TgChat;
  from: TgUser | null;
  text: string | null;
  contact: TgContact | null;
  migrateToChatId: number | null;
}

export interface TgCallback {
  id: string;
  from: TgUser;
  data: string | null;
  /**
   * null — Telegram сообщение не прислал. text — текст сообщения с кнопкой без
   * разметки; у InaccessibleMessage его нет.
   */
  message: { messageId: number; chat: TgChat; accessible: boolean; text: string | null } | null;
}

export type BotUpdate =
  | { kind: "message"; updateId: number; message: TgMessage }
  | { kind: "callback"; updateId: number; callback: TgCallback }
  | { kind: "ignored"; updateId: number | null };

export function parseUpdate(raw: unknown): BotUpdate {
  const parsed = update.safeParse(raw);
  if (!parsed.success) {
    const updateId = raw && typeof raw === "object" && typeof (raw as { update_id?: unknown }).update_id === "number"
      ? (raw as { update_id: number }).update_id
      : null;
    return { kind: "ignored", updateId };
  }
  const u = parsed.data;
  if (u.message) {
    const m = u.message;
    return {
      kind: "message",
      updateId: u.update_id,
      message: {
        messageId: m.message_id,
        chat: m.chat,
        from: m.from ?? null,
        text: m.text ?? null,
        contact: m.contact ?? null,
        migrateToChatId: m.migrate_to_chat_id ?? null,
      },
    };
  }
  if (u.callback_query) {
    const q = u.callback_query;
    return {
      kind: "callback",
      updateId: u.update_id,
      callback: {
        id: q.id,
        from: q.from,
        data: q.data ?? null,
        message: q.message
          ? {
            messageId: q.message.message_id,
            chat: q.message.chat,
            accessible: q.message.date !== 0,
            text: q.message.text ?? null,
          }
          : null,
      },
    };
  }
  return { kind: "ignored", updateId: u.update_id };
}

// Правило Bot API на параметр deep link: до 64 символов из A-Z, a-z, 0-9, _ и -.
const START_PAYLOAD_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Команда `/start` и её параметр. null — это не /start; "" — /start без
 * параметра или с параметром чужого формата: и то и другое отвечает «выберите
 * вещь на сайте». Суффикс `@имя_бота` допускается — так команда приходит,
 * если её выбрали из меню в группе.
 */
export function startPayload(text: string | null): string | null {
  if (!text) return null;
  const m = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const payload = (m[1] ?? "").trim();
  return START_PAYLOAD_RE.test(payload) ? payload : "";
}

/** Имя человека для карточки и отметки статуса: имя и фамилия из профиля. */
export function displayName(u: Pick<TgUser, "first_name" | "last_name">): string {
  return [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
}
