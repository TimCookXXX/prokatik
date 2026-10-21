import { describe, it, expect } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { visitors, visitorEvents } from "@db/schema";

// Своя статистика посещений. Удаление аккаунта обязано уносить его историю
// целиком — это обещание политики, а держит его только каскад в схеме. Чужую
// историю каскад не задевает, потому что у браузера один id на одно
// состояние: в общем компьютере гость и каждый аккаунт — разные строки.

function foreignKeys(table: PgTable): Record<string, { table: string; onDelete: string | undefined }> {
  return Object.fromEntries(getTableConfig(table).foreignKeys.map((fk) => {
    const ref = fk.reference();
    return [ref.columns.map((c) => c.name).join(","), {
      table: getTableConfig(ref.foreignTable).name,
      onDelete: fk.onDelete,
    }];
  }));
}

describe("schema: visitor analytics", () => {
  it("браузер аккаунта удаляется вместе с аккаунтом", () => {
    expect(foreignKeys(visitors)).toEqual({
      user_id: { table: "users", onDelete: "cascade" },
    });
  });

  it("события уходят с браузером и с аккаунтом, а удаление вещи их не трогает", () => {
    expect(foreignKeys(visitorEvents)).toEqual({
      visitor_id: { table: "visitors", onDelete: "cascade" },
      user_id: { table: "users", onDelete: "cascade" },
      listing_id: { table: "listings", onDelete: "set null" },
    });
  });

  it("id браузера — uuid, как кука vid; у гостя нет аккаунта", () => {
    expect(visitors.id.getSQLType()).toBe("uuid");
    expect(visitorEvents.visitorId.getSQLType()).toBe("uuid");
    expect(visitors.userId.notNull).toBe(false);
    expect(visitorEvents.userId.notNull).toBe(false);
  });

  // Без индекса по user_id каскад при удалении аккаунта шёл бы сиквеншл-сканом,
  // а чистка по сроку — по created_at и last_seen_at.
  it("индексы под каскад, чистку и чтения админки", () => {
    expect(getTableConfig(visitors).indexes.map((i) => i.config.name).sort()).toEqual([
      "visitors_last_seen_idx", "visitors_user_idx", "visitors_ym_client_idx",
    ]);
    expect(getTableConfig(visitorEvents).indexes.map((i) => i.config.name).sort()).toEqual([
      "visitor_events_created_idx", "visitor_events_listing_idx", "visitor_events_type_idx",
      "visitor_events_user_idx", "visitor_events_visitor_idx", "visitor_events_ym_client_idx",
    ]);
  });
});
