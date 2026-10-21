// @vitest-environment node
// Мелкие части сбора: суточный потолок, отрицательный кеш сессий, устройство.
import { describe, expect, it, vi } from "vitest";
import { createDailyBudget, createDailyCap } from "@/lib/analytics/daily-cap";
import { NO_SESSION_TTL_MS, createNoSessionCache } from "@/lib/analytics/no-session-cache";
import { deviceOf } from "@/lib/analytics/device";

// 12:00 по Москве = 09:00 UTC.
const at = (iso: string) => new Date(iso);

describe("createDailyCap", () => {
  it("списывает до потолка, сверх — отказ и предупреждение раз в час", () => {
    const warn = vi.fn();
    const cap = createDailyCap(5, warn);
    expect(cap.take(3, at("2026-10-21T09:00:00Z"))).toBe(true);
    expect(cap.take(2, at("2026-10-21T09:00:01Z"))).toBe(true);
    expect(cap.reachedToday(at("2026-10-21T09:00:02Z"))).toBe(false);
    expect(cap.take(1, at("2026-10-21T09:00:03Z"))).toBe(false);
    expect(cap.take(1, at("2026-10-21T09:30:00Z"))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(cap.take(1, at("2026-10-21T10:00:04Z"))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(cap.reachedToday(at("2026-10-21T10:00:05Z"))).toBe(true);
  });

  // Сутки — московские: 21:00 UTC — уже следующий день.
  it("новые сутки по Москве обнуляют счётчик", () => {
    const cap = createDailyCap(1, () => {});
    expect(cap.take(1, at("2026-10-21T20:59:00Z"))).toBe(true);
    expect(cap.take(1, at("2026-10-21T20:59:30Z"))).toBe(false);
    expect(cap.take(1, at("2026-10-21T21:00:00Z"))).toBe(true);
    expect(cap.reachedToday(at("2026-10-21T21:00:01Z"))).toBe(false);
  });

  it("пачка целиком: не помещается — не списывается и частично", () => {
    const cap = createDailyCap(5, () => {});
    expect(cap.take(4, at("2026-10-21T09:00:00Z"))).toBe(true);
    expect(cap.take(2, at("2026-10-21T09:00:01Z"))).toBe(false);
    expect(cap.take(1, at("2026-10-21T09:00:02Z"))).toBe(true);
  });
});

// Роут сбора и страницы админки — разные бандлы со своей копией модуля:
// плашка «потолок достигнут» должна видеть то, что списал роут.
describe("общий потолок — один на процесс, а не на копию модуля", () => {
  it("копия модуля, загруженная заново, видит списанное другой", async () => {
    vi.resetModules();
    const a = await import("@/lib/analytics/daily-cap");
    a._resetVisitorCapsForTests();
    const now = at("2026-10-21T09:00:00Z");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(a.visitorEventsCap.take(Number.MAX_SAFE_INTEGER, now)).toBe(false);
    warn.mockRestore();
    vi.resetModules();
    const b = await import("@/lib/analytics/daily-cap");
    expect(b).not.toBe(a);
    expect(b.visitorEventsCap.reachedToday(now)).toBe(true);
    b._resetVisitorCapsForTests();
  });
});

describe("createDailyBudget", () => {
  it("доля на ключ в московские сутки", () => {
    const budget = createDailyBudget(10);
    const t = at("2026-10-21T09:00:00Z");
    expect(budget.fits("ip1", 10, t)).toBe(true);
    budget.take("ip1", 8, t);
    expect(budget.fits("ip1", 3, t)).toBe(false);
    expect(budget.fits("ip2", 10, t)).toBe(true);
    expect(budget.fits("ip1", 3, at("2026-10-21T21:00:00Z"))).toBe(true);
  });

  it("ограничен по числу ключей: вытесняется самый давний", () => {
    const budget = createDailyBudget(1, 2);
    const t = at("2026-10-21T09:00:00Z");
    budget.take("a", 1, t);
    budget.take("b", 1, t);
    budget.take("c", 1, t);
    expect(budget.fits("a", 1, t)).toBe(true);
    expect(budget.fits("c", 1, t)).toBe(false);
  });
});

describe("createNoSessionCache", () => {
  it("помнит «нет сессии» на срок, потом забывает", () => {
    const cache = createNoSessionCache();
    cache.remember("tok", 1000);
    expect(cache.has("tok", 1000 + NO_SESSION_TTL_MS - 1)).toBe(true);
    expect(cache.has("other", 1000)).toBe(false);
    expect(cache.has("tok", 1000 + NO_SESSION_TTL_MS)).toBe(false);
  });

  it("ограничен по размеру: вытесняется самый давний", () => {
    const cache = createNoSessionCache(60_000, 2);
    cache.remember("a", 0);
    cache.remember("b", 0);
    cache.remember("c", 0);
    expect(cache.has("a", 1)).toBe(false);
    expect(cache.has("b", 1)).toBe(true);
    expect(cache.has("c", 1)).toBe(true);
  });
});

describe("deviceOf", () => {
  it.each([
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "phone"],
    ["Android-телефон", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36", "phone"],
    ["Яндекс.Браузер на телефоне", "Mozilla/5.0 (Linux; Android 13) Chrome/124 YaBrowser/24.4 Mobile Safari/537.36", "phone"],
    ["Android-планшет", "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/130 Safari/537.36", "desktop"],
    ["Mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36", "desktop"],
    ["Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", "desktop"],
  ])("%s", (_name, ua, expected) => {
    expect(deviceOf(ua)).toBe(expected);
  });

  it("без User-Agent — неизвестно", () => {
    expect(deviceOf(null)).toBeNull();
  });
});
