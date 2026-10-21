// Трекер своей статистики: пачка на следующем тике, просмотр первым, пачки
// по одной, остаток на pagehide; молчит после отказа, во фрейме и в админке.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reachGoal = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/goals", () => ({ reachGoal }));
import {
  FIRST_PAGEVIEW_WAIT_MS, TRACK_ENDPOINT, TRACK_QUEUE_LIMIT, _resetTrackForTests, track,
} from "@/components/analytics/track";
import { TRACK_BATCH_MAX } from "@/lib/analytics/limits";

type Sent = { url: string; init: RequestInit; body: { events: { type: string; path?: string }[]; bot?: true } };

let sent: Sent[];
let release: (() => void)[];
let holdResponses: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  _resetTrackForTests();
  reachGoal.mockClear();
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
// События без просмотра страницы ждут его до FIRST_PAGEVIEW_WAIT_MS.
const flushAfterWait = async () => {
  await vi.advanceTimersByTimeAsync(FIRST_PAGEVIEW_WAIT_MS);
  await flush();
};

describe("track", () => {
  // Обычная пачка — без keepalive: смена id приходит Set-Cookie ответа, а
  // куку из ответа на keepalive-запрос принимает не каждый браузер.
  it("копит события тика и шлёт одной пачкой обычным POST'ом", async () => {
    track("pageview", { path: "/krasnodar", doc: true });
    track("ym_client", { cid: "123" });
    expect(sent).toHaveLength(0);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(TRACK_ENDPOINT);
    expect(sent[0].init).toMatchObject({ method: "POST", keepalive: false, credentials: "same-origin" });
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

  // Трекер просмотра в layout'е гидратируется позже страницы: её события ждут
  // его, и лента начинается с просмотра со входом.
  it("события первой страницы ждут её просмотр и уходят после него", async () => {
    track("view_listing", { token: "T" });
    await flush();
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(FIRST_PAGEVIEW_WAIT_MS / 2);
    track("pageview", { path: "/krasnodar", doc: true });
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].body.events.map((e) => e.type)).toEqual(["pageview", "view_listing"]);
  });

  it("просмотр так и не пришёл — события уходят после ожидания", async () => {
    track("view_listing", { token: "T" });
    await vi.advanceTimersByTimeAsync(FIRST_PAGEVIEW_WAIT_MS - 10);
    expect(sent).toHaveLength(0);
    await flushAfterWait();
    expect(sent).toHaveLength(1);
  });

  it("после первого просмотра события не ждут", async () => {
    track("pageview", { path: "/" });
    await flush();
    track("view_listing", { token: "T" });
    await flush();
    expect(sent).toHaveLength(2);
  });

  it("pagehide во время ожидания — уходит сразу", () => {
    track("view_listing", { token: "T" });
    window.dispatchEvent(new Event("pagehide"));
    expect(sent).toHaveLength(1);
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

// Одно место вызова на оба счёта: событие своей статистики и цель Метрики.
describe("track: события страницы и цели", () => {
  it("показ выдачи: токен и текущий адрес; zero на сервер не уходит", async () => {
    window.history.replaceState(null, "", "/search?q=a&city=krasnodar");
    track("search", { token: "TOKEN", zero: "no_match" });
    await flushAfterWait();
    expect(sent[0].body.events).toEqual([{ type: "search", path: "/search?q=a&city=krasnodar", token: "TOKEN" }]);
    expect(reachGoal).toHaveBeenCalledWith("search_zero", { reason: "no_match" });
  });

  it("выдача не пуста или нашлась по части слов — цели нет", () => {
    track("search", { token: "T" });
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it("goal: false — только событие", async () => {
    track("search", { token: "T", zero: "filtered" }, { goal: false });
    await flushAfterWait();
    expect(sent).toHaveLength(1);
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it("показ объявления — цель listing_view", async () => {
    track("view_listing", { token: "T" });
    await flushAfterWait();
    expect(sent[0].body.events[0]).toMatchObject({ type: "view_listing", token: "T" });
    expect(reachGoal).toHaveBeenCalledWith("listing_view");
  });

  it("«Забронировать»: цель с authed, на сервер — только токен", async () => {
    track("booking_click", { token: "T", authed: false });
    await flushAfterWait();
    expect(sent[0].body.events).toEqual([{ type: "booking_click", path: "/krasnodar", token: "T" }]);
    expect(reachGoal).toHaveBeenCalledWith("booking_click", { authed: false });
  });

  it("«Забронировать» без токена — только цель", async () => {
    track("booking_click", { authed: true });
    await flushAfterWait();
    expect(fetch).not.toHaveBeenCalled();
    expect(reachGoal).toHaveBeenCalledWith("booking_click", { authed: true });
  });

  // Свои правила у очереди целей (goals.ts): админку и отказ она решает сама.
  it("после отказа событие молчит, цель решает своя очередь", async () => {
    document.cookie = "noanalytics=1; path=/";
    track("view_listing", { token: "T" });
    await flushAfterWait();
    expect(fetch).not.toHaveBeenCalled();
    expect(reachGoal).toHaveBeenCalledWith("listing_view");
  });

  it("просмотр страницы и ClientID целей не дают", () => {
    track("pageview", { path: "/" });
    track("ym_client", { cid: "1" });
    expect(reachGoal).not.toHaveBeenCalled();
  });
});
