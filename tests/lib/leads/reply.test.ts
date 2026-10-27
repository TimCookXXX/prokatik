import { describe, expect, it } from "vitest";
import { content } from "@theme/content";
import { leadReply } from "@/lib/leads/reply";
import { businessHour } from "@/lib/catalog/dates";

const r = content.booking.leadReply;
// Москва — UTC+3 круглый год.
const msk = (hhmm: string) => new Date(`2026-10-28T${hhmm}:00+03:00`);

describe("leadReply", () => {
  it("час берётся в деловой зоне, а не в зоне процесса", () => {
    expect(businessHour(msk("00:30"))).toBe(0);
    expect(businessHour(msk("23:59"))).toBe(23);
  });

  it("с 9:00 до 21:00 — «5 минут», иначе — «прокаты спят»", () => {
    expect(leadReply(msk("08:59"))).toBe(r.night);
    expect(leadReply(msk("09:00"))).toBe(r.day);
    expect(leadReply(msk("20:59"))).toBe(r.day);
    expect(leadReply(msk("21:00"))).toBe(r.night);
    expect(leadReply(msk("03:00"))).toBe(r.night);
  });
});
