import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { callBot, isEditNoop, parseBotResponse } from "@/lib/telegram/api";
import { _resetEnvCacheForTests } from "@/lib/env";

// Фиктивный токен: настоящий в тесты не попадает.
const TOKEN = "123456:" + "T".repeat(35);
const env = process.env as Record<string, string | undefined>;
const TG_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_ADMIN_CHAT_ID"];

function configure(on: boolean) {
  if (on) {
    env.TELEGRAM_BOT_TOKEN = TOKEN;
    env.TELEGRAM_BOT_USERNAME = "test_bot";
    env.TELEGRAM_WEBHOOK_SECRET = "s".repeat(32);
    env.TELEGRAM_ADMIN_CHAT_ID = "-100";
  } else {
    for (const k of TG_KEYS) delete env[k];
  }
  _resetEnvCacheForTests();
}

let logged: string[];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  configure(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  configure(false);
});

describe("callBot", () => {
  it("POST JSON на метод, результат при ok", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 42 } })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await callBot<{ message_id: number }>("sendMessage", { chat_id: 1, text: "hi" });
    expect(r).toEqual({ ok: true, result: { message_id: 42 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: 1, text: "hi" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("отказ Telegram: description, код, retry_after; в логе метод и текст, без токена", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: false, error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 },
    }), { status: 429 })));
    const r = await callBot("sendMessage", {});
    expect(r).toEqual({ ok: false, description: "Too Many Requests: retry after 7", errorCode: 429, retryAfter: 7 });
    expect(logged.join("\n")).toContain("sendMessage");
    expect(logged.join("\n")).not.toContain(TOKEN);
  });

  it("сетевая ошибка не бросает, в лог — только имя ошибки; повтор один", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getMe`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await callBot("getMe");
    expect(r).toEqual({ ok: false, description: "TypeError", errorCode: null, retryAfter: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logged.join("\n")).not.toContain(TOKEN);
  });

  it("повисший запрос повторяется, и второй ответ засчитывается", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { message_id: 7 } })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await callBot("sendMessage", { chat_id: 1, text: "hi" })).toEqual({ ok: true, result: { message_id: 7 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("отказ Telegram не повторяется", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await callBot("sendMessage", {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("не-JSON ответ — отказ с HTTP-кодом", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    const r = await callBot("getMe");
    expect(r).toMatchObject({ ok: false, errorCode: 502 });
  });

  it("бот не настроен — отказ без запроса", async () => {
    configure(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await callBot("getMe");
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("parseBotResponse / isEditNoop", () => {
  it("«message is not modified» — не сбой правки и не пишется в лог", () => {
    const r = parseBotResponse("editMessageText", 400, {
      ok: false, error_code: 400,
      description: "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
    });
    expect(isEditNoop(r)).toBe(true);
    expect(logged).toEqual([]);
  });

  it("другие отказы — не noop", () => {
    const r = parseBotResponse("editMessageText", 400, { ok: false, description: "Bad Request: message to edit not found" });
    expect(isEditNoop(r)).toBe(false);
    expect(isEditNoop({ ok: true, result: true })).toBe(false);
  });

  it("тело без полей — код из HTTP", () => {
    expect(parseBotResponse("getMe", 500, null)).toEqual({ ok: false, description: "HTTP 500", errorCode: 500, retryAfter: null });
  });
});
