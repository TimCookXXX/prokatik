// @vitest-environment node
// POST /api/analytics: ответ всегда 204, а запись — только у своего сайта, не
// бота, с id браузера, в пределах лимитов и схемы. Смена id при входе, выходе
// и смене аккаунта, наследование пометки «свои». База и auth() — моки; after()
// копит колбэки, тест исполняет их сам.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  after: [] as (() => unknown)[],
  stored: null as null | {
    userId: string | null; isInternal: boolean; ymClientId: string | null; hasEvents: boolean; lastSeenAt?: Date;
  },
  sessionLive: false,
}));
const LAST_SEEN = new Date("2026-10-20T08:00:00.000Z");

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    state.after.push(fn);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/server/visitor-analytics", () => ({
  readVisitor: vi.fn(async () => (state.stored ? { lastSeenAt: LAST_SEEN, ...state.stored } : null)),
  writeVisitorBatch: vi.fn(async () => "created"),
  sessionTokenLive: vi.fn(async () => state.sessionLive),
  pruneVisitorData: vi.fn(async () => {}),
  dbErrorCode: () => "x",
}));

import { POST } from "@/app/api/analytics/route";
import { auth } from "@/lib/auth";
import {
  pruneVisitorData, readVisitor, sessionTokenLive, writeVisitorBatch, type VisitorWrite,
} from "@/server/visitor-analytics";
import { _resetForTests } from "@/lib/rate-limit";
import { TRACK_BODY_MAX_BYTES, TRACK_TOKEN_TTL_HOURS } from "@/lib/analytics/limits";
import { signPageData, type PageData } from "@/lib/analytics/token";
import { decodeTime } from "ulid";
import { visitorSwitchGuard } from "@/lib/analytics/switch-guard";
import { _resetVisitorCapsForTests, visitorEventsCap } from "@/lib/analytics/daily-cap";
import { DAILY_EVENTS_PER_IP, DAILY_EVENTS_PER_VISITOR, TRACK_BATCH_MAX } from "@/lib/analytics/limits";

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
  _resetVisitorCapsForTests();
  state.sessionLive = false;
  visitorSwitchGuard.clear();
  vi.mocked(sessionTokenLive).mockClear();
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
    const take = vi.spyOn(visitorEventsCap, "take").mockReturnValueOnce(false);
    await send();
    expect(writeVisitorBatch).not.toHaveBeenCalled();
    take.mockRestore();
  });

  // Лимиты запросов считают пачки, а в пачке до TRACK_BATCH_MAX событий: без
  // долей по событиям один скрипт выбрал бы общий потолок за минуты.
  const FULL = { events: Array.from({ length: TRACK_BATCH_MAX }, (_, i) => ({ type: "pageview", path: `/p${i}` })) };
  const vidN = (i: number) => `0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, "0")}`;

  it("доля браузера в сутки — по событиям, а не по пачкам", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    const batches = DAILY_EVENTS_PER_VISITOR / TRACK_BATCH_MAX;
    for (let i = 0; i < batches; i++) await send({ body: FULL, ip: `10.0.${i}.1` });
    expect(writeVisitorBatch).toHaveBeenCalledTimes(batches);
    await send({ body: FULL, ip: "10.9.9.9" });
    expect(writeVisitorBatch).toHaveBeenCalledTimes(batches);
    // Другой браузер пишется дальше.
    await send({ body: FULL, vid: vidN(1), ip: "10.9.9.9" });
    expect(writeVisitorBatch).toHaveBeenCalledTimes(batches + 1);
  });

  it("доля IP в сутки — и с разных id браузера", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    const batches = DAILY_EVENTS_PER_IP / TRACK_BATCH_MAX;
    for (let i = 0; i < batches; i++) await send({ body: FULL, vid: vidN(i % 10) });
    expect(writeVisitorBatch).toHaveBeenCalledTimes(batches);
    await send({ body: FULL, vid: vidN(99) });
    expect(writeVisitorBatch).toHaveBeenCalledTimes(batches);
    await send({ body: FULL, vid: vidN(99), ip: "5.6.7.8" });
    expect(writeVisitorBatch).toHaveBeenCalledTimes(batches + 1);
  });
});

describe("POST /api/analytics: связка с аккаунтом", () => {
  // Вход мог быть и раньше, до учёта этого браузера (выкат, «Учитывать
  // снова»): отметка — «пришёл уже в аккаунте», и только если строку завела
  // эта запись.
  it("новая строка с сессией — сразу с аккаунтом, первым событием «вошёл» via create", async () => {
    signedIn("u1");
    const res = await send({ cookie: SESSION });
    expect(res.headers.get("set-cookie")).toBeNull();
    const w = lastWrite();
    expect(w.id).toBe(VID);
    expect(w.userId).toBe("u1");
    expect(w.login).toMatchObject({ type: "login", props: { via: "create" } });
    expect(w.events.map((e) => e.type)).toEqual(["pageview"]);
    expect(w.login!.id < w.events[0].id).toBe(true);
  });

  // Строка без событий — гость, чью историю удалил срок хранения: на месте
  // не связывается, иначе его первый заход и источник стали бы аккаунтовыми.
  it("гость без событий вошёл — новый vid, без отметки входа у гостя", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: false };
    signedIn("u1");
    const res = await send({ cookie: SESSION });
    expect(res.cookies.get("vid")?.value).not.toBe(VID);
    expect(lastWrite()).toMatchObject({ userId: "u1", previous: undefined });
    expect(lastWrite().id).not.toBe(VID);
    expect(lastWrite().login).toMatchObject({ props: { via: "switch" } });
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
    expect(w.login).toMatchObject({ type: "login", props: { via: "switch" } });
    expect(w.events.map((e) => e.type)).toEqual(["pageview"]);
    expect(w.previous).toMatchObject({ id: VID, markInternal: false });
    expect(w.previous!.events.map((e) => e.type)).toEqual(["login"]);
  });

  // Первая страница после входа Яндекс ID — с referrer'ом oauth.yandex.ru, после
  // входа почтой — клиентский переход: ни то ни другое не «откуда пришёл».
  it("строка, заведённая сменой id, начинается со входа или выхода, а не с referrer'а", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    signedIn("u1");
    const oauth = { events: [{ type: "pageview", path: "/", doc: true, ref: "https://oauth.yandex.ru/authorize" }] };
    await send({ body: oauth, cookie: SESSION });
    expect(lastWrite().firstSource).toEqual({ kind: "account", label: "login" });

    visitorSwitchGuard.clear();
    state.stored = { userId: "u1", isInternal: false, ymClientId: null, hasEvents: true };
    vi.mocked(auth).mockResolvedValue(null as never);
    await send({ vid: "22222222-2222-4333-8444-555555555555" });
    expect(lastWrite().firstSource).toEqual({ kind: "account", label: "logout" });

    signedIn("u2");
    await send({ vid: "33333333-2222-4333-8444-555555555555", cookie: SESSION });
    expect(lastWrite().firstSource).toEqual({ kind: "account", label: "account" });
  });

  // Общий момент и соседние id связали бы гостевую строку со строкой
  // аккаунта, а история до входа с аккаунтом не связывается.
  it("отметка входа у гостя — временем его последнего захода, без общего ключа со строкой аккаунта", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    signedIn("u1");
    await send({ cookie: SESSION });
    const w = lastWrite();
    const [mark] = w.previous!.events;
    expect(mark.createdAt.getTime()).toBe(LAST_SEEN.getTime() + 1);
    expect(mark.createdAt.getTime()).not.toBe(w.at.getTime());
    expect(w.login!.createdAt.getTime()).toBe(w.at.getTime());
    // Первые 10 знаков ULID — время: у отметки оно своё, а не время входа.
    expect(mark.id.slice(0, 10)).not.toBe(w.login!.id.slice(0, 10));
    expect(decodeTime(mark.id)).toBe(LAST_SEEN.getTime() + 1);
  });

  // Пока браузер не принял новый id, пачки идут со старым: та же смена, а не новая.
  it("пачка со старым id после смены — тот же новый id, без второго «вошёл» и без track_new", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    signedIn("u1");
    const first = await send({ cookie: SESSION });
    const newVid = first.cookies.get("vid")!.value;
    const second = await send({ cookie: SESSION });
    expect(second.cookies.get("vid")?.value).toBe(newVid);
    expect(second.cookies.get("vid_prev")?.value).toBe(VID);
    const w = lastWrite();
    expect(w.id).toBe(newVid);
    expect(w.previous).toBeUndefined();
    expect(w.login).toMatchObject({ props: { via: "switch" } });
    // track_new — 20 в час: повторы старого id его не тратят.
    for (let i = 0; i < 25; i++) await send({ cookie: SESSION });
    expect(written().every((x) => x.id === newVid)).toBe(true);
    expect(written()).toHaveLength(27);
  });

  // Отказ от учёта удаляет и строки прежних id: связь живёт только в браузере.
  it("смена vid — прежний id дописывается в vid_prev первым", async () => {
    const OLDER = "11111111-2222-4333-8444-555555555555";
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    signedIn("u1");
    const res = await send({ cookie: `${SESSION}; vid_prev=${OLDER}` });
    const prev = res.cookies.get("vid_prev");
    expect(prev?.value).toBe(`${VID}.${OLDER}`);
    expect(prev).toMatchObject({ httpOnly: true, path: "/" });
    expect(res.cookies.get("vid")?.value).not.toBe(VID);
  });

  it("без смены vid кука vid_prev не трогается", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    const res = await send();
    expect(res.cookies.get("vid_prev")).toBeUndefined();
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
    expect(w.login).toMatchObject({ type: "login", props: { via: "switch" } });
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
    for (let i = 0; i < 21; i++) await send({ vid: `0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, "0")}` });
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

  // Компьютер, с которого заходил админ: его гостевой браузер помечен своим,
  // но покупатель, вошедший с него, — не свой.
  it("на чужой аккаунт пометка «свои» не переходит", async () => {
    state.stored = { userId: null, isInternal: true, ymClientId: null, hasEvents: true };
    signedIn("customer1");
    await send({ cookie: SESSION });
    expect(lastWrite().userId).toBe("customer1");
    expect(lastWrite().isInternal).toBe(false);
  });

  it("мусорная кука сессии: auth() один раз, дальше — из кеша", async () => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
    await send({ cookie: "authjs.session-token=garbage-1" });
    await send({ cookie: "authjs.session-token=garbage-1" });
    expect(auth).toHaveBeenCalledTimes(1);
    expect(written().every((w) => w.userId === null)).toBe(true);
  });

  // Auth.js отвечает «нет сессии» и на сбой базы. Поверить ему — сменить id
  // браузера (ложный выход) и помнить «нет» 10 минут.
  it("auth() ответил «нет», а сессия в базе жива — пачка теряется, id не меняется, «нет» не кешируется", async () => {
    state.stored = { userId: "u1", isInternal: false, ymClientId: null, hasEvents: true };
    state.sessionLive = true;
    const res = await send({ cookie: SESSION });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(writeVisitorBatch).not.toHaveBeenCalled();
    signedIn("u1");
    await send({ cookie: SESSION });
    expect(auth).toHaveBeenCalledTimes(2);
    expect(lastWrite()).toMatchObject({ id: VID, userId: "u1" });
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

describe("POST /api/analytics: подписанные данные страницы", () => {
  const LISTING: PageData = { k: "listing", listingId: "01JABCDEFGHJKMNPQRSTVWXYZ0", dates: true, where: false };
  const SEARCH: PageData = {
    k: "search", q: "перфоратор макита hr9999", usedQuery: "перфоратор макита", total: 3, matched: 3,
    reason: null, partial: true, cityIds: ["c1"], dates: false, where: true, category: "tools",
    filters: false, sort: "relevance", page: 1,
  };
  const one = (type: string, token: string, path = "/search?q=x&city=krasnodar") => ({ events: [{ type, path, token }] });

  beforeEach(() => {
    state.stored = { userId: null, isInternal: false, ymClientId: null, hasEvents: true };
  });

  it("показ выдачи: q и total — колонками, посчитанное — в props", async () => {
    await send({ body: one("search", signPageData(SEARCH)) });
    expect(lastWrite().events).toEqual([expect.objectContaining({
      type: "search", path: "/search?q=x&city=krasnodar", q: "перфоратор макита hr9999", total: 3,
      props: {
        matched: 3, partial: true, usedQuery: "перфоратор макита", cityIds: ["c1"],
        dates: false, where: true, category: "tools", filters: false, sort: "relevance", page: 1,
      },
    })]);
  });

  it("нашлось по части запроса — и эта часть маскируется, как q", async () => {
    await send({ body: one("search", signPageData({ ...SEARCH, q: "дрель 912 345-67-89", usedQuery: "дрель 912 345-67-89" })) });
    const [event] = lastWrite().events;
    expect(event.q).toBe("дрель ***");
    expect(event.props).toMatchObject({ partial: true, usedQuery: "дрель ***" });
  });

  it("пустая выдача — причина; пустой запрос — q пустой", async () => {
    await send({ body: one("search", signPageData({ ...SEARCH, q: "", usedQuery: null, partial: false, total: 0, reason: "empty_city" })) });
    const [event] = lastWrite().events;
    expect(event.q).toBeNull();
    expect(event.total).toBe(0);
    expect(event.props).toMatchObject({ reason: "empty_city" });
    expect(event.props).not.toHaveProperty("partial");
  });

  it("просмотр объявления — id из токена", async () => {
    await send({ body: one("view_listing", signPageData(LISTING), "/krasnodar/tools/drill-01JABCDEFGHJKMNPQRSTVWXYZ0") });
    expect(lastWrite().events).toEqual([expect.objectContaining({
      type: "view_listing", listingId: LISTING.listingId, props: { dates: true, where: false },
    })]);
  });

  it("«Забронировать»: объявление из токена, «в аккаунте» — по сессии, а не по слову браузера", async () => {
    await send({ body: one("booking_click", signPageData(LISTING), "/krasnodar/tools/x") });
    expect(lastWrite().events[0]).toMatchObject({ type: "booking_click", listingId: LISTING.listingId, props: { authed: false } });

    state.stored = { userId: "u1", isInternal: false, ymClientId: null, hasEvents: true };
    signedIn("u1");
    await send({ body: one("booking_click", signPageData(LISTING), "/krasnodar/tools/x"), cookie: SESSION });
    expect(lastWrite().events[0]).toMatchObject({ props: { authed: true } });
  });

  it.each<[string, () => { events: unknown[] }]>([
    ["подделанный токен", () => {
      const [, mac] = signPageData(SEARCH).split(".");
      const body = Buffer.from(JSON.stringify({ ...SEARCH, total: 0, reason: "no_match", ts: Math.floor(Date.now() / 1000) })).toString("base64url");
      return one("search", `${body}.${mac}`);
    }],
    ["токен объявления у поиска", () => one("search", signPageData(LISTING))],
    ["токен выдачи у просмотра", () => one("view_listing", signPageData(SEARCH))],
    ["просроченный", () => one("view_listing", signPageData(LISTING, Date.now() - (TRACK_TOKEN_TTL_HOURS + 1) * 3600_000))],
  ])("%s — событие отбрасывается", async (_name, body) => {
    await send({ body: body() });
    expect(writeVisitorBatch).not.toHaveBeenCalled();
  });

  it("в пачке отбрасывается только событие с плохой подписью", async () => {
    await send({ body: { events: [
      { type: "pageview", path: "/search?q=x" },
      { type: "search", path: "/search?q=x", token: "bad.token" },
    ] } });
    expect(lastWrite().events.map((e) => e.type)).toEqual(["pageview"]);
  });
});
