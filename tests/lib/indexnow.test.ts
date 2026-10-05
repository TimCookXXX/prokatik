import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pingIndexNow } from "@/lib/indexnow";
import { _resetEnvCacheForTests } from "@/lib/env";

const env = process.env as Record<string, string | undefined>;

const ORIGINAL_NODE_ENV = env.NODE_ENV;
const ORIGINAL_INDEXNOW_KEY = env.INDEXNOW_KEY;
const ORIGINAL_NEXTAUTH_URL = env.NEXTAUTH_URL;

describe("pingIndexNow", () => {
  beforeEach(() => {
    _resetEnvCacheForTests();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    env.NODE_ENV = ORIGINAL_NODE_ENV;
    env.INDEXNOW_KEY = ORIGINAL_INDEXNOW_KEY;
    env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
    _resetEnvCacheForTests();
  });

  it("в NODE_ENV=development — fetch не вызывается", async () => {
    env.NODE_ENV = "development";
    env.INDEXNOW_KEY = "abc12345";
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await pingIndexNow(["https://example.ru/p/x"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("в production без INDEXNOW_KEY — fetch не вызывается", async () => {
    env.NODE_ENV = "production";
    delete env.INDEXNOW_KEY;
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await pingIndexNow(["https://example.ru/p/x"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("пустой urls — fetch не вызывается", async () => {
    env.NODE_ENV = "production";
    env.INDEXNOW_KEY = "abc12345";
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await pingIndexNow([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("production + key + urls — POST на yandex.com/indexnow с ключом по /indexnow.txt", async () => {
    env.NODE_ENV = "production";
    env.INDEXNOW_KEY = "abc12345";
    env.NEXTAUTH_URL = "https://example.ru";
    env.DOMAIN = "example.ru";
    env.LETSENCRYPT_EMAIL = "ops@example.ru";
    env.STORAGE_ENDPOINT = "https://s3.timeweb.cloud";
    env.STORAGE_BUCKET = "b";
    env.STORAGE_ACCESS_KEY_ID = "k";
    env.STORAGE_SECRET_ACCESS_KEY = "s";
    env.STORAGE_PUBLIC_BASE = "https://images.example.ru";
    _resetEnvCacheForTests();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await pingIndexNow(["https://example.ru/p/x", "https://example.ru/"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://yandex.com/indexnow");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.host).toBe("example.ru");
    expect(body.key).toBe("abc12345");
    expect(body.keyLocation).toBe("https://example.ru/indexnow.txt");
    expect(body.urlList).toEqual(["https://example.ru/p/x", "https://example.ru/"]);
  });

  it("fetch падает — не пробрасывает ошибку (fire-and-forget)", async () => {
    env.NODE_ENV = "production";
    env.INDEXNOW_KEY = "abc12345";
    env.NEXTAUTH_URL = "https://example.ru";
    env.DOMAIN = "example.ru";
    env.LETSENCRYPT_EMAIL = "ops@example.ru";
    env.STORAGE_ENDPOINT = "https://s3.timeweb.cloud";
    env.STORAGE_BUCKET = "b";
    env.STORAGE_ACCESS_KEY_ID = "k";
    env.STORAGE_SECRET_ACCESS_KEY = "s";
    env.STORAGE_PUBLIC_BASE = "https://images.example.ru";
    _resetEnvCacheForTests();
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    await expect(pingIndexNow(["https://example.ru/x"])).resolves.toBeUndefined();
  });

  describe("код ответа — в лог", () => {
    beforeEach(() => {
      env.NODE_ENV = "production";
      env.INDEXNOW_KEY = "abc12345";
      env.NEXTAUTH_URL = "https://example.ru";
      env.DOMAIN = "example.ru";
      env.LETSENCRYPT_EMAIL = "ops@example.ru";
      env.STORAGE_ENDPOINT = "https://s3.timeweb.cloud";
      env.STORAGE_BUCKET = "b";
      env.STORAGE_ACCESS_KEY_ID = "k";
      env.STORAGE_SECRET_ACCESS_KEY = "s";
      env.STORAGE_PUBLIC_BASE = "https://images.example.ru";
      _resetEnvCacheForTests();
    });

    it.each([200, 202])("%i — принято, info", async (status) => {
      vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status }));
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await pingIndexNow(["https://example.ru/x"]);
      expect(info).toHaveBeenCalledWith(expect.stringContaining(String(status)));
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      [403, "ключ не принят"],
      [422, "не с этого хоста"],
      [429, "слишком много"],
      [500, "неожиданный ответ"],
    ])("%i — warn с расшифровкой", async (status, text) => {
      vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status }));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await pingIndexNow(["https://example.ru/x"]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^\\[indexnow\\] ${status}: .*${text}`)));
    });
  });
});
