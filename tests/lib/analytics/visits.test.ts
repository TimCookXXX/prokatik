// Визиты гостя считаются при чтении: разрыв в VISIT_GAP_MINUTES, источник —
// вход первой загрузки документа, «продолжение», склейка показа страницы с её
// событием, «вернулся» по московским дням, шаги сделки — в окно визита.
import { describe, expect, it } from "vitest";
import {
  attachActions, isReturned, isSignupLogin, mergePageViews, splitVisits, VISIT_GAP_MS,
  type AccountAction, type TimelineEvent,
} from "@/lib/analytics/visits";
import { VISIT_GAP_MINUTES } from "@/lib/analytics/limits";

let seq = 0;
const T0 = Date.parse("2026-10-21T09:00:00.000Z");
const ev = (min: number, type: string, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: `E${String(++seq).padStart(4, "0")}`,
  type,
  at: new Date(T0 + min * 60_000),
  path: "/",
  listingId: null,
  listingTitle: null,
  q: null,
  total: null,
  props: {},
  userId: null,
  ...extra,
});
const doc = (min: number, src: unknown, extra: Partial<TimelineEvent> = {}) =>
  ev(min, "pageview", { props: { doc: true, src }, ...extra });

describe("splitVisits", () => {
  it("пауза меньше разрыва — тот же визит, не меньше — новый", () => {
    expect(VISIT_GAP_MS).toBe(VISIT_GAP_MINUTES * 60_000);
    const visits = splitVisits([
      doc(0, { kind: "direct", label: "" }),
      ev(29, "pageview", { path: "/krasnodar" }),
      ev(59, "pageview", { path: "/search" }),
    ]);
    expect(visits).toHaveLength(2);
    expect(visits[0].items).toHaveLength(2);
    expect(visits[1].start.toISOString()).toBe("2026-10-21T09:59:00.000Z");
  });

  it("источник визита — вход загрузки документа, с кампанией", () => {
    const [visit] = splitVisits([
      doc(0, { kind: "search", label: "yandex" }, { props: { doc: true, src: { kind: "search", label: "yandex" }, utm: { utm_campaign: "osen" } } }),
    ]);
    expect(visit.entry).toEqual({ kind: "entry", source: { kind: "search", label: "yandex" }, campaign: "osen" });
  });

  it("служебные login и ym_client визит не начинают", () => {
    const [visit] = splitVisits([
      ev(0, "login", { userId: "u1", path: null }),
      doc(0, { kind: "social", label: "telegram" }),
    ]);
    expect(visit.entry).toEqual({ kind: "entry", source: { kind: "social", label: "telegram" }, campaign: null });
  });

  // Вход почтой уводит клиентским переходом, Яндекс ID и VK ID возвращают с
  // referrer'ом провайдера: источник такого визита — сам вход.
  it("визит после смены id при входе — «после входа», а не продолжение вкладки", () => {
    const [visit] = splitVisits([
      ev(0, "login", { userId: "u1", path: null, props: { via: "switch" } }),
      ev(0, "pageview", { path: "/cabinet" }),
    ]);
    expect(visit.entry).toEqual({ kind: "entry", source: { kind: "account", label: "login" }, campaign: null });
    // Строка заведена уже с сессией: источник — её первая страница.
    const [created] = splitVisits([
      ev(0, "login", { userId: "u1", path: null, props: { via: "create" } }),
      doc(0, { kind: "search", label: "google" }),
    ]);
    expect(created.entry).toMatchObject({ source: { kind: "search", label: "google" } });
  });

  it("первый визит строки, заведённой выходом, — «после выхода»; только когда лента с её начала", () => {
    const events = [ev(0, "pageview", { path: "/" }), ev(120, "pageview", { path: "/search" })];
    const logout = { kind: "account" as const, label: "logout" };
    const visits = splitVisits(events, undefined, logout);
    expect(visits[0].entry).toEqual({ kind: "entry", source: logout, campaign: null });
    expect(visits[1].entry).toEqual({ kind: "continued" });
    expect(splitVisits(events)[0].entry).toEqual({ kind: "continued" });
  });

  it("визит с внутреннего перехода — продолжение, вкладка была открыта", () => {
    const visits = splitVisits([doc(0, { kind: "direct", label: "" }), ev(120, "pageview", { path: "/search" })]);
    expect(visits[1].entry).toEqual({ kind: "continued" });
  });

  it("порядок — по времени, даже если пришёл перемешанным", () => {
    const a = doc(0, { kind: "direct", label: "" });
    const b = ev(1, "pageview", { path: "/krasnodar" });
    const [visit] = splitVisits([b, a]);
    expect(visit.items.map((i) => (i.kind === "event" ? i.event.id : ""))).toEqual([a.id, b.id]);
  });

  it("неизвестная форма источника — null, а не мусор в админке", () => {
    const [visit] = splitVisits([doc(0, { kind: "evil", label: "x" })]);
    expect(visit.entry).toEqual({ kind: "entry", source: null, campaign: null });
  });
});

describe("mergePageViews", () => {
  const path = "/search?q=каяк";
  it("показ страницы склеивается с её поиском — в обе стороны", () => {
    const pv = ev(0, "pageview", { path });
    const search = ev(0, "search", { path, q: "каяк" });
    expect(mergePageViews([pv, search])).toEqual([search]);
    expect(mergePageViews([search, pv])).toEqual([search]);
  });

  it("служебное событие между ними склейке не мешает", () => {
    const pv = ev(0, "pageview", { path });
    const cid = ev(0, "ym_client", { path: null, props: { cid: "1" } });
    const search = ev(0, "search", { path });
    expect(mergePageViews([pv, cid, search])).toEqual([cid, search]);
  });

  it("другая страница или большой промежуток — показ остаётся", () => {
    const pv = ev(0, "pageview", { path: "/" });
    const search = ev(0, "search", { path });
    expect(mergePageViews([pv, search])).toEqual([pv, search]);
    const late = ev(1, "pageview", { path });
    const s2 = ev(0, "search", { path });
    expect(mergePageViews([s2, late])).toEqual([s2, late]);
  });

  it("один показ склеивается только с одним событием", () => {
    const listing = "/krasnodar/instrumenty/drel-01M40WM7401Q4CKFZHWWY49HJ8";
    const pv = ev(0, "pageview", { path: listing });
    const v1 = ev(0, "view_listing", { path: listing });
    const v2 = ev(0, "view_listing", { path: listing });
    expect(mergePageViews([pv, v1, v2])).toEqual([v1, v2]);
  });
});

describe("attachActions", () => {
  const action = (min: number, kind: AccountAction["kind"] = "request"): AccountAction => ({
    kind, id: `A${min}`, at: new Date(T0 + min * 60_000), listingTitle: "Палатка",
  });

  it("шаг сделки встаёт в визит по времени, в том числе после его последнего события", () => {
    const visits = splitVisits([doc(0, { kind: "direct", label: "" }), ev(5, "booking_click", { path: "/x" })]);
    const { visits: out, elsewhere } = attachActions(visits, [action(3, "chat"), action(20)]);
    expect(elsewhere).toEqual([]);
    expect(out[0].items.map((i) => i.kind)).toEqual(["event", "action", "event", "action"]);
  });

  it("вне окон визитов — «на других устройствах»", () => {
    const visits = splitVisits([doc(0, { kind: "direct", label: "" }), doc(120, { kind: "direct", label: "" })]);
    const { visits: out, elsewhere } = attachActions(visits, [action(60), action(-5)]);
    expect(elsewhere.map((a) => a.id)).toEqual(["A-5", "A60"]);
    expect(out.every((v) => v.items.every((i) => i.kind === "event"))).toBe(true);
  });

  it("не меняет переданные визиты", () => {
    const visits = splitVisits([doc(0, { kind: "direct", label: "" })]);
    attachActions(visits, [action(1)]);
    expect(visits[0].items).toHaveLength(1);
  });
});

describe("isReturned", () => {
  // 20:59 UTC = 23:59 МСК, 21:00 UTC = 00:00 следующего дня по Москве.
  it("другой день по Москве — вернулся, даже через минуту после полуночи", () => {
    expect(isReturned(new Date("2026-10-21T20:59:00Z"), new Date("2026-10-21T21:00:00Z"))).toBe(true);
  });

  it("тот же день по Москве — новый, даже через 20 часов", () => {
    expect(isReturned(new Date("2026-10-20T21:00:00Z"), new Date("2026-10-21T20:59:00Z"))).toBe(false);
  });
});

describe("isSignupLogin", () => {
  const created = new Date("2026-10-21T09:00:00Z");
  it("первый вход в пределах суток от создания — регистрация", () => {
    expect(isSignupLogin(new Date("2026-10-21T09:00:05Z"), created)).toBe(true);
    expect(isSignupLogin(new Date("2026-10-22T09:00:00Z"), created)).toBe(true);
  });

  it("позже суток или задолго до создания — обычный вход", () => {
    expect(isSignupLogin(new Date("2026-10-22T09:00:01Z"), created)).toBe(false);
    expect(isSignupLogin(new Date("2026-10-21T08:00:00Z"), created)).toBe(false);
  });
});
