import { describe, it, expect } from "vitest";
import { isWebhookSecretValid } from "@/lib/telegram/secret";

const SECRET = "s".repeat(40);

describe("isWebhookSecretValid", () => {
  it("совпадение", () => {
    expect(isWebhookSecretValid(SECRET, SECRET)).toBe(true);
  });

  it("другой секрет той же длины — отказ", () => {
    expect(isWebhookSecretValid("t".repeat(40), SECRET)).toBe(false);
  });

  it("другая длина — отказ без исключения", () => {
    expect(isWebhookSecretValid("s".repeat(39), SECRET)).toBe(false);
    expect(isWebhookSecretValid(SECRET + "s", SECRET)).toBe(false);
  });

  it("нет заголовка или бот не настроен — отказ", () => {
    expect(isWebhookSecretValid(null, SECRET)).toBe(false);
    expect(isWebhookSecretValid(undefined, SECRET)).toBe(false);
    expect(isWebhookSecretValid("", SECRET)).toBe(false);
    expect(isWebhookSecretValid(SECRET, undefined)).toBe(false);
  });
});
