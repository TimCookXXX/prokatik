// Фразы ленты гостя: на каждый тип события и каждую причину пустой выдачи,
// источники, страницы по справочнику и время по Москве.
import { describe, expect, it } from "vitest";
import {
  EMPTY_DIRECTORY, describeAction, describeEvent, describePage, describeReason, describeSignIn,
  describeSource, describeVisit, guestCode, momentLabel, visitorLabel, type Directory,
} from "@/lib/analytics/describe";
import { ZERO_REASONS } from "@/lib/search/zero-reason";
import { SOURCE_KINDS } from "@/lib/analytics/source";
import type { TimelineEvent } from "@/lib/analytics/visits";

const LISTING_ID = "01M40WM7401Q4CKFZHWWY49HJ8";
const dir: Directory = {
  cities: new Map([["krasnodar", "Краснодар"]]),
  categories: new Map([["instrumenty", "Инструменты"], ["perforatory", "Перфораторы"]]),
  listings: new Map([[LISTING_ID, "Перфоратор Makita"]]),
};

const ev = (type: string, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: "E1", type, at: new Date("2026-10-21T11:05:00Z"), path: "/", listingId: null, listingTitle: null,
  q: null, total: null, props: {}, userId: null, ...extra,
});

describe("describeEvent", () => {
  it("поиск: нашлось, ничего с причиной, по части запроса, весь каталог", () => {
    expect(describeEvent(ev("search", { q: "перфоратор", total: 12, props: { page: 1 } }), dir))
      .toBe("Искал «перфоратор» — нашлось 12");
    expect(describeEvent(ev("search", { q: "каяк", total: 0, props: { reason: "no_match" } }), dir))
      .toBe("Искал «каяк» — ничего: такого нет в каталоге");
    expect(describeEvent(ev("search", {
      q: "перфоратор макита hr9999", total: 3, props: { partial: true, usedQuery: "перфоратор макита" },
    }), dir)).toBe("Искал «перфоратор макита hr9999» — нашлось 3 только по части запроса: «перфоратор макита»");
    expect(describeEvent(ev("search", { q: null, total: 40, props: {} }), dir)).toBe("Смотрел весь каталог — нашлось 40");
  });

  it("поиск: раздел по справочнику и условия выдачи", () => {
    expect(describeEvent(ev("search", {
      q: "дрель", total: 0, props: { category: "instrumenty", reason: "filtered", dates: true, where: true, filters: true, page: 1 },
    }), dir)).toBe("Искал «дрель» в разделе «Инструменты» — ничего: отсекли даты или фильтры · с датами, с адресом «Где», с фильтрами");
    expect(describeEvent(ev("search", { q: null, total: 5, props: { category: "instrumenty", page: 2 } }), dir))
      .toBe("Смотрел раздел «Инструменты» — нашлось 5 · стр. 2");
  });

  it("просмотр объявления — название из базы; удалённое — без названия", () => {
    expect(describeEvent(ev("view_listing", { listingId: LISTING_ID, listingTitle: "Перфоратор Makita", props: { dates: true } }), dir))
      .toBe("Открыл объявление «Перфоратор Makita» · с датами");
    expect(describeEvent(ev("view_listing", { listingId: null }), dir)).toBe("Открыл объявление — его уже нет");
  });

  it("«Забронировать»: не в аккаунте; название — только если перед этим было другое объявление", () => {
    const click = ev("booking_click", { listingId: LISTING_ID, listingTitle: "Перфоратор Makita", props: { authed: false } });
    expect(describeEvent(click, dir, { previousListingId: LISTING_ID })).toBe("Нажал «Забронировать», не будучи в аккаунте");
    expect(describeEvent({ ...click, props: { authed: true } }, dir, { previousListingId: null }))
      .toBe("Нажал «Забронировать» в «Перфоратор Makita»");
  });

  it("вход: обычный, регистрация, конец истории гостя", () => {
    expect(describeEvent(ev("login", { userId: "u1" }), dir)).toBe("Вошёл в аккаунт");
    expect(describeEvent(ev("login", { userId: "u1" }), dir, { signup: "Яндекс ID" }))
      .toBe("Зарегистрировался и вошёл: Яндекс ID");
    expect(describeEvent(ev("login", { userId: "u1" }), dir, { signup: "" })).toBe("Зарегистрировался и вошёл");
    expect(describeEvent(ev("login"), dir)).toMatch(/^Вошёл в аккаунт — дальше история/);
  });

  // Строку завели, когда сессия уже была (выкат, «Учитывать снова»): входа в
  // эту минуту не было.
  it("вход с уже открытой сессией — не «вошёл»", () => {
    expect(describeEvent(ev("login", { userId: "u1", props: { via: "create" } }), dir)).toBe("Пришёл уже в аккаунте");
    expect(describeEvent(ev("login", { userId: "u1", props: { via: "switch" } }), dir)).toBe("Вошёл в аккаунт");
    expect(describeEvent(ev("login", { userId: "u1", props: { via: "create" } }), dir, { signup: "" }))
      .toBe("Зарегистрировался и вошёл");
  });

  it("показ страницы, ClientID и незнакомый тип", () => {
    expect(describeEvent(ev("pageview", { path: "/krasnodar/instrumenty?sort=new" }), dir))
      .toBe("Открыл раздел «Инструменты» · Краснодар");
    expect(describeEvent(ev("ym_client", { props: { cid: "123" } }), dir)).toBe("ClientID Метрики: 123");
    expect(describeEvent(ev("weird"), dir)).toBe("Событие weird");
  });
});

describe("describePage", () => {
  it.each([
    ["/", "главную"],
    ["/search?q=x", "поиск"],
    ["/chat", "переписку"],
    ["/cabinet", "кабинет"],
    ["/privacy", "политику конфиденциальности"],
    ["/u/01M40WM7401Q4CKFZHWWY49HJ8", "профиль продавца"],
    ["/krasnodar", "витрину города Краснодар"],
    ["/krasnodar/instrumenty/perforatory", "раздел «Перфораторы» · Краснодар"],
    [`/krasnodar/instrumenty/perforator-makita-${LISTING_ID}`, "объявление «Перфоратор Makita»"],
    ["/krasnodar/instrumenty/drel-01M40WM7401Q4CKFZHWWY49HJ9", "объявление — его уже нет"],
    ["/moskva/instrumenty", "страницу /moskva/instrumenty"],
  ])("%s → %s", (path, phrase) => {
    expect(describePage(path, dir)).toBe(phrase);
  });

  it("без справочника путь показывается как есть", () => {
    expect(describePage("/krasnodar", EMPTY_DIRECTORY)).toBe("страницу /krasnodar");
  });
});

describe("describeReason", () => {
  it.each(ZERO_REASONS)("%s — своими словами", (reason) => {
    expect(describeReason(reason)).not.toBe(reason);
  });
});

describe("describeSource", () => {
  it.each(SOURCE_KINDS)("%s — фраза есть", (kind) => {
    expect(describeSource({ kind, label: "x" })).toMatch(/\S/);
  });

  it.each([
    [{ kind: "search", label: "yandex" }, "из поиска Яндекса"],
    [{ kind: "social", label: "telegram" }, "из Telegram"],
    [{ kind: "social", label: "vk" }, "из ВКонтакте"],
    [{ kind: "ad", label: "yandex" }, "реклама Яндекса"],
    [{ kind: "ad", label: "" }, "реклама"],
    [{ kind: "campaign", label: "osen" }, "по ссылке с меткой «osen»"],
    [{ kind: "referral", label: "example.ru" }, "с сайта example.ru"],
    [{ kind: "direct", label: "" }, "прямой заход"],
    [{ kind: "account", label: "login" }, "после входа в аккаунт"],
    [{ kind: "account", label: "logout" }, "после выхода из аккаунта"],
    [{ kind: "account", label: "account" }, "после смены аккаунта"],
  ] as const)("%o → %s", (source, phrase) => {
    expect(describeSource(source)).toBe(phrase);
  });

  it("нет источника — неизвестно", () => {
    expect(describeSource(null)).toBe("неизвестно");
  });
});

describe("заголовок визита и время", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  it("«12 окт, 14:05 · из поиска Яндекса · телефон» — по Москве", () => {
    expect(describeVisit(new Date("2026-10-12T11:05:00Z"), {
      kind: "entry", source: { kind: "search", label: "yandex" }, campaign: null,
    }, "phone", now)).toBe("12 окт, 14:05 · из поиска Яндекса · телефон");
    expect(describeVisit(new Date("2026-10-12T11:05:00Z"), { kind: "continued" }, null, now))
      .toBe("12 окт, 14:05 · продолжение: вкладка была открыта · устройство неизвестно");
  });

  it("день — московский: 21:30 UTC — уже следующие сутки", () => {
    expect(momentLabel(new Date("2026-10-21T21:30:00Z"), now)).toBe("22 окт, 00:30");
  });

  it("другой год — с годом", () => {
    expect(momentLabel(new Date("2025-12-31T09:00:00Z"), now)).toBe("31 дек 2025, 12:00");
  });
});

describe("гость, способ входа, шаги сделки", () => {
  it("«Гость 7F3K» по id, имя аккаунта — если есть", () => {
    expect(guestCode("7f3ka000-0000-4000-8000-000000000000")).toBe("7F3K");
    expect(visitorLabel({ id: "7f3ka000-0000-4000-8000-000000000000" })).toBe("Гость 7F3K");
    expect(visitorLabel({ id: "7f3ka000-0000-4000-8000-000000000000", userName: "Ира" })).toBe("Ира");
  });

  it("способы входа словами", () => {
    expect(describeSignIn(["yandex", "vk"], true)).toBe("Яндекс ID, VK ID, почта и пароль");
    expect(describeSignIn([], false)).toBe("");
  });

  it("заявка, переписка, вещь", () => {
    const at = new Date("2026-10-21T10:00:00Z");
    expect(describeAction({ kind: "request", id: "r", at, listingTitle: "Палатка", dateFrom: "2026-10-10", dateTo: "2026-10-12" }))
      .toBe("Отправил заявку на «Палатка» · 10–12 окт");
    expect(describeAction({ kind: "chat", id: "c", at, listingTitle: "Палатка" })).toBe("Начал переписку по «Палатка»");
    expect(describeAction({ kind: "listing", id: "l", at, listingTitle: null })).toBe("Разместил вещь «без названия»");
  });
});
