import { describe, it, expect } from "vitest";
import { leadChannel, leadStatus } from "@db/schema";
import {
  LEAD_CHANNELS, LEAD_STATUSES, authorizeCallback, canTransitionLead, cardButtons, contactReplyMarkup,
  isFinalLead, leadSourcesOf, parseLeadCallback, sendCallbackData, sendReplyMarkup, statusCallbackData,
  type CallbackOrigin,
} from "@/lib/leads/status";

const ID = "01JBQ0000000000000000000AB";
const ADMIN = -5000;
const TG = 777;

describe("статусы лида", () => {
  it("совпадают с enum-ами схемы", () => {
    expect(leadStatus.enumValues).toEqual([...LEAD_STATUSES]);
    expect(leadChannel.enumValues).toEqual([...LEAD_CHANNELS]);
  });

  it("переходы: sent → handed|declined, handed → taken|declined", () => {
    expect(canTransitionLead("sent", "handed")).toBe(true);
    expect(canTransitionLead("sent", "declined")).toBe(true);
    expect(canTransitionLead("sent", "taken")).toBe(false);
    expect(canTransitionLead("handed", "taken")).toBe(true);
    expect(canTransitionLead("handed", "declined")).toBe(true);
    expect(canTransitionLead("draft", "handed")).toBe(false);
    expect(canTransitionLead("draft", "sent")).toBe(false);
    for (const s of ["taken", "declined"] as const) {
      for (const to of LEAD_STATUSES) expect(canTransitionLead(s, to)).toBe(false);
      expect(isFinalLead(s)).toBe(true);
    }
    expect(leadSourcesOf("declined")).toEqual(["sent", "handed"]);
    expect(leadSourcesOf("taken")).toEqual(["handed"]);
  });

  it("кнопки карточки по статусу; у конечных — нет", () => {
    expect(cardButtons(ID, "sent")).toEqual([[
      { text: "Передал прокату", callback_data: `st:${ID}:handed` },
      { text: "Отказ", callback_data: `st:${ID}:declined` },
    ]]);
    expect(cardButtons(ID, "handed")[0].map((b) => b.text)).toEqual(["Взял", "Отказ"]);
    expect(cardButtons(ID, "taken")).toEqual([]);
    expect(cardButtons(ID, "declined")).toEqual([]);
  });

  it("callback_data укладывается в 64 байта Telegram", () => {
    expect(Buffer.byteLength(statusCallbackData(ID, "declined"))).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(sendCallbackData(ID))).toBeLessThanOrEqual(64);
  });

  it("клавиатуры клиента: inline «Отправить заявку» и reply с request_contact", () => {
    expect(sendReplyMarkup(ID).inline_keyboard[0][0].callback_data).toBe(`send:${ID}`);
    expect(contactReplyMarkup().keyboard[0][0]).toEqual({ text: "📱 Отправить с номером", request_contact: true });
  });
});

describe("parseLeadCallback", () => {
  it("st: и send:", () => {
    expect(parseLeadCallback(`st:${ID}:handed`)).toEqual({ kind: "status", leadId: ID, to: "handed" });
    expect(parseLeadCallback(`send:${ID}`)).toEqual({ kind: "send", leadId: ID });
  });

  it("чужой формат, неизвестный статус и id — null", () => {
    for (const data of [
      null, "", "st", `st:${ID}`, `st:${ID}:sent`, `st:${ID}:draft`, `st:${ID}:handed:x`,
      "st:not-a-ulid:handed", `send:${ID}:x`, "send:../../etc", `x:${ID}`,
    ]) {
      expect(parseLeadCallback(data)).toBeNull();
    }
  });
});

describe("authorizeCallback: разделение st: и send:", () => {
  const lead = { tgUserId: TG, groupMessageId: 900 };
  const admin: CallbackOrigin = { chatId: ADMIN, chatType: "group", messageId: 900, fromId: 1 };
  const privateOrigin: CallbackOrigin = { chatId: TG, chatType: "private", messageId: 5, fromId: TG };
  const st = { kind: "status", leadId: ID, to: "handed" } as const;
  const send = { kind: "send", leadId: ID } as const;

  it("st: — только из админ-чата и только с карточки этого лида", () => {
    expect(authorizeCallback(st, admin, lead, ADMIN)).toBe(true);
    expect(authorizeCallback(st, { ...admin, chatId: -6000 }, lead, ADMIN)).toBe(false);
    expect(authorizeCallback(st, { ...admin, messageId: 901 }, lead, ADMIN)).toBe(false);
    expect(authorizeCallback(st, admin, { ...lead, groupMessageId: null }, ADMIN)).toBe(false);
    // Из лички, даже от привязанного клиента, — нельзя.
    expect(authorizeCallback(st, privateOrigin, lead, ADMIN)).toBe(false);
  });

  it("send: — только из лички привязанного аккаунта", () => {
    expect(authorizeCallback(send, privateOrigin, lead, ADMIN)).toBe(true);
    expect(authorizeCallback(send, { ...privateOrigin, fromId: 778, chatId: 778 }, lead, ADMIN)).toBe(false);
    expect(authorizeCallback(send, { ...privateOrigin, chatType: "group" }, lead, ADMIN)).toBe(false);
    expect(authorizeCallback(send, { ...admin, fromId: TG }, lead, ADMIN)).toBe(false);
    expect(authorizeCallback(send, privateOrigin, { ...lead, tgUserId: null }, ADMIN)).toBe(false);
  });

  it("без сообщения — отказ", () => {
    expect(authorizeCallback(st, null, lead, ADMIN)).toBe(false);
    expect(authorizeCallback(send, null, lead, ADMIN)).toBe(false);
  });
});
