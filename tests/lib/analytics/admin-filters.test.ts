// Фильтры страниц аналитики приходят из адреса: мусор падает в умолчание,
// поиск гостя — только точный формат.
import { describe, expect, it } from "vitest";
import {
  analyticsHref, cursorParam, parseAnalyticsFilters, parseFind, parseVisitorListFilters,
} from "@/lib/analytics/admin-filters";

const VID = "d7540424-a1c8-4e80-bb7f-38368f5406b2";

describe("parseAnalyticsFilters", () => {
  it("период 7 или 30, иначе 7; «все» — только all=1", () => {
    expect(parseAnalyticsFilters({})).toEqual({ period: 7, all: false });
    expect(parseAnalyticsFilters({ period: "30", all: "1" })).toEqual({ period: 30, all: true });
    expect(parseAnalyticsFilters({ period: "365", all: "yes" })).toEqual({ period: 7, all: false });
    expect(parseAnalyticsFilters({ period: ["30", "7"] })).toEqual({ period: 30, all: false });
  });
});

describe("parseFind", () => {
  it("ClientID — только цифры, id браузера — UUID в нижнем регистре", () => {
    expect(parseFind("1697712345123456789")).toEqual({ kind: "cid", value: "1697712345123456789" });
    expect(parseFind(VID.toUpperCase())).toEqual({ kind: "vid", value: VID });
  });

  it.each(["%", "1697%", "abc", "' or 1=1 --", "1".repeat(33), `${VID}x`])("«%s» — не поиск", (text) => {
    expect(parseFind(text)).toBeNull();
  });
});

describe("parseVisitorListFilters", () => {
  it("неверный поиск помечается, а не подменяется", () => {
    const f = parseVisitorListFilters({ find: " abc " });
    expect(f.find).toBeNull();
    expect(f.findInvalid).toBe(true);
    expect(f.findText).toBe("abc");
  });

  it("курсор: время с микросекундами и UUID; мусор — нет курсора", () => {
    const at = "2026-10-21T10:00:00.000004";
    expect(parseVisitorListFilters({ after: cursorParam(at, VID) }).cursor).toEqual({ dir: "after", at, id: VID });
    expect(parseVisitorListFilters({ before: cursorParam(at, VID) }).cursor).toEqual({ dir: "before", at, id: VID });
    expect(parseVisitorListFilters({ after: "2026-10-21_x" }).cursor).toBeNull();
    expect(parseVisitorListFilters({ after: `2026-10-21T10:00:00.000_${VID}` }).cursor).toBeNull();
  });

  it("пользователь — только безопасные символы", () => {
    expect(parseVisitorListFilters({ user: "01M41FHZ2YNPA2MT6MSGD8PSZE" }).user).toBe("01M41FHZ2YNPA2MT6MSGD8PSZE");
    expect(parseVisitorListFilters({ user: "a'b" }).user).toBeNull();
  });
});

describe("analyticsHref", () => {
  it("умолчания в адрес не пишутся", () => {
    expect(analyticsHref("/admin/visitors", { period: 7, all: false })).toBe("/admin/visitors");
    expect(analyticsHref("/admin/visitors", { period: 30, all: true, user: "u1", after: "c" }))
      .toBe("/admin/visitors?period=30&all=1&user=u1&after=c");
  });
});
