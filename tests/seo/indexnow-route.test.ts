// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { GET, dynamic } from "@/app/indexnow.txt/route";
import { _resetEnvCacheForTests } from "@/lib/env";

// Ключ IndexNow отдаётся по фиксированному адресу /indexnow.txt из окружения
// при запросе — не из файла в public/ и не значением со сборки.

const env = process.env as Record<string, string | undefined>;
const ORIG = env.INDEXNOW_KEY;

afterEach(() => {
  env.INDEXNOW_KEY = ORIG;
  _resetEnvCacheForTests();
});

describe("GET /indexnow.txt", () => {
  it("с ключом — 200, text/plain, тело равно ключу", async () => {
    env.INDEXNOW_KEY = "0123456789abcdef0123456789abcdef";
    _resetEnvCacheForTests();
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("0123456789abcdef0123456789abcdef");
  });

  it("без ключа — 404", async () => {
    delete env.INDEXNOW_KEY;
    _resetEnvCacheForTests();
    expect(GET().status).toBe(404);
  });

  it("читается при запросе, а не пререндерится при сборке", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
