// ClientID Метрики в памяти документа: его кладёт в маяк черновика кнопка
// «Забронировать в Telegram» — синхронно, без ожидания счётчика.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetYmClientForTests, requestYmClientId, ymClientIdNow } from "@/components/analytics/ym-client";

beforeEach(() => _resetYmClientForTests());
afterEach(() => {
  delete window.ym;
});

const answer = (cid: unknown) => {
  window.ym = (_id: unknown, method: unknown, cb?: unknown) => {
    if (method === "getClientID") (cb as (v: unknown) => void)(cid);
  };
};

describe("ym-client", () => {
  it("пока счётчик не ответил — null", () => {
    expect(ymClientIdNow()).toBeNull();
  });

  it("ответ счётчика запоминается и уходит в колбэк", () => {
    answer(1697712345123456789n.toString());
    const onValue = vi.fn();
    requestYmClientId(42, onValue);
    expect(onValue).toHaveBeenCalledWith("1697712345123456789");
    expect(ymClientIdNow()).toBe("1697712345123456789");
  });

  it.each([["abc"], [""], [null], ["1".repeat(33)]])("мусор %j — не ClientID", (cid) => {
    answer(cid);
    const onValue = vi.fn();
    requestYmClientId(42, onValue);
    expect(onValue).not.toHaveBeenCalled();
    expect(ymClientIdNow()).toBeNull();
  });

  it("сбой счётчика не бросает", () => {
    window.ym = () => {
      throw new Error("boom");
    };
    expect(() => requestYmClientId(42)).not.toThrow();
    expect(ymClientIdNow()).toBeNull();
  });
});
