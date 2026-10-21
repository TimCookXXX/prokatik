// @vitest-environment node
// Подписанные данные страницы: подпись сходится, подделка и чужой формат
// отклоняются, срок — сутки.
import { describe, expect, it } from "vitest";
import { showKeyOf, signPageData, verifyPageData, type PageData } from "@/lib/analytics/token";
import { TRACK_TOKEN_TTL_HOURS } from "@/lib/analytics/limits";

const NOW = Date.parse("2026-10-21T09:00:00Z");
const HOUR = 60 * 60 * 1000;

const listing: PageData = { k: "listing", listingId: "01JABCDEFGHJKMNPQRSTVWXYZ0", dates: true, where: false };
const search: PageData = {
  k: "search", q: "перфоратор", usedQuery: null, total: 12, matched: 14, reason: null, partial: false,
  cityIds: ["c1"], dates: false, where: false, category: null, filters: false, sort: "relevance", page: 1,
};

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("signPageData / verifyPageData", () => {
  it("подпись сходится: данные и время возвращаются", () => {
    expect(verifyPageData(signPageData(listing, NOW), NOW)).toEqual({ ...listing, ts: NOW / 1000 });
    expect(verifyPageData(signPageData(search, NOW), NOW + HOUR)).toMatchObject(search);
  });

  it("подменённые данные с прежней подписью — нет", () => {
    const [, mac] = signPageData(search, NOW).split(".");
    const forged = `${b64({ ...search, total: 0, reason: "no_match", ts: NOW / 1000 })}.${mac}`;
    expect(verifyPageData(forged, NOW)).toBeNull();
  });

  it("подпись другим ключом или мусор — нет", () => {
    const body = b64({ ...listing, ts: NOW / 1000 });
    expect(verifyPageData(`${body}.${"A".repeat(43)}`, NOW)).toBeNull();
    expect(verifyPageData(`${body}`, NOW)).toBeNull();
    expect(verifyPageData(`${body}.x.y`, NOW)).toBeNull();
    expect(verifyPageData("", NOW)).toBeNull();
  });

  it(`срок — ${TRACK_TOKEN_TTL_HOURS} ч; из будущего — только в пределах сдвига часов`, () => {
    const token = signPageData(listing, NOW);
    expect(verifyPageData(token, NOW + TRACK_TOKEN_TTL_HOURS * HOUR)).not.toBeNull();
    expect(verifyPageData(token, NOW + TRACK_TOKEN_TTL_HOURS * HOUR + 1000)).toBeNull();
    expect(verifyPageData(token, NOW - 60 * 1000)).not.toBeNull();
    expect(verifyPageData(token, NOW - HOUR)).toBeNull();
  });

  it("лишние поля в подписанном — чужой формат, нет", () => {
    const token = signPageData({ ...listing, extra: 1 } as unknown as PageData, NOW);
    expect(verifyPageData(token, NOW)).toBeNull();
  });
});

describe("showKeyOf", () => {
  it("тот же ввод — тот же короткий ключ, другой — другой", () => {
    expect(showKeyOf(["q=a", 1])).toBe(showKeyOf(["q=a", 1]));
    expect(showKeyOf(["q=a", 1])).not.toBe(showKeyOf(["q=a", 2]));
    expect(showKeyOf("x")).toHaveLength(16);
  });
});
