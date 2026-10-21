// @vitest-environment node
// POST /api/analytics: ответ всегда 204, а запись — только у своего сайта, не
// бота, с id браузера, в пределах лимитов и схемы. Смена id при входе, выходе
// и смене аккаунта, наследование пометки «свои». База и auth() — моки; after()
// копит колбэки, тест исполняет их сам.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  after: [] as (() => unknown)[],
  stored: null as null | { userId: string | null; isInternal: boolean; ymClientId: string | null; hasEvents: boolean },
  capOk: true,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    state.after.push(fn);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/server/visitor-analytics", () => ({
  readVisitor: vi.fn(async () => state.stored),
  writeVisitorBatch: vi.fn(async () => {}),
  pruneVisitorData: vi.fn(async () => {}),
  dbErrorCode: () => "x",
}));
vi.mock("@/lib/analytics/daily-cap", () => ({
  visitorEventsCap: { take: vi.fn(() => state.capOk), reachedToday: () => false },
}));

import { POST } from "@/app/api/analytics/route";
import { auth } from "@/lib/auth";
import { pruneVisitorData, readVisitor, writeVisitorBatch, type VisitorWrite } from "@/server/visitor-analytics";
import { _resetForTests } from "@/lib/rate-limit";
import { TRACK_BODY_MAX_BYTES } from "@/lib/analytics/limits";

const VID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ORIGIN = "http://localhost:3000";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";
const PAGEVIEW = { events: [{ type: "pageview", path: "/krasnodar?utm_source=x", doc: true, ref: "https://ya.ru/" }] };

interface Opts {
  body?: unknown;
  raw?: string;
  cookie?: string;
  vid?: string | null;
  headers?: Record<string, string>;
  ip?: string;
}

function request({ body = PAGEVIEW, raw, cookie = "", vid = VID, headers = {}, ip = "1.2.3.4" }: Opts = {}) {
  const cookies = [vid ? `vid=${vid}` : "", cookie].filter(Boolean).join("; ");
  return new NextRequest(`${ORIGIN}/api/analytics`, {
    method: "POST",
    body: raw ?? JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "user-agent": UA,
      "x-forwarded-for": ip,
      ...(cookies ? { cookie: cookies } : {}),
      ...headers,
    },
  });
}

async function send(opts?: Opts) {
  const res = await POST(request(opts));
  for (const fn of state.after.splice(0)) await fn();
  return res;
}

const written = (): VisitorWrite[] => vi.mocked(writeVisitorBatch).mock.calls.map((c) => c[0]);
const lastWrite = () => written().at(-1)!;
const SESSION = "authjs.session-token=tok";
const signedIn = (id: string, role: "user" | "admin" = "user") =>
  vi.mocked(auth).mockResolvedValue({ user: { id, role } } as never);

beforeEach(() => {
  _resetForTests();
  state.after = [];
  state.stored = null;
  state.capOk = true;
  vi.mocked(auth).mockReset();
  vi.mocked(auth).mockResolvedValue(null as never);
  vi.mocked(writeVisitorBatch).mockClear();
  vi.mocked(readVisitor).mockClear();
  vi.mocked(pruneVisitorData).mockClear();
});

describe("POST /api/analytics: приём", () => {
  it("пишет просмотр: путь очищен, вход разобран, ответ 204 без тела", async () => {
    const res = await send();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("set-cookie")).toBeNull();
    const w = lastWrite();
    expect(w.id).toBe(VID);
    expect(w.userId).toBeNull();
    expect(w.device).toBe("desktop");
    expect(w.isBot).toBe(false);
    expect(w.firstSource).toEqual({ kind: "campaign", label: "x" });
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({
      type: "pageview", path: "/krasnodar",
      props: { doc: true, ref: "ya.ru", src: { kind: "campaign", label: "x" }, utm: { utm_source: "x" } },
    });
    expect(pruneVisitorData).toHaveBeenCalledTimes(1);
  });

  it("порядок пачки сохраняется, время и id назначены до записи", async () => {
    await send({ body: { events: [
      { type: "pageview", path: "/" }, { type: "pageview", path: "/krasnodar" }, { type: "pageview", path: "/search?q=a" },
    ] } });
    const events = lastWrite().events;
    expect(events.map((e) => e.path)).toEqual(["/", "/krasnodar", "/search?q=a"]);
    expect([...events.map((e) => e.id)].sort()).toEqual(events.map((e) => e.id));
    expect(new Set(events.map((e) => e.createdAt.getTime())).size).toBe(1);
  });

  it("navigator.webdriver — гость помечается ботом", async () => {
    await send({ body: { ...PAGEVIEW, bot: true } });
    expect(lastWrite().isBot).toBe(true);
  });

  it("адрес админки не пишется; пачка из одного такого — без записи", async () => {
    await send({ body: { events: [{ type: "pageview", path: "/admin/visitors" }] } });
    expect(writeVisitorBatch).not.toHaveBeenCalled();
    expect(readVisitor).not.toHaveBeenCalled();
  });

  it("Sec-Fetch-Site: same-origin — свой сайт и без Origin", async () => {
    const res = await POST(new NextRequest(`${ORIGIN}/api/analytics`, {
      method: "POST",
      body: JSON.stringify(PAGEVIEW),
      headers: { "sec-fetch-site": "same-origin", "user-agent": UA, cookie: `vid=${VID}` },
    }));
    for (const fn of state.after.splice(0)) await fn();
    expect(res.status).toBe(204);
    expect(writeVisitorBatch).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/analytics: отказ без записи", () => {
  it.each<[string, Opts]>([
    ["чужой Origin", { headers: { origin: "https://evil.example" } }],
    ["Sec-Fetch-Site: cross-site", { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }],
    ["бот", { headers: { "user-agent": "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)" } }],
    ["безголовый Chrome", { headers: { "user-agent": "Mozilla/5.0 HeadlessChrome/130.0" } }],
    ["без User-Agent", { headers: { "user-agent": "" } }],
    ["нет vid", { vid: null }],
    ["vid не UUID", { vid: "1' or '1'='1" }],
    ["отказ от учёта", { cookie: "noanalytics=1" }],
    ["не JSON", { raw: "{events:" }],
    ["не по схеме", { body: { events: [{ type: "pageview", path: "/", extra: 1 }] } }],
    ["тело больше потолка", { raw: JSON.stringify({ events: [{ type: "pageview", path: "/", ref: "a".repeat(TRACK_BODY_MAX_BYTES) }] }) }],
  ])("%s → 204, ничего не пишется", async (_name, opts) => {
    const res = await send(opts);
    expect(res.status).toBe(204);
    expect(writeVisitorBatch).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("Content-Length больше потолка — тело не читается", async () => {
    const res = await send({ headers: { "content-length": String(TRACK_BODY_MAX_BYTES + 1) } });
    expect(res.status).toBe(204);
    expect(writeVisitorBatch).not.toHaveBeenCalled();
  });

  it("сбой чтения базы — 204 без записи", async () => {
    vi.mocked(readVisitor).mockRejectedValueOnce(new Error("db down"));
    const res = await send();
    expect(res.status).toBe(204);
    expect(writeVisitorBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/analytics: лимиты", () => {
  it("track: 300 в минуту на IP", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    for (let i = 0; i < 300; i++) {
      await send({ vid: `0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, "0")}` });
    }
    expect(writeVisitorBatch).toHaveBeenCalledTimes(300);
    await send({ vid: "0f8fad5b-d9cb-469f-a165-999999999999" });
    expect(writeVisitorBatch).toHaveBeenCalledTimes(300);
  });

  it("track_vid: 60 в минуту на браузер", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    for (let i = 0; i < 60; i++) await send({ ip: `10.0.0.${i}` });
    expect(writeVisitorBatch).toHaveBeenCalledTimes(60);
    await send({ ip: "10.0.1.1" });
    expect(writeVisitorBatch).toHaveBeenCalledTimes(60);
  });

  it("track_new: 20 новых гостей в час на IP, известные пишутся дальше", async () => {
    for (let i = 0; i < 21; i++) {
      await send({ vid: `0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, "0")}` });
    }
    expect(writeVisitorBatch).toHaveBeenCalledTimes(20);
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    await send();
    expect(writeVisitorBatch).toHaveBeenCalledTimes(21);
  });

  it("суточный потолок — события отбрасываются", async () => {
    state.capOk = false;
    await send();
    expect(writeVisitorBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/analytics: связка с аккаунтом", () => {
  it("новая строка с сессией — сразу связана, первым событием «вошёл»", async () => {
    signedIn("u1");
    const res = await send({ cookie: SESSION });
    expect(res.headers.get("set-cookie")).toBeNull();
    const w = lastWrite();
    expect(w.id).toBe(VID);
    expect(w.userId).toBe("u1");
    expect(w.events.map((e) => e.type)).toEqual(["login", "pageview"]);
  });

  it("гость без событий вошёл — связывается эта же строка", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: false };
    signedIn("u1");
    const res = await send({ cookie: SESSION });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(lastWrite()).toMatchObject({ id: VID, userId: "u1" });
    expect(lastWrite().events[0].type).toBe("login");
  });

  it("гость с историей вошёл — новый vid; старый кончается «вошёл» без аккаунта", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: "123", hasEvents: true };
    signedIn("u1");
    const res = await send({ cookie: SESSION });
    const cookie = res.headers.get("set-cookie")!;
    const newVid = /vid=([0-9a-f-]{36})/.exec(cookie)![1];
    expect(newVid).not.toBe(VID);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    const w = lastWrite();
    expect(w.id).toBe(newVid);
    expect(w.userId).toBe("u1");
    expect(w.events.map((e) => e.type)).toEqual(["login", "pageview"]);
    expect(w.previous).toMatchObject({ id: VID, markInternal: false });
    expect(w.previous!.events.map((e) => e.type)).toEqual(["login"]);
    // Вход старого id — раньше событий нового.
    expect(w.previous!.events[0].id < w.events[0].id).toBe(true);
  });

  it("аккаунт сменился — новый vid под новый аккаунт", async () => {
    state.stored = { userId: "u1", isInternal: false, ymClientId: null, hasEvents: true };
    signedIn("u2");
    const res = await send({ cookie: SESSION });
    expect(res.headers.get("set-cookie")).toMatch(/vid=/);
    const w = lastWrite();
    expect(w.id).not.toBe(VID);
    expect(w.userId).toBe("u2");
    expect(w.previous).toBeUndefined();
    expect(w.events[0].type).toBe("login");
  });

  it("вышел — новый гостевой vid без «вошёл»", async () => {
    state.stored = { userId: "u1", isInternal: false, ymClientId: null, hasEvents: true };
    const res = await send();
    expect(res.headers.get("set-cookie")).toMatch(/vid=/);
    const w = lastWrite();
    expect(w.id).not.toBe(VID);
    expect(w.userId).toBeNull();
    expect(w.events.map((e) => e.type)).toEqual(["pageview"]);
  });

  it("смена vid — тоже новая строка: под лимитом track_new", async () => {
    state.stored = { userId: "u1", isInternal: false, ymClientId: null, hasEvents: true };
    for (let i = 0; i < 21; i++) await send();
    expect(writeVisitorBatch).toHaveBeenCalledTimes(20);
  });

  it("вход админа — свои заходы, и прежний гостевой id тоже", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    signedIn("admin1", "admin");
    await send({ cookie: SESSION });
    expect(lastWrite().isInternal).toBe(true);
    expect(lastWrite().previous!.markInternal).toBe(true);
  });

  it("пометка «свои» переходит на новый id и при выходе", async () => {
    state.stored = { userId: "admin1", isInternal: true, ymClientId: null, hasEvents: true };
    await send();
    expect(lastWrite().userId).toBeNull();
    expect(lastWrite().isInternal).toBe(true);
  });

  it("мусорная кука сессии: auth() один раз, дальше — из кеша", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    await send({ cookie: "authjs.session-token=garbage-1" });
    await send({ cookie: "authjs.session-token=garbage-1" });
    expect(auth).toHaveBeenCalledTimes(1);
    expect(written().every((w) => w.userId === null)).toBe(true);
  });

  it("без куки сессии auth() не зовётся", async () => {
    await send();
    expect(auth).not.toHaveBeenCalled();
  });
});

describe("POST /api/analytics: ClientID Метрики", () => {
  const YM = { events: [{ type: "ym_client", cid: "1697712345123456789" }] };

  it("новый — событием и в строку гостя", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: "1", hasEvents: true };
    await send({ body: YM });
    expect(lastWrite().ymClientId).toBe("1697712345123456789");
    expect(lastWrite().events).toMatchObject([{ type: "ym_client", props: { cid: "1697712345123456789" } }]);
  });

  it("тот же — ничего не пишется", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: "1697712345123456789", hasEvents: true };
    await send({ body: YM });
    expect(writeVisitorBatch).not.toHaveBeenCalled();
  });

  it("у аккаунта не хранится", async () => {
    state.stored = { userId: "u1", isInternal: false, ymClientId: null, hasEvents: true };
    signedIn("u1");
    await send({ body: { events: [...PAGEVIEW.events, ...YM.events] }, cookie: SESSION });
    expect(lastWrite().ymClientId).toBeNull();
    expect(lastWrite().events.map((e) => e.type)).toEqual(["pageview"]);
  });
});
