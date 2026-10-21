// @vitest-environment node
// Память о выданных при смене состояния id: пачка со старым id получает тот
// же новый, пока память жива, и не заводит ещё один.
import { describe, expect, it } from "vitest";
import { SWITCH_GUARD_TTL_MS, createSwitchGuard } from "@/lib/analytics/switch-guard";

const OLD = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NEW = "11111111-2222-4333-8444-555555555555";

describe("createSwitchGuard", () => {
  it("помнит выданный id по паре «старый id · аккаунт»", () => {
    const g = createSwitchGuard();
    g.remember(OLD, "u1", NEW, 0);
    expect(g.get(OLD, "u1", 1)).toBe(NEW);
    expect(g.get(OLD, "u2", 1)).toBeNull();
    expect(g.get(OLD, null, 1)).toBeNull();
  });

  it("забывает по сроку", () => {
    const g = createSwitchGuard();
    g.remember(OLD, null, NEW, 0);
    expect(g.get(OLD, null, SWITCH_GUARD_TTL_MS - 1)).toBe(NEW);
    expect(g.get(OLD, null, SWITCH_GUARD_TTL_MS)).toBeNull();
  });

  it("ограничен по размеру: вытесняется самая давняя смена", () => {
    const g = createSwitchGuard(SWITCH_GUARD_TTL_MS, 2);
    g.remember("a", null, "A", 0);
    g.remember("b", null, "B", 0);
    g.remember("c", null, "C", 0);
    expect(g.get("a", null, 1)).toBeNull();
    expect(g.get("c", null, 1)).toBe("C");
  });
});
