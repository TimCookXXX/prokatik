import { describe, it, expect, vi } from "vitest";
import { LEAD_CODE_RE, MAX_CODE_TRIES, leadCode, withLeadCode } from "@/lib/leads/code";

class Collision extends Error {}
const isCollision = (e: unknown) => e instanceof Collision;

describe("leadCode", () => {
  it("INR- и четыре цифры, с ведущими нулями", () => {
    for (let i = 0; i < 200; i++) {
      const code = leadCode();
      expect(code).toMatch(/^INR-\d{4}$/);
      expect(code).toMatch(LEAD_CODE_RE);
    }
  });

  it("после восьми коллизий — пять цифр", () => {
    expect(leadCode(7)).toMatch(/^INR-\d{4}$/);
    expect(leadCode(8)).toMatch(/^INR-\d{5}$/);
    expect(leadCode(12)).toMatch(LEAD_CODE_RE);
  });
});

describe("withLeadCode", () => {
  it("повторяет с новым кодом на коллизии, передаёт число коллизий генератору", async () => {
    const generate = vi.fn((n: number) => `INR-${String(n).padStart(4, "0")}`);
    let calls = 0;
    const result = await withLeadCode(async (code) => {
      calls++;
      if (calls < 3) throw new Collision();
      return code;
    }, isCollision, generate);
    expect(result).toBe("INR-0002");
    expect(generate.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
  });

  it("чужая ошибка уходит сразу", async () => {
    const write = vi.fn(async () => { throw new Error("db down"); });
    await expect(withLeadCode(write, isCollision)).rejects.toThrow("db down");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("сдаётся после MAX_CODE_TRIES попыток", async () => {
    const write = vi.fn(async () => { throw new Collision(); });
    await expect(withLeadCode(write, isCollision)).rejects.toBeInstanceOf(Collision);
    expect(write).toHaveBeenCalledTimes(MAX_CODE_TRIES);
  });
});
