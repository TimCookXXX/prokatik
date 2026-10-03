import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkLimit, MAIL_DAILY_CAP, MAIL_DAILY_KEY, _resetForTests, _storeSizesForTests,
} from "@/lib/rate-limit";

beforeEach(() => { _resetForTests(); });

describe("rate limit: login", () => {
  it("allows ten attempts and refuses the eleventh", () => {
    const key = "a@ya.ru|1.2.3.4";
    for (let i = 0; i < 10; i++) expect(checkLimit(key, "login")).toEqual({ ok: true });

    const res = checkLimit(key, "login");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("window");
      expect(res.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("has no gap between attempts — the counter does the work", () => {
    expect(checkLimit("a@ya.ru|ip", "login")).toEqual({ ok: true });
    expect(checkLimit("a@ya.ru|ip", "login")).toEqual({ ok: true });
  });

  it("keys are independent", () => {
    for (let i = 0; i < 10; i++) checkLimit("a@ya.ru|ip", "login");
    expect(checkLimit("b@ya.ru|ip", "login")).toEqual({ ok: true });
  });
});

describe("rate limit: письма", () => {
  it("puts a pause between resend attempts", () => {
    expect(checkLimit("a@ya.ru", "resend")).toEqual({ ok: true });
    const second = checkLimit("a@ya.ru", "resend");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("gap");
  });

  it("caps reset requests per email", () => {
    expect(checkLimit("a@ya.ru", "reset")).toEqual({ ok: true });
  });

  it("allows ten mail requests per ip", () => {
    for (let i = 0; i < 10; i++) expect(checkLimit("1.2.3.4", "mail_ip")).toEqual({ ok: true });
    expect(checkLimit("1.2.3.4", "mail_ip").ok).toBe(false);
  });

  it("caps the whole service per day on a single shared key", () => {
    // Лимиты по почте и по IP считаются раздельно, поэтому бомбёжка с разных
    // адресов их обходит и выедает суточную квоту SMTP-ящика. Общим этот лимит
    // делает ключ: все отправители приходят с MAIL_DAILY_KEY (см. sendMail).
    for (let i = 0; i < MAIL_DAILY_CAP; i++) {
      expect(checkLimit(MAIL_DAILY_KEY, "mail_daily")).toEqual({ ok: true });
    }
    const over = checkLimit(MAIL_DAILY_KEY, "mail_daily");
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe("window");
  });

  it("keeps the daily cap under the 300 letters Yandex allows over smtp", () => {
    expect(MAIL_DAILY_CAP).toBeLessThan(300);
  });
});

describe("rate limit: чат", () => {
  // Паузы booking (30с) здесь быть не должно: живая переписка идёт очередями
  // коротких реплик, и лимитер не имеет права их резать.
  it("пропускает несколько сообщений подряд без паузы", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkLimit("user-1", "chat_message")).toEqual({ ok: true });
    }
  });

  it("упирается в часовой потолок сообщений", () => {
    let refused = false;
    for (let i = 0; i < 200 && !refused; i++) {
      refused = !checkLimit("user-1", "chat_message").ok;
    }
    expect(refused).toBe(true);
  });

  // Отдельный контур против бота, который пишет первым сотне владельцев:
  // потолок сообщений он бы прошёл, рассылая по одному в разные треды.
  it("ограничивает заведение новых тредов жёстче, чем сообщения", () => {
    let threads = 0;
    while (checkLimit("user-2", "chat_thread").ok) threads++;
    let messages = 0;
    while (checkLimit("user-3", "chat_message").ok) messages++;
    expect(threads).toBeGreaterThan(0);
    expect(threads).toBeLessThan(messages);
  });

  it("считает лимиты по каждому пользователю отдельно", () => {
    while (checkLimit("user-4", "chat_thread").ok);
    expect(checkLimit("user-5", "chat_thread")).toEqual({ ok: true });
  });
});

describe("rate limit: существующие виды", () => {
  it("still limits bookings after the key rename", () => {
    expect(checkLimit("user-1", "booking")).toEqual({ ok: true });
    const second = checkLimit("user-1", "booking");
    expect(second.ok).toBe(false);
  });
});

describe("rate limit: публичные ручки", () => {
  it("allows 300 suggestion requests a minute per ip and refuses the next", () => {
    for (let i = 0; i < 300; i++) expect(checkLimit("1.2.3.4", "search")).toEqual({ ok: true });
    const over = checkLimit("1.2.3.4", "search");
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.reason).toBe("window");
      expect(over.retryAfterSec).toBeLessThanOrEqual(60);
    }
    expect(checkLimit("5.6.7.8", "search")).toEqual({ ok: true });
  });

  // Публичный ключ заводится на каждый анонимный IP. В общем хранилище такой
  // поток вытеснил бы счётчик входа и молча обнулил его — поэтому у публичных
  // видов своё хранилище.
  it("a flood of search keys does not evict a login counter", () => {
    const login = "a@ya.ru|9.9.9.9";
    for (let i = 0; i < 10; i++) checkLimit(login, "login");
    expect(checkLimit(login, "login").ok).toBe(false);

    for (let i = 0; i < 30_000; i++) checkLimit(`10.0.${i >> 8}.${i & 255}`, "search");

    expect(checkLimit(login, "login").ok).toBe(false);
  });

  // Само публичное хранилище ограничено: выжатый ключ, вытесненный потоком
  // новых, забывается. Память держит потолок, а не число IP за сутки.
  it("keeps the public store bounded", () => {
    for (let i = 0; i < 300; i++) checkLimit("1.2.3.4", "search");
    expect(checkLimit("1.2.3.4", "search").ok).toBe(false);

    for (let i = 0; i < 30_000; i++) checkLimit(`10.0.${i >> 8}.${i & 255}`, "search");

    expect(checkLimit("1.2.3.4", "search")).toEqual({ ok: true });
  });

  // Просроченные ключи при заполнении чистятся разом, а не по одному на
  // каждый новый: память освобождается сразу после волны.
  it("sweeps expired keys once the public store is full", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
      for (let i = 0; i < 20_000; i++) checkLimit(`10.1.${i >> 8}.${i & 255}`, "search");
      expect(_storeSizesForTests().public).toBe(20_000);

      vi.setSystemTime(new Date("2026-10-03T12:01:30Z"));
      checkLimit("1.2.3.4", "search");

      expect(_storeSizesForTests().public).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
