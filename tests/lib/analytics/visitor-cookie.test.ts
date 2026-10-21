// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  OPT_OUT_COOKIE, PREVIOUS_VISITORS_COOKIE, PREVIOUS_VISITORS_MAX, VISITOR_COOKIE, isVisitorId, optOutCookieOptions,
  parsePreviousVisitors, previousVisitorsCookieOptions, visitorCookieOptions, withPreviousVisitor,
} from "@/lib/analytics/visitor-cookie";
import { VISITOR_RETENTION_DAYS } from "@/lib/analytics/limits";

describe("isVisitorId", () => {
  it("принимает UUID в любом регистре", () => {
    expect(isVisitorId(crypto.randomUUID())).toBe(true);
    expect(isVisitorId("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe(true);
  });

  it.each([
    undefined, null, 42, "", "not-a-uuid", "0f8fad5b-d9cb-469f-a165-70867728950",
    "0f8fad5b-d9cb-469f-a165-70867728950e ", " 0f8fad5b-d9cb-469f-a165-70867728950e",
    "0f8fad5b-d9cb-469f-a165-70867728950e; noanalytics=1",
  ])("отклоняет %j", (value) => {
    expect(isVisitorId(value)).toBe(false);
  });
});

describe("атрибуты кук", () => {
  it("vid — httpOnly на год, на весь сайт", () => {
    expect(VISITOR_COOKIE).toBe("vid");
    expect(visitorCookieOptions(true)).toEqual({
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365,
    });
    expect(visitorCookieOptions(false).secure).toBe(false);
  });

  // Отказ читают трекер и сниппет Метрики в браузере.
  it("noanalytics читается скриптом и живёт год", () => {
    expect(OPT_OUT_COOKIE).toBe("noanalytics");
    expect(optOutCookieOptions(true)).toEqual({
      httpOnly: false, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365,
    });
  });
});

describe("прежние id браузера (vid_prev)", () => {
  const id = (n: number) => `0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, "0")}`;

  it("новый уходящий id — первым, повтор не дублируется", () => {
    expect(withPreviousVisitor([], id(1))).toBe(id(1));
    expect(parsePreviousVisitors(withPreviousVisitor([id(1), id(2)], id(3)))).toEqual([id(3), id(1), id(2)]);
    expect(parsePreviousVisitors(withPreviousVisitor([id(1), id(2)], id(2).toUpperCase()))).toEqual([id(2), id(1)]);
  });

  it("помнит не больше PREVIOUS_VISITORS_MAX, самые давние отпадают", () => {
    let value = "";
    for (let i = 0; i < PREVIOUS_VISITORS_MAX + 3; i++) value = withPreviousVisitor(parsePreviousVisitors(value), id(i));
    const ids = parsePreviousVisitors(value);
    expect(ids).toHaveLength(PREVIOUS_VISITORS_MAX);
    expect(ids[0]).toBe(id(PREVIOUS_VISITORS_MAX + 2));
    expect(ids).not.toContain(id(0));
  });

  // Кука правится руками: в запрос к базе уходит только UUID.
  it("мусор отбрасывается", () => {
    expect(parsePreviousVisitors(undefined)).toEqual([]);
    expect(parsePreviousVisitors(`${id(1)}.1' or '1'='1.${id(1)}.x`)).toEqual([id(1)]);
  });

  it("httpOnly, на весь сайт, на срок хранения карточки браузера", () => {
    expect(PREVIOUS_VISITORS_COOKIE).toBe("vid_prev");
    expect(previousVisitorsCookieOptions(true)).toEqual({
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: VISITOR_RETENTION_DAYS * 24 * 60 * 60,
    });
  });
});
