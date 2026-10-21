// @vitest-environment node
// Схема тела /api/analytics: неизвестный тип, лишние поля, длина и размер
// пачки отклоняют её целиком.
import { describe, expect, it } from "vitest";
import { batchSchema } from "@/lib/analytics/payload";
import { TRACK_BATCH_MAX, TRACK_RAW_PATH_MAX } from "@/lib/analytics/limits";

const ok = (body: unknown) => batchSchema.safeParse(body).success;

describe("batchSchema", () => {
  it("принимает просмотр и ClientID", () => {
    expect(ok({ events: [{ type: "pageview", path: "/", doc: true, ref: "https://ya.ru/" }] })).toBe(true);
    expect(ok({ events: [{ type: "pageview", path: "/krasnodar" }, { type: "ym_client", cid: "1697712345123456789" }] }))
      .toBe(true);
    expect(ok({ events: [{ type: "pageview", path: "/" }], bot: true })).toBe(true);
  });

  it("неизвестный тип и событие сервера — нет", () => {
    expect(ok({ events: [{ type: "purchase", path: "/" }] })).toBe(false);
    // «Вошёл» пишет только роут: с клиента его не подделать.
    expect(ok({ events: [{ type: "login" }] })).toBe(false);
  });

  it("лишние поля — нет", () => {
    expect(ok({ events: [{ type: "pageview", path: "/", userId: "u1" }] })).toBe(false);
    expect(ok({ events: [{ type: "pageview", path: "/" }], vid: "x" })).toBe(false);
    expect(ok({ events: [{ type: "pageview", path: "/", doc: false }] })).toBe(false);
  });

  it("длина полей и пачки ограничена", () => {
    expect(ok({ events: [{ type: "pageview", path: `/${"a".repeat(TRACK_RAW_PATH_MAX)}` }] })).toBe(false);
    expect(ok({ events: [{ type: "pageview", path: "/", ref: "a".repeat(TRACK_RAW_PATH_MAX + 1) }] })).toBe(false);
    expect(ok({ events: [] })).toBe(false);
    expect(ok({ events: Array.from({ length: TRACK_BATCH_MAX + 1 }, () => ({ type: "pageview", path: "/" })) }))
      .toBe(false);
  });

  it("ClientID — только цифры", () => {
    expect(ok({ events: [{ type: "ym_client", cid: "12a" }] })).toBe(false);
    expect(ok({ events: [{ type: "ym_client", cid: "1".repeat(33) }] })).toBe(false);
  });
});
