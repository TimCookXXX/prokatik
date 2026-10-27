// @vitest-environment node
// POST /api/telegram/webhook: секрет, размер, фильтр чатов и лимит — в роуте;
// ветки /start, контакт, кнопки send: и st: — в server/telegram-bot.ts. База —
// моки server/leads и проверки выбора; callBot — мок, исходящие вызовы
// копятся в after(), тест исполняет их сам и смотрит, что ушло в Telegram.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ after: [] as (() => unknown)[] }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    state.after.push(fn);
  },
}));
vi.mock("@/lib/telegram/api", () => ({
  callBot: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
}));
vi.mock("@/server/lead-delivery", () => ({
  deliverLeadCard: vi.fn(async () => {}),
  retryUndeliveredCards: vi.fn(async () => {}),
}));
vi.mock("@/server/booking-check", () => ({ checkBookingSelection: vi.fn() }));
vi.mock("@/server/leads", () => ({
  DRAFT_TTL_MS: 24 * 60 * 60 * 1000,
  findDraftByToken: vi.fn(async () => null),
  findLeadById: vi.fn(async () => null),
  activeDraftOf: vi.fn(async () => null),
  bindDraft: vi.fn(async () => null),
  markLeadSent: vi.fn(async () => null),
  setLeadStatus: vi.fn(async () => null),
  releaseDraftsOf: vi.fn(async () => {}),
}));

import { POST } from "@/app/api/telegram/webhook/route";
import { callBot } from "@/lib/telegram/api";
import { deliverLeadCard } from "@/server/lead-delivery";
import { checkBookingSelection, type ListingSnapshot } from "@/server/booking-check";
import {
  activeDraftOf, bindDraft, findDraftByToken, findLeadById, markLeadSent, releaseDraftsOf, setLeadStatus,
} from "@/server/leads";
import { _setDraftWaitForTests } from "@/server/telegram-bot";
import { _resetForTests } from "@/lib/rate-limit";
import { content } from "@theme/content";
import {
  ADMIN_CHAT, LEAD_ID, WEBHOOK_SECRET, enableTelegramEnv, leadRow,
} from "../fixtures/leads";

const b = content.bot;
const USER = { id: 42, is_bot: false, first_name: "Иван", username: "ivan_courier" };
const NO_NICK = { id: 42, is_bot: false, first_name: "Иван" };
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const CARD_MSG = 777;

let disableEnv: () => void;
beforeAll(() => {
  disableEnv = enableTelegramEnv();
});
afterAll(() => disableEnv());

beforeEach(() => {
  // Сброс и реализаций: mockResolvedValue одного теста не протекает в другой.
  vi.resetAllMocks();
  vi.mocked(callBot).mockResolvedValue({ ok: true, result: { message_id: 1 } });
  _resetForTests();
  state.after = [];
  // Ожидание черновика без настоящих пауз: три чтения подряд.
  _setDraftWaitForTests([0, 0], async () => {});
});

function request(body: unknown, { secret = WEBHOOK_SECRET, raw }: { secret?: string | null; raw?: string } = {}) {
  return new NextRequest("http://localhost:3000/api/telegram/webhook", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(secret !== null ? { "x-telegram-bot-api-secret-token": secret } : {}),
    },
  });
}

async function send(body: unknown, opts?: Parameters<typeof request>[1]) {
  const res = await POST(request(body, opts));
  for (const fn of state.after.splice(0)) await fn();
  return res;
}

let updateId = 1;
const privateMessage = (from: object, extra: Record<string, unknown>) => ({
  update_id: updateId++,
  message: { message_id: 10, date: 1_700_000_000, chat: { id: 42, type: "private" }, from, ...extra },
});
const start = (payload = TOKEN, from: object = USER) => privateMessage(from, { text: `/start ${payload}`.trim() });
const callback = (
  data: string,
  chat: { id: number; type: string },
  from: object = USER,
  messageId = CARD_MSG,
  text?: string,
) => ({
  update_id: updateId++,
  callback_query: {
    id: "cb1",
    from,
    data,
    message: { message_id: messageId, date: 1_700_000_000, chat, ...(text !== undefined ? { text } : {}) },
  },
});
const PRIVATE = { id: 42, type: "private" };
const ADMIN = { id: ADMIN_CHAT, type: "group" };

/** Что ушло в Telegram: [метод, параметры]. */
const calls = () => vi.mocked(callBot).mock.calls.map(([method, params]) => ({ method, params: params ?? {} }));
const texts = () => calls().filter((c) => c.method === "sendMessage").map((c) => String(c.params.text));
const answers = () => calls().filter((c) => c.method === "answerCallbackQuery").map((c) => c.params.text);

const SNAPSHOT: ListingSnapshot = {
  listingId: "01JBQ0000000000000000000L1", ownerUserId: "owner", title: "Kugoo Kirin V3 Pro",
  path: "/krasnodar/velo/kugoo-01JBQ0000000000000000000L1", ownerName: "ПикаВел", ownerPhone: null,
  priceDay: 500, priceWeek: 2250, priceMonth: null, depositType: "none", depositAmount: null,
};
const checkOk = () => vi.mocked(checkBookingSelection).mockResolvedValue({
  ok: true, listing: {} as never, snapshot: SNAPSHOT, sel: { from: "2026-10-28", to: "2026-11-03", qty: 1 }, total: 2250,
});

describe("вебхук: вход", () => {
  it("без секрета и с чужим — 401, обработчик не зовётся", async () => {
    expect((await send(start(), { secret: null })).status).toBe(401);
    expect((await send(start(), { secret: "x".repeat(32) })).status).toBe(401);
    expect(findDraftByToken).not.toHaveBeenCalled();
  });

  it("тело больше 64 КБ — 413", async () => {
    const res = await send(null, { raw: JSON.stringify({ update_id: 1, pad: "x".repeat(65 * 1024) }) });
    expect(res.status).toBe(413);
  });

  it("не JSON и непонятный апдейт — 200 без ответа", async () => {
    expect((await send(null, { raw: "{not json" })).status).toBe(200);
    expect((await send({ update_id: 5, edited_message: {} })).status).toBe(200);
    expect(callBot).not.toHaveBeenCalled();
  });

  it("без бота — 404", async () => {
    disableEnv();
    try {
      expect((await send(start())).status).toBe(404);
    } finally {
      disableEnv = enableTelegramEnv();
    }
  });

  it("чужой групповой чат — 200, нажатию только пустой ответ", async () => {
    const res = await send(callback(`st:${LEAD_ID}:handed`, { id: -999, type: "supergroup" }));
    expect(res.status).toBe(200);
    expect(findLeadById).not.toHaveBeenCalled();
    expect(calls()).toEqual([{ method: "answerCallbackQuery", params: { callback_query_id: "cb1" } }]);
  });

  it("лимит по Telegram id — 200 молча, без обработчика", async () => {
    for (let i = 0; i < 30; i++) await send(privateMessage(USER, { text: "привет" }));
    vi.mocked(activeDraftOf).mockClear();
    const res = await send(privateMessage(USER, { text: "привет" }));
    expect(res.status).toBe(200);
    expect(activeDraftOf).not.toHaveBeenCalled();
  });

  it("нажатие сверх лимита — часики снимаются, обработчика нет", async () => {
    for (let i = 0; i < 30; i++) await send(privateMessage(USER, { text: "привет" }));
    vi.mocked(callBot).mockClear();
    const res = await send(callback(`send:${LEAD_ID}`, PRIVATE));
    expect(res.status).toBe(200);
    expect(findLeadById).not.toHaveBeenCalled();
    expect(calls()).toEqual([{ method: "answerCallbackQuery", params: { callback_query_id: "cb1" } }]);
  });

  it("не ошибка базы (баг, неожиданные данные) — 200: повтор упал бы так же", async () => {
    vi.mocked(findDraftByToken).mockRejectedValueOnce(new TypeError("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await send(start());
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("[telegram] обработка апдейта упала:", "TypeError");
    expect(callBot).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("ошибка базы — 500, исходящих вызовов нет", async () => {
    vi.mocked(findDraftByToken).mockRejectedValueOnce(Object.assign(new Error("db"), { code: "57P01" }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await send(start());
    expect(res.status).toBe(500);
    expect(state.after).toHaveLength(0);
    expect(callBot).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("команды и текст в админской группе игнорируются", async () => {
    await send({
      update_id: updateId++,
      message: { message_id: 1, date: 1, chat: ADMIN, from: USER, text: `/start ${TOKEN}` },
    });
    expect(findDraftByToken).not.toHaveBeenCalled();
    expect(callBot).not.toHaveBeenCalled();
  });

  it("переход группы в супергруппу — в лог", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await send({ update_id: updateId++, message: { message_id: 1, date: 1, chat: ADMIN, migrate_to_chat_id: -100123 } });
    expect(spy).toHaveBeenCalledWith("[telegram] chat migrated", -100123);
    spy.mockRestore();
  });
});

describe("вебхук: /start", () => {
  it("без параметра — «выберите вещь на сайте»", async () => {
    await send(privateMessage(USER, { text: "/start" }));
    expect(texts()).toEqual([b.noDraft]);
    expect(findDraftByToken).not.toHaveBeenCalled();
  });

  it("черновика нет — три чтения, потом «устарела»", async () => {
    await send(start());
    expect(findDraftByToken).toHaveBeenCalledTimes(3);
    expect(texts()).toEqual([b.expired]);
  });

  it("черновик дошёл со второго чтения — бот его дождался", async () => {
    vi.mocked(findDraftByToken).mockResolvedValueOnce(null).mockResolvedValueOnce(leadRow());
    vi.mocked(bindDraft).mockImplementation(async () => leadRow({ tgUserId: 42 }));
    await send(start());
    expect(bindDraft).toHaveBeenCalledTimes(1);
  });

  it("старше суток — «устарела», без привязки", async () => {
    vi.mocked(findDraftByToken).mockResolvedValue(leadRow({ createdAt: new Date(Date.now() - 25 * 3600_000) }));
    await send(start());
    expect(texts()).toEqual([b.expired]);
    expect(bindDraft).not.toHaveBeenCalled();
  });

  it("invalid_reason — текст причины", async () => {
    vi.mocked(findDraftByToken).mockResolvedValue(leadRow({ invalidReason: "dates_taken:2026-10-28" }));
    await send(start());
    expect(texts()).toEqual([b.reasons.datesTaken]);
    expect(bindDraft).not.toHaveBeenCalled();
  });

  it("привязан к другому аккаунту — «ссылка уже использована»", async () => {
    vi.mocked(findDraftByToken).mockResolvedValue(leadRow({ tgUserId: 7 }));
    await send(start());
    expect(texts()).toEqual([b.used]);
    expect(bindDraft).not.toHaveBeenCalled();
  });

  it("уже отправлена — «заявка INR-… уже принята»", async () => {
    vi.mocked(findDraftByToken).mockResolvedValue(leadRow({ status: "handed", code: "INR-4821", tgUserId: 42 }));
    await send(start());
    expect(texts()).toEqual([b.alreadySent]);
  });

  it("черновик при username: привязка, сводка с «Отправить» и клавиатура с номером", async () => {
    vi.mocked(findDraftByToken).mockResolvedValue(leadRow());
    vi.mocked(bindDraft).mockImplementation(async () => leadRow({ tgUserId: 42, tgUsername: "ivan_courier" }));
    await send(start());
    expect(bindDraft).toHaveBeenCalledWith(LEAD_ID, { userId: 42, username: "ivan_courier", name: "Иван" }, expect.any(Date));
    const sent = calls().filter((c) => c.method === "sendMessage");
    expect(sent).toHaveLength(2);
    expect(String(sent[0].params.text)).toContain(b.promptWithUsername);
    expect(sent[0].params.reply_markup).toEqual({
      inline_keyboard: [[{ text: b.buttons.send, callback_data: `send:${LEAD_ID}` }]],
    });
    expect(sent[1].params.reply_markup).toMatchObject({
      keyboard: [[{ text: b.buttons.sendWithPhone, request_contact: true }]],
    });
  });

  it("черновик без username: только «📱 Отправить с номером»", async () => {
    vi.mocked(findDraftByToken).mockResolvedValue(leadRow());
    vi.mocked(bindDraft).mockImplementation(async () => leadRow({ tgUserId: 42 }));
    await send(start(TOKEN, NO_NICK));
    const sent = calls().filter((c) => c.method === "sendMessage");
    expect(sent).toHaveLength(1);
    expect(String(sent[0].params.text)).toContain(b.promptPhoneRequired);
    expect(sent[0].params.reply_markup).toMatchObject({ keyboard: [[{ request_contact: true }]] });
    expect(JSON.stringify(sent[0].params.reply_markup)).not.toContain("send:");
  });

  it("гонка привязки: пустой RETURNING — «ссылка уже использована»", async () => {
    vi.mocked(findDraftByToken).mockResolvedValue(leadRow());
    vi.mocked(findLeadById).mockResolvedValue(leadRow({ tgUserId: 7 }));
    await send(start());
    expect(texts()).toEqual([b.used]);
  });

  /* Человек открыл бота с новым выбором, а тот не привязался: контакт с
   * клавиатуры прежнего черновика не должен отправить старые даты. */
  it("непривязавшийся /start гасит прежний черновик аккаунта, привязавшийся — нет", async () => {
    await send(start());
    vi.mocked(findDraftByToken).mockResolvedValue(leadRow({ invalidReason: "price_stale" }));
    await send(start());
    vi.mocked(findDraftByToken).mockResolvedValue(leadRow({ tgUserId: 7 }));
    await send(start());
    expect(releaseDraftsOf).toHaveBeenCalledTimes(3);
    expect(releaseDraftsOf).toHaveBeenCalledWith(42);

    vi.mocked(releaseDraftsOf).mockClear();
    vi.mocked(findDraftByToken).mockResolvedValue(leadRow());
    vi.mocked(bindDraft).mockImplementation(async () => leadRow({ tgUserId: 42 }));
    await send(start());
    expect(releaseDraftsOf).not.toHaveBeenCalled();
  });
});

describe("вебхук: контакт и текст", () => {
  it("чужой контакт отклоняется, заявка не отправляется", async () => {
    await send(privateMessage(USER, { contact: { phone_number: "79001234567", user_id: 99 } }));
    expect(texts()).toEqual([b.foreignContact]);
    expect(activeDraftOf).not.toHaveBeenCalled();
    expect(markLeadSent).not.toHaveBeenCalled();
  });

  it("контакт без user_id (чужая визитка) — тоже отказ", async () => {
    await send(privateMessage(USER, { contact: { phone_number: "79001234567" } }));
    expect(markLeadSent).not.toHaveBeenCalled();
  });

  /* Какой черновик последний по bound_at, решает запрос activeDraftOf
   * (tests/server/leads.test.ts); здесь — что контакт уходит именно в него. */
  it("свой контакт отправляет активный черновик с нормализованным номером", async () => {
    const latest = leadRow({ id: "01JBQ0000000000000000000ZZ", tgUserId: 42, boundAt: new Date() });
    vi.mocked(activeDraftOf).mockResolvedValue(latest);
    checkOk();
    vi.mocked(markLeadSent).mockResolvedValue({ ...latest, status: "sent", code: "INR-0042" });
    await send(privateMessage(USER, { contact: { phone_number: "79001234567", user_id: 42 } }));
    expect(activeDraftOf).toHaveBeenCalledWith(42, expect.any(Date));
    expect(markLeadSent).toHaveBeenCalledWith(
      latest.id, expect.objectContaining({ customerPhone: "+79001234567" }), expect.any(Date),
    );
    expect(texts()[0]).toContain("Заявка принята");
    expect(texts()[0]).not.toContain("INR-0042");
    expect(deliverLeadCard).toHaveBeenCalledWith(latest.id);
  });

  it("контакт без активного черновика — снимает клавиатуру с номером", async () => {
    await send(privateMessage(USER, { contact: { phone_number: "79001234567", user_id: 42 } }));
    expect(texts()).toEqual([b.noDraft]);
    expect(calls()[0].params.reply_markup).toEqual({ remove_keyboard: true });
    expect(markLeadSent).not.toHaveBeenCalled();
  });

  it("текст без черновика — «выберите вещь на сайте», с черновиком — подсказка", async () => {
    await send(privateMessage(USER, { text: "здравствуйте" }));
    expect(texts()).toEqual([b.noDraft]);
    vi.mocked(callBot).mockClear();
    vi.mocked(activeDraftOf).mockResolvedValue(leadRow({ tgUserId: 42 }));
    await send(privateMessage(USER, { text: "здравствуйте" }));
    expect(texts()).toEqual([b.useButtons]);
  });
});

describe("вебхук: кнопка «Отправить заявку» (send:)", () => {
  const draft = () => leadRow({ tgUserId: 42, tgUsername: "ivan_courier", boundAt: new Date() });

  it("своя из лички — отправка, «принята», кнопка снимается, карточка в группу", async () => {
    vi.mocked(findLeadById).mockResolvedValue(draft());
    checkOk();
    vi.mocked(markLeadSent).mockResolvedValue({ ...draft(), status: "sent", code: "INR-4821" });
    await send(callback(`send:${LEAD_ID}`, PRIVATE));
    // Снимок черновика уходит в повторную проверку как «увиденный».
    expect(checkBookingSelection).toHaveBeenCalledWith(expect.objectContaining({
      listingId: "01JBQ0000000000000000000L1", from: "2026-10-28", to: "2026-11-03", qty: 1, priceDay: 500, priceWeek: 2250,
    }), null);
    expect(markLeadSent).toHaveBeenCalledWith(LEAD_ID, expect.objectContaining({ customerPhone: null }), expect.any(Date));
    expect(texts()[0]).toContain("Заявка принята");
    expect(texts()[0]).not.toContain("INR-4821");
    expect(calls().map((c) => c.method)).toEqual(["answerCallbackQuery", "sendMessage", "editMessageReplyMarkup"]);
    expect(deliverLeadCard).toHaveBeenCalledWith(LEAD_ID);
  });

  it("чужой from.id — отказ, отправки нет", async () => {
    vi.mocked(findLeadById).mockResolvedValue(draft());
    await send(callback(`send:${LEAD_ID}`, { id: 7, type: "private" }, { ...USER, id: 7 }));
    expect(answers()).toEqual([b.callback.forbidden]);
    expect(markLeadSent).not.toHaveBeenCalled();
  });

  it("send: из админского чата — отказ", async () => {
    vi.mocked(findLeadById).mockResolvedValue(draft());
    await send(callback(`send:${LEAD_ID}`, ADMIN));
    expect(answers()).toEqual([b.callback.forbidden]);
    expect(markLeadSent).not.toHaveBeenCalled();
  });

  it("username пропал — без номера не отправить", async () => {
    vi.mocked(findLeadById).mockResolvedValue(draft());
    await send(callback(`send:${LEAD_ID}`, PRIVATE, NO_NICK));
    expect(answers()).toEqual([b.promptPhoneRequired]);
    expect(markLeadSent).not.toHaveBeenCalled();
  });

  it("повторная проверка не прошла — причина, заявка остаётся черновиком", async () => {
    vi.mocked(findLeadById).mockResolvedValue(draft());
    vi.mocked(checkBookingSelection).mockResolvedValue({ ok: false, error: "price_stale", snapshot: SNAPSHOT });
    await send(callback(`send:${LEAD_ID}`, PRIVATE));
    expect(texts()).toEqual([b.reasons.priceStale]);
    expect(markLeadSent).not.toHaveBeenCalled();
  });

  it("второе нажатие: пустой RETURNING — «уже принята», карточка не дублируется", async () => {
    vi.mocked(findLeadById)
      .mockResolvedValueOnce(draft())
      .mockResolvedValueOnce({ ...draft(), status: "sent", code: "INR-4821" });
    checkOk();
    vi.mocked(markLeadSent).mockResolvedValue(null);
    await send(callback(`send:${LEAD_ID}`, PRIVATE));
    expect(texts()).toEqual([b.alreadySent]);
    expect(deliverLeadCard).not.toHaveBeenCalled();
  });
});

describe("вебхук: кнопки статуса (st:)", () => {
  const card = () => leadRow({ status: "sent", code: "INR-4821", groupMessageId: CARD_MSG });

  it("из админского чата на своей карточке — переход, правка карточки, «Готово»", async () => {
    vi.mocked(findLeadById).mockResolvedValue(card());
    vi.mocked(setLeadStatus).mockResolvedValue({
      ...card(), status: "handed", statusChangedBy: "Тимур", statusChangedAt: new Date(),
    });
    await send(callback(`st:${LEAD_ID}:handed`, ADMIN, { id: 1, first_name: "Тимур" }));
    expect(setLeadStatus).toHaveBeenCalledWith(LEAD_ID, "handed", CARD_MSG, "Тимур", expect.any(Date));
    const edit = calls().find((c) => c.method === "editMessageText")!;
    expect(edit.params).toMatchObject({ chat_id: ADMIN_CHAT, message_id: CARD_MSG, parse_mode: "HTML" });
    expect(edit.params.reply_markup).toEqual({
      inline_keyboard: [[
        { text: b.buttons.taken, callback_data: `st:${LEAD_ID}:taken` },
        { text: b.buttons.declined, callback_data: `st:${LEAD_ID}:declined` },
      ]],
    });
    expect(answers()).toEqual([b.callback.done]);
  });

  it("st: из лички — отказ", async () => {
    vi.mocked(findLeadById).mockResolvedValue(card());
    await send(callback(`st:${LEAD_ID}:handed`, PRIVATE));
    expect(answers()).toEqual([b.callback.forbidden]);
    expect(setLeadStatus).not.toHaveBeenCalled();
  });

  it("чужой message_id — отказ: callback_data подделан через MTProto", async () => {
    vi.mocked(findLeadById).mockResolvedValue(card());
    await send(callback(`st:${LEAD_ID}:handed`, ADMIN, USER, CARD_MSG + 1));
    expect(answers()).toEqual([b.callback.forbidden]);
    expect(setLeadStatus).not.toHaveBeenCalled();
  });

  it("пустой RETURNING — «Уже изменено», карточка перерисовывается по строке", async () => {
    // Статус уже handed: правка карточки после первого нажатия не прошла (429).
    vi.mocked(findLeadById)
      .mockResolvedValueOnce(card())
      .mockResolvedValueOnce({ ...card(), status: "handed", statusChangedBy: "Тимур", statusChangedAt: new Date() });
    vi.mocked(setLeadStatus).mockResolvedValue(null);
    await send(callback(`st:${LEAD_ID}:handed`, ADMIN));
    expect(answers()).toEqual([b.callback.alreadyChanged]);
    const edit = calls().find((c) => c.method === "editMessageText")!;
    expect(edit.params).toMatchObject({ chat_id: ADMIN_CHAT, message_id: CARD_MSG });
    expect(JSON.stringify(edit.params.reply_markup)).toContain(`st:${LEAD_ID}:taken`);
  });

  it("вторая карточка той же заявки (повтор после таймаута) — «устарела», кнопки снимаются", async () => {
    vi.mocked(findLeadById).mockResolvedValue(card());
    await send(callback(`st:${LEAD_ID}:handed`, ADMIN, USER, CARD_MSG - 1, "INR-4821 · новая\nKugoo"));
    expect(answers()).toEqual([b.callback.staleCard]);
    expect(calls().find((c) => c.method === "editMessageReplyMarkup")?.params).toEqual({
      chat_id: ADMIN_CHAT, message_id: CARD_MSG - 1, reply_markup: { inline_keyboard: [] },
    });
    expect(setLeadStatus).not.toHaveBeenCalled();
  });

  it("чужая карточка с подделанными данными кнопки — отказ, её кнопки не трогаются", async () => {
    vi.mocked(findLeadById).mockResolvedValue(card());
    await send(callback(`st:${LEAD_ID}:handed`, ADMIN, USER, CARD_MSG + 1, "INR-48210 · новая"));
    expect(answers()).toEqual([b.callback.forbidden]);
    expect(calls().some((c) => c.method === "editMessageReplyMarkup")).toBe(false);
  });

  it("мусорный callback_data — часики снимаются без текста", async () => {
    await send(callback("garbage", ADMIN));
    expect(calls()).toEqual([{ method: "answerCallbackQuery", params: { callback_query_id: "cb1" } }]);
  });
});
