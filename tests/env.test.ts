import { describe, it, expect } from "vitest";
import { parseEnv } from "../src/lib/env";

describe("env validation", () => {
  it("accepts a complete dev env", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://app:pwd@localhost:5432/app",
      NEXTAUTH_SECRET: "x".repeat(32),
      NEXTAUTH_URL: "http://localhost:3000",
      NODE_ENV: "development",
    });
    expect(env.DATABASE_URL).toContain("postgres://");
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() => parseEnv({
      NEXTAUTH_SECRET: "x".repeat(32),
      NEXTAUTH_URL: "http://localhost:3000",
      NODE_ENV: "development",
    } as never)).toThrow();
  });

  it("rejects short NEXTAUTH_SECRET", () => {
    expect(() => parseEnv({
      DATABASE_URL: "postgres://x:y@z/db",
      NEXTAUTH_SECRET: "short",
      NEXTAUTH_URL: "http://x",
      NODE_ENV: "development",
    })).toThrow(/NEXTAUTH_SECRET/);
  });

  describe("бот заявок", () => {
    const base = {
      DATABASE_URL: "postgres://app:pwd@localhost:5432/app",
      NEXTAUTH_SECRET: "x".repeat(32),
      NEXTAUTH_URL: "http://localhost:3000",
      NODE_ENV: "development",
    };
    // Фиктивные значения: настоящий токен в тесты не попадает.
    const telegram = {
      TELEGRAM_BOT_TOKEN: "123456:" + "a".repeat(35),
      TELEGRAM_BOT_USERNAME: "@test_bot",
      TELEGRAM_WEBHOOK_SECRET: "s".repeat(32),
      TELEGRAM_ADMIN_CHAT_ID: "-5000000001",
    };

    it("по умолчанию — auth и без бота", () => {
      const env = parseEnv(base);
      expect(env.BOOKING_FLOW).toBe("auth");
      expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    });

    it("полная группа: username без @, chat id — число со знаком", () => {
      const env = parseEnv({ ...base, ...telegram, BOOKING_FLOW: "telegram" });
      expect(env.BOOKING_FLOW).toBe("telegram");
      expect(env.TELEGRAM_BOT_USERNAME).toBe("test_bot");
      expect(env.TELEGRAM_ADMIN_CHAT_ID).toBe(-5000000001);
    });

    it("неполная группа TELEGRAM_* падает", () => {
      const { TELEGRAM_WEBHOOK_SECRET: _omit, ...partial } = telegram;
      expect(() => parseEnv({ ...base, ...partial })).toThrow(/TELEGRAM_\* env vars must be all set/);
    });

    it("пустые строки считаются отсутствием — группа целиком пуста", () => {
      const empty = Object.fromEntries(Object.keys(telegram).map((k) => [k, ""]));
      expect(parseEnv({ ...base, ...empty }).TELEGRAM_BOT_TOKEN).toBeUndefined();
    });

    it("telegram без группы падает", () => {
      expect(() => parseEnv({ ...base, BOOKING_FLOW: "telegram" })).toThrow(/BOOKING_FLOW=telegram requires/);
    });

    it("неизвестный флаг падает", () => {
      expect(() => parseEnv({ ...base, BOOKING_FLOW: "max" })).toThrow(/BOOKING_FLOW/);
    });

    it("секрет вебхука: короткий и с чужими символами — отказ", () => {
      expect(() => parseEnv({ ...base, ...telegram, TELEGRAM_WEBHOOK_SECRET: "short" }))
        .toThrow(/TELEGRAM_WEBHOOK_SECRET/);
      expect(() => parseEnv({ ...base, ...telegram, TELEGRAM_WEBHOOK_SECRET: "a".repeat(31) + "!" }))
        .toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    });

    it("chat id не целое — отказ; сообщение не содержит значений", () => {
      expect(() => parseEnv({ ...base, ...telegram, TELEGRAM_ADMIN_CHAT_ID: "-12.5" }))
        .toThrow(/TELEGRAM_ADMIN_CHAT_ID/);
      try {
        parseEnv({ ...base, ...telegram, TELEGRAM_BOT_TOKEN: "oops-" + "z".repeat(40) });
        expect.unreachable();
      } catch (e) {
        expect(String(e)).toMatch(/TELEGRAM_BOT_TOKEN/);
        expect(String(e)).not.toContain("z".repeat(40));
      }
    });
  });
});
