// @vitest-environment node
// Разбор аргументов pnpm tg:webhook и параметры вызова Bot API. Сетевой вызов
// не тестируется.
import { describe, expect, it } from "vitest";
import { botRequest, parseArgs } from "../../scripts/telegram-webhook";

describe("pnpm tg:webhook", () => {
  it("set требует https-адрес", () => {
    expect(parseArgs(["set", "--url", "https://inrenta.ru/api/telegram/webhook"]))
      .toEqual({ kind: "set", url: "https://inrenta.ru/api/telegram/webhook" });
    expect(() => parseArgs(["set", "--url", "http://localhost:3000/api/telegram/webhook"])).toThrow("https");
    expect(() => parseArgs(["set"])).toThrow();
    expect(() => parseArgs(["set", "--url", "не адрес"])).toThrow();
  });

  it("info и delete без аргументов, остальное — подсказка", () => {
    expect(parseArgs(["info"])).toEqual({ kind: "info" });
    expect(parseArgs(["delete"])).toEqual({ kind: "delete" });
    expect(() => parseArgs([])).toThrow("tg:webhook");
    expect(() => parseArgs(["info", "x"])).toThrow();
  });

  it("setWebhook несёт секрет и только нужные виды апдейтов", () => {
    const secret = "s".repeat(32);
    expect(botRequest({ kind: "set", url: "https://x.ru/h" }, secret)).toEqual({
      method: "setWebhook",
      params: { url: "https://x.ru/h", secret_token: secret, allowed_updates: ["message", "callback_query"] },
    });
    expect(() => botRequest({ kind: "set", url: "https://x.ru/h" }, undefined)).toThrow("TELEGRAM_WEBHOOK_SECRET");
  });
});
