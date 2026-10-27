import { describe, it, expect } from "vitest";
import { displayName, parseUpdate, startPayload } from "@/lib/telegram/update";

const from = { id: 111, is_bot: false, first_name: "Иван", username: "ivan" };
const privateChat = { id: 111, type: "private", first_name: "Иван" };

describe("parseUpdate", () => {
  it("сообщение: текст, отправитель, чат; лишние поля отбрасываются", () => {
    const u = parseUpdate({
      update_id: 1,
      message: { message_id: 5, date: 1_700_000_000, chat: privateChat, from, text: "/start abc", entities: [] },
    });
    expect(u).toEqual({
      kind: "message",
      updateId: 1,
      message: {
        messageId: 5,
        chat: { id: 111, type: "private" },
        from: { id: 111, is_bot: false, first_name: "Иван", username: "ivan" },
        text: "/start abc",
        contact: null,
        migrateToChatId: null,
      },
    });
  });

  it("контакт: номер и user_id владельца", () => {
    const u = parseUpdate({
      update_id: 2,
      message: {
        message_id: 6, date: 1, chat: privateChat, from,
        contact: { phone_number: "+79000000000", first_name: "Иван", user_id: 111 },
      },
    });
    expect(u.kind === "message" && u.message.contact).toEqual({
      phone_number: "+79000000000", first_name: "Иван", user_id: 111,
    });
  });

  it("migrate_to_chat_id — группа стала супергруппой", () => {
    const u = parseUpdate({
      update_id: 3,
      message: { message_id: 7, date: 1, chat: { id: -5000, type: "group", title: "x" }, migrate_to_chat_id: -1001234567890 },
    });
    expect(u.kind === "message" && u.message.migrateToChatId).toBe(-1001234567890);
  });

  it("нажатие кнопки: id, data, сообщение", () => {
    const u = parseUpdate({
      update_id: 4,
      callback_query: {
        id: "cb1", from, chat_instance: "x", data: "send:01J0000000000000000000000A",
        message: { message_id: 9, date: 1_700_000_000, chat: privateChat, text: "сводка" },
      },
    });
    expect(u).toEqual({
      kind: "callback",
      updateId: 4,
      callback: {
        id: "cb1",
        from: { id: 111, is_bot: false, first_name: "Иван", username: "ivan" },
        data: "send:01J0000000000000000000000A",
        message: { messageId: 9, chat: { id: 111, type: "private" }, accessible: true, text: "сводка" },
      },
    });
  });

  it("InaccessibleMessage (date = 0) разбирается, но помечается недоступным", () => {
    const u = parseUpdate({
      update_id: 5,
      callback_query: {
        id: "cb2", from, chat_instance: "x", data: "st:01J0000000000000000000000A:handed",
        message: { message_id: 10, date: 0, chat: { id: -5000, type: "group" } },
      },
    });
    expect(u.kind === "callback" && u.callback.message).toEqual({
      messageId: 10, chat: { id: -5000, type: "group" }, accessible: false, text: null,
    });
  });

  it("нажатие без сообщения и без data", () => {
    const u = parseUpdate({ update_id: 6, callback_query: { id: "cb3", from, chat_instance: "x", inline_message_id: "i" } });
    expect(u.kind === "callback" && u.callback).toMatchObject({ data: null, message: null });
  });

  it("неизвестные виды апдейтов и мусор — ignored", () => {
    expect(parseUpdate({ update_id: 7, edited_message: {} })).toEqual({ kind: "ignored", updateId: 7 });
    expect(parseUpdate({ update_id: 8, my_chat_member: { chat: {} } })).toEqual({ kind: "ignored", updateId: 8 });
    expect(parseUpdate({ update_id: 9, message: { message_id: "x" } })).toEqual({ kind: "ignored", updateId: 9 });
    expect(parseUpdate("nope")).toEqual({ kind: "ignored", updateId: null });
    expect(parseUpdate(null)).toEqual({ kind: "ignored", updateId: null });
  });
});

describe("startPayload", () => {
  it("параметр deep link", () => {
    expect(startPayload("/start AbC_12-x")).toBe("AbC_12-x");
    expect(startPayload("/start@inrenta_bot AbC")).toBe("AbC");
    expect(startPayload("  /start   tok  ")).toBe("tok");
  });

  it("без параметра или с параметром чужого формата — пустая строка", () => {
    expect(startPayload("/start")).toBe("");
    expect(startPayload("/start a b")).toBe("");
    expect(startPayload("/start <script>")).toBe("");
    expect(startPayload(`/start ${"a".repeat(65)}`)).toBe("");
  });

  it("не /start — null", () => {
    expect(startPayload(null)).toBeNull();
    expect(startPayload("привет")).toBeNull();
    expect(startPayload("/starts abc")).toBeNull();
    expect(startPayload("/help")).toBeNull();
  });
});

describe("displayName", () => {
  it("имя и фамилия", () => {
    expect(displayName({ first_name: "Иван", last_name: "Петров" })).toBe("Иван Петров");
    expect(displayName({ first_name: "Иван" })).toBe("Иван");
  });
});
