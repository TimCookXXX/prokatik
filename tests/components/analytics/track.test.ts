// Трекер своей статистики: пачка на следующем тике, просмотр первым, пачки
// по одной, остаток на pagehide; молчит после отказа, во фрейме и в админке.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRACK_ENDPOINT, TRACK_QUEUE_LIMIT, _resetTrackForTests, track } from "@/components/analytics/track";
import { TRACK_BATCH_MAX } from "@/lib/analytics/limits";

type Sent = { url: string; init: RequestInit; body: { events: { type: string; path?: string }[]; bot?: true } };

let sent: Sent[];
let release: (() => void)[];
let holdResponses: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  _resetTrackForTests();
  sent = [];
  release = [];
  holdResponses = false;
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    sent.push({ url, init, body: JSON.parse(String(init.body)) });
    if (!holdResponses) return Promise.resolve(new Response(null, { status: 204 }));
    return new Promise((resolve) => release.push(() => resolve(new Response(null, { status: 204 }))));
  }));
  window.history.replaceState(null, "", "/krasnodar");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.cookie = "noanalytics=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  window.history.replaceState(null, "", "/");
});

// Таймер тика, ответ fetch и таймер следующей пачки — несколько оборотов.
const flush = async () => {
  for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(1);
};

describe("track", () => {
  it("копит события тика и шлёт одной пачкой keepalive-POST'ом", async () => {
    track("pageview", { path: "/krasnodar", doc: true });
    track("ym_client", { cid: "123" });
    expect(sent).toHaveLength(0);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(TRACK_ENDPOINT);
    expect(sent[0].init).toMatchObject({ method: "POST", keepalive: true, credentials: "same-origin" });
    expect(sent[0].body.events.map((e) => e.type)).toEqual(["pageview", "ym_client"]);
  });

  it("просмотр страницы — первым среди событий своего тика", async () => {
    track("ym_client", { cid: "1" });
    track("pageview", { path: "/krasnodar" });
    await flush();
    expect(sent[0].body.events.map((e) => e.type)).toEqual(["pageview", "ym_client"]);
  });

  it("пачки по одной: следующая ждёт ответа прошлой", async () => {
    holdResponses = true;
    track("pageview", { path: "/a" });
    await flush();
    track("pageview", { path: "/b" });
    await flush();
    expect(sent).toHaveLength(1);
    release.shift()!();
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1].body.events[0].path).toBe("/b");
  });

  it("не больше TRACK_BATCH_MAX событий в пачке", async () => {
    for (let i = 0; i < TRACK_BATCH_MAX + 3; i++) track("pageview", { path: `/p${i}` });
    await flush();
    expect(sent.map((s) => s.body.events.length)).toEqual([TRACK_BATCH_MAX, 3]);
  });

  it("очередь ограничена", async () => {
    holdResponses = true;
    track("pageview", { path: "/first" });
    await flush();
    for (let i = 0; i < TRACK_QUEUE_LIMIT + 10; i++) track("pageview", { path: `/p${i}` });
    window.dispatchEvent(new Event("pagehide"));
    const queued = sent.slice(1).reduce((n, s) => n + s.body.events.length, 0);
    expect(queued).toBe(TRACK_QUEUE_LIMIT);
  });

  it("pagehide: остаток уходит сразу, не дожидаясь ответа", async () => {
    holdResponses = true;
    track("pageview", { path: "/a" });
    await flush();
    track("pageview", { path: "/b" });
    window.dispatchEvent(new Event("pagehide"));
    expect(sent).toHaveLength(2);
    expect(sent[1].body.events[0].path).toBe("/b");
    expect(sent[1].init.keepalive).toBe(true);
  });

  it("navigator.webdriver — пачка с флагом", async () => {
    Object.defineProperty(navigator, "webdriver", { value: true, configurable: true });
    try {
      track("pageview", { path: "/" });
      await flush();
      expect(sent[0].body.bot).toBe(true);
    } finally {
      Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
    }
  });

  it("без webdriver флага нет", async () => {
    track("pageview", { path: "/" });
    await flush();
    expect(sent[0].body).not.toHaveProperty("bot");
  });

  it("сбой сети не ломает следующие пачки", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    track("pageview", { path: "/a" });
    await flush();
    track("pageview", { path: "/b" });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sent.map((s) => s.body.events[0].path)).toEqual(["/b"]);
  });
});

describe("track молчит", () => {
  it("после отказа от учёта", async () => {
    document.cookie = "noanalytics=1; path=/";
    track("pageview", { path: "/" });
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("в админке", async () => {
    window.history.replaceState(null, "", "/admin/visitors");
    track("pageview", { path: "/admin/visitors" });
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("во фрейме (интерфейс Метрики)", async () => {
    const top = Object.getOwnPropertyDescriptor(window, "top")!;
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    try {
      track("pageview", { path: "/" });
      await flush();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "top", top);
    }
  });
});
