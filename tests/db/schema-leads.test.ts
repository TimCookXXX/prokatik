import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { bookingLeads } from "@db/schema";

// Заявки без аккаунта (ADR 0028). Лид переживает удаление объявления и
// владельца — ссылки set null, снимок остаётся; у visitors FK нет вовсе:
// браузеры чистятся по сроку, а заявка нет.
describe("schema: booking_leads", () => {
  const config = getTableConfig(bookingLeads);

  it("ссылки на объявление и владельца — set null, на браузер — без FK", () => {
    const fks = Object.fromEntries(config.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return [ref.columns.map((c) => c.name).join(","), [getTableConfig(ref.foreignTable).name, fk.onDelete]];
    }));
    expect(fks).toEqual({
      listing_id: ["listings", "set null"],
      owner_user_id: ["users", "set null"],
    });
    expect(bookingLeads.visitorId.getSQLType()).toBe("uuid");
  });

  it("токен и код уникальны и необязательны", () => {
    expect(bookingLeads.startToken.isUnique).toBe(true);
    expect(bookingLeads.code.isUnique).toBe(true);
    expect(bookingLeads.startToken.notNull).toBe(false);
    expect(bookingLeads.code.notNull).toBe(false);
  });

  it("снимок объявления и телефон проката — колонками", () => {
    for (const col of ["listingTitle", "listingPath", "ownerName", "ownerPhone", "total", "internal", "boundAt",
      "groupMessageId", "cardAttempts", "cardClaimedAt", "cardNextAt", "statusChangedAt", "statusChangedBy", "sentAt"]) {
      expect(bookingLeads[col as keyof typeof bookingLeads]).toBeDefined();
    }
    expect(bookingLeads.internal.notNull).toBe(true);
    expect(bookingLeads.tgUserId.getSQLType()).toBe("bigint");
    expect(bookingLeads.groupMessageId.getSQLType()).toBe("bigint");
  });

  it("индексы под чистку, активный черновик и админку; CHECK-и", () => {
    expect(config.indexes.map((i) => i.config.name).sort()).toEqual([
      "booking_leads_sent_idx", "booking_leads_status_created_idx", "booking_leads_tg_user_idx",
    ]);
    expect(config.checks.map((c) => c.name).sort()).toEqual([
      "booking_leads_code_on_send", "booking_leads_dates_order", "booking_leads_price_present",
      "booking_leads_token_on_telegram",
    ]);
  });
});
