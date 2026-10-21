// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  OPT_OUT_COOKIE, VISITOR_COOKIE, isVisitorId, optOutCookieOptions, visitorCookieOptions,
} from "@/lib/analytics/visitor-cookie";

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
