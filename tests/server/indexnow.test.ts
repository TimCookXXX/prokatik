// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// scheduleIndexNow: в dev/test ничего не планирует и базу не читает; в проде
// кладёт пинг в after(), а адреса читает уже там — после записи. Адреса до
// записи и после склеиваются без повторов.

const { afterMock, ping, rows, dbSelect } = vi.hoisted(() => {
  const rows = { value: [] as Array<Record<string, string>> };
  // Цепочка drizzle: любые вызовы возвращают её же, await — rows.
  const chain: unknown = new Proxy({}, {
    get: (_t, prop) => (prop === "then"
      ? (resolve: (r: unknown[]) => void) => resolve(rows.value)
      : () => chain),
  });
  return { afterMock: vi.fn(), ping: vi.fn(), rows, dbSelect: vi.fn(() => chain) };
});

vi.mock("next/server", () => ({ after: afterMock }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ select: dbSelect }) }));
// getEnv() в production требует прод-переменных; адрес сайта здесь — константа.
vi.mock("@/lib/site-config", () => ({ siteUrl: () => "https://example.ru" }));
vi.mock("@/lib/indexnow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/indexnow")>()),
  pingIndexNow: ping,
}));

import { currentListingUrls, scheduleIndexNow } from "@/server/indexnow";

const env = process.env as Record<string, string | undefined>;
const ORIG = { NODE_ENV: env.NODE_ENV, INDEXNOW_KEY: env.INDEXNOW_KEY };
const base = "https://example.ru";

beforeEach(() => {
  vi.clearAllMocks();
  rows.value = [{ citySlug: "krasnodar", categorySlug: "dreli", listingSlug: "perforator", listingId: "L1" }];
});
afterEach(() => {
  env.NODE_ENV = ORIG.NODE_ENV;
  env.INDEXNOW_KEY = ORIG.INDEXNOW_KEY;
});

describe("scheduleIndexNow", () => {
  it("вне production — ни after(), ни запроса", async () => {
    env.NODE_ENV = "test";
    env.INDEXNOW_KEY = "abc12345";
    scheduleIndexNow(["L1"]);
    expect(await currentListingUrls(["L1"])).toEqual([]);
    expect(afterMock).not.toHaveBeenCalled();
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it("без ключа — ничего", () => {
    env.NODE_ENV = "production";
    delete env.INDEXNOW_KEY;
    scheduleIndexNow(["L1"]);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("в production адреса читаются в after() и пингуются без повторов", async () => {
    env.NODE_ENV = "production";
    env.INDEXNOW_KEY = "abc12345";
    const now = `${base}/krasnodar/dreli/perforator-L1`;
    scheduleIndexNow(["L1"], [`${base}/kazan/dreli/perforator-L1`, now]);
    expect(afterMock).toHaveBeenCalledTimes(1);
    // До after() база не тронута: адрес после записи читается уже после ответа.
    expect(dbSelect).not.toHaveBeenCalled();
    await (afterMock.mock.calls[0]![0] as () => Promise<void>)();
    expect(ping).toHaveBeenCalledWith([`${base}/kazan/dreli/perforator-L1`, now]);
  });

  // Пинг идёт после ответа: отказ базы не должен ни бросить из after(), ни
  // уронить мутацию, ни отправить пустой пинг.
  it("отказ базы — after() не бросает, пинга нет; адрес до записи — пустой", async () => {
    env.NODE_ENV = "production";
    env.INDEXNOW_KEY = "abc12345";
    const refuse = () => { throw new Error("connection refused"); };
    dbSelect.mockImplementationOnce(refuse).mockImplementationOnce(refuse);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await currentListingUrls(["L1"])).toEqual([]);
      scheduleIndexNow(["L1"]);
      await expect((afterMock.mock.calls[0]![0] as () => Promise<void>)()).resolves.toBeUndefined();
      expect(ping).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("пустой список — ничего не планирует", () => {
    env.NODE_ENV = "production";
    env.INDEXNOW_KEY = "abc12345";
    scheduleIndexNow([]);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("currentListingUrls в production — абсолютные канонические адреса", async () => {
    env.NODE_ENV = "production";
    env.INDEXNOW_KEY = "abc12345";
    expect(await currentListingUrls(["L1"])).toEqual([`${base}/krasnodar/dreli/perforator-L1`]);
  });
});
