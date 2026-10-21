// @vitest-environment node
// Условие плитки «просмотров за неделю». База не нужна: drizzle рендерит
// запрос в SQL, не исполняя его, — этого хватает, чтобы проверить, что
// считаются только просмотры своей статистики, только по вещам этого
// человека, без ботов и за срок.
import { describe, expect, it, vi } from "vitest";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { visitorEvents, visitors } from "@db/schema";

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/actions/booking", () => ({ expireStaleRequests: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cabinetViewsWhere } from "@/server/cabinet";

const ME = "u-me";
const SINCE = new Date("2026-10-14T09:00:00.000Z");

function render() {
  return new QueryBuilder()
    .select({ id: visitorEvents.id })
    .from(visitorEvents)
    .innerJoin(visitors, eq(visitors.id, visitorEvents.visitorId))
    .where(cabinetViewsWhere(ME, SINCE))
    .toSQL();
}

describe("cabinetViewsWhere", () => {
  // Свои заходы — админ, проверяющий объявления: это не спрос покупателя.
  it("просмотры своей статистики за срок, без ботов и своих заходов", () => {
    const { sql, params } = render();
    expect(sql).toContain('"visitor_events"."type" = $1');
    expect(sql).toContain('"visitor_events"."created_at" >= $2');
    expect(sql).toContain('"visitors"."is_bot" = $3');
    expect(sql).toContain('"visitors"."is_internal" = $4');
    expect(params.slice(0, 4)).toEqual(["view_listing", SINCE.toISOString(), false, false]);
  });

  // Права: чужие вещи в плитку не попадают ни при каком сочетании условий.
  it("только вещи этого человека", () => {
    const { sql, params } = render();
    expect(sql).toMatch(
      /"visitor_events"\."listing_id" in \(select "id" from "listings" where "listings"\."owner_user_id" = \$5\)/,
    );
    expect(params[4]).toBe(ME);
  });

  // Старый журнал events.view_listing писался на каждый рендер, с ботами и
  // повторами; плитка его больше не читает.
  it("журнал сделок events не участвует", () => {
    expect(render().sql).not.toMatch(/"events"\./);
  });
});
