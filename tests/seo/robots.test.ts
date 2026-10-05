import { describe, it, expect, beforeEach, afterEach } from "vitest";
import robots from "@/app/robots";
import { _resetEnvCacheForTests } from "@/lib/env";

const env = process.env as Record<string, string | undefined>;
const ORIG = env.NEXTAUTH_URL;

describe("robots()", () => {
  beforeEach(() => {
    env.NEXTAUTH_URL = "https://example.ru/";
    _resetEnvCacheForTests();
  });
  afterEach(() => {
    env.NEXTAUTH_URL = ORIG;
    _resetEnvCacheForTests();
  });

  const rule = () => {
    const result = robots();
    return Array.isArray(result.rules) ? result.rules[0]! : result.rules;
  };

  it("disallow — служебные и личные разделы, без /search, /login и /reset", () => {
    const r = rule();
    expect(r.userAgent).toBe("*");
    expect(r.allow).toBe("/");
    // Служебные ручки закрывает общее правило /api/ — отдельных записей под
    // /api/auth, /api/oauth и /api/dev быть не должно. /search, /login и /reset
    // закрыты noindex: Disallow не дал бы роботу прочитать метатег.
    expect(r.disallow).toEqual(["/admin", "/banned", "/api/", "/cabinet", "/chat", "/profile"]);
  });

  it("Clean-param: даты, «Где», вид, фильтры и метки; без page, q и category", () => {
    const lines = (rule().other?.["Clean-param"] ?? []) as string[];
    expect(lines).toHaveLength(2);
    const params = lines.flatMap((l) => l.split(" ")[0]!.split("&"));
    expect(params).toEqual(expect.arrayContaining([
      "from", "to", "qty", "loc", "la", "src", "lp", "view", "sort", "utm_source", "yclid", "_rsc",
    ]));
    for (const p of ["page", "q", "category"]) expect(params).not.toContain(p);
    // Лимит Яндекса — 500 символов на строку вместе с именем директивы.
    for (const l of lines) expect(`Clean-param: ${l}`.length).toBeLessThanOrEqual(500);
  });

  it("sitemap абсолютный, от NEXTAUTH_URL без двойного слэша; Host не пишется", () => {
    const result = robots();
    expect(result.sitemap).toBe("https://example.ru/sitemap.xml");
    expect(result.host).toBeUndefined();
  });
});
