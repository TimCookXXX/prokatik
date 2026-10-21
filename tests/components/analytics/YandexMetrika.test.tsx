import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const docNav = vi.hoisted(() => ({ loadDocument: vi.fn(), reloadDocument: vi.fn() }));
vi.mock("@/components/analytics/document-nav", () => docNav);
const tracker = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/components/analytics/track", () => tracker);

import {
  GOALS_ATTACH_STEP_MS, GOALS_ATTACH_TRIES, MetrikaGoals, MetrikaPageHits, YandexMetrika, metrikaInitSnippet, pageViewKey,
} from "@/components/analytics/YandexMetrika";
import { isMetrikaSkipped, metrikaSafeHref } from "@/components/analytics/metrika-url";
import {
  GOAL_QUEUE_LIMIT, _pendingGoalsForTests, _resetGoalsForTests, reachGoal,
} from "@/components/analytics/goals";

const origin = window.location.origin;

describe("<YandexMetrika>", () => {
  it("рисует noscript-пиксель с номером счётчика", () => {
    const html = renderToString(<YandexMetrika counterId="12345678" />);
    expect(html).toContain('src="https://mc.yandex.ru/watch/12345678"');
  });

  it("не рисует счётчик с нечисловым номером", () => {
    expect(renderToString(<YandexMetrika counterId="1);alert(1" />)).toBe("");
  });
});

describe("metrikaInitSnippet", () => {
  // Сниппет исполняется как есть: стаб очереди ym ставится заранее, тогда
  // загрузчик tag.js его не перезаписывает, и вызов init остаётся в очереди.
  let calls: unknown[][];
  beforeEach(() => {
    calls = [];
    const ym = (...args: unknown[]) => { calls.push(args); };
    (window as unknown as Record<string, unknown>).ym = ym;
    (globalThis as unknown as Record<string, unknown>).ym = ym;
    document.head.appendChild(document.createElement("script"));
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  function runInit(): Record<string, unknown> {
    new Function(metrikaInitSnippet(42))();
    const init = calls.find((c) => c[1] === "init");
    expect(init?.[0]).toBe(42);
    return init?.[2] as Record<string, unknown>;
  }

  it("включает Вебвизор и грузит tag.js с номером счётчика", () => {
    const opts = runInit();
    expect(opts.webvisor).toBe(true);
    expect(metrikaInitSnippet(42)).toContain("https://mc.yandex.ru/metrika/tag.js?id=42");
  });

  it("не отдаёт токен из источника перехода", () => {
    Object.defineProperty(document, "referrer", { value: `${origin}/reset?token=secret`, configurable: true });
    const opts = runInit();
    expect(opts.referrer).toBe(`${origin}/reset`);
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
  });

  it("не отдаёт токен из адреса страницы", () => {
    window.history.replaceState(null, "", "/reset?token=secret&x=1");
    const opts = runInit();
    expect(opts.url).toBe(`${origin}/reset?x=1`);
    expect(String(opts.url)).not.toContain("secret");
  });

  it("не отдаёт адрес админки параметром from на /login", () => {
    // middleware: /admin/users без сессии → /login?from=%2Fadmin%2Fusers.
    window.history.replaceState(null, "", "/login?from=%2Fadmin%2Fvisitors%2Fabc%3Fq%3D1");
    const opts = runInit();
    expect(opts.url).toBe(`${origin}/login`);
  });

  it.each(["/search?q=a&from=2026-10-21", "/login?from=%2Fcabinet"])(
    "оставляет from, который в админку не ведёт: %s",
    (path) => {
      window.history.replaceState(null, "", path);
      expect(runInit().url).toBe(`${origin}${path}`);
    },
  );

  it("сводит источник перехода из открытой админки к /admin", () => {
    Object.defineProperty(document, "referrer", { value: `${origin}/admin/visitors/abc?q=1`, configurable: true });
    const opts = runInit();
    expect(opts.referrer).toBe(`${origin}/admin`);
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
  });

  it.each(["/admin", "/admin/users", "/admin/listings?x=1"])(
    "на %s не грузит tag.js, не делает init и не заводит ym",
    (path) => {
      window.history.replaceState(null, "", path);
      delete (window as unknown as Record<string, unknown>).ym;
      delete (globalThis as unknown as Record<string, unknown>).ym;
      const before = document.querySelectorAll('script[src*="mc.yandex.ru"]').length;
      new Function(metrikaInitSnippet(42))();
      expect(window.ym).toBeUndefined();
      expect(document.querySelectorAll('script[src*="mc.yandex.ru"]').length).toBe(before);
    },
  );

  it("после отказа от учёта не грузит tag.js, не делает init и не заводит ym", () => {
    document.cookie = "noanalytics=1; path=/";
    try {
      delete (window as unknown as Record<string, unknown>).ym;
      delete (globalThis as unknown as Record<string, unknown>).ym;
      const before = document.querySelectorAll('script[src*="mc.yandex.ru"]').length;
      new Function(metrikaInitSnippet(42))();
      expect(window.ym).toBeUndefined();
      expect(document.querySelectorAll('script[src*="mc.yandex.ru"]').length).toBe(before);
    } finally {
      document.cookie = "noanalytics=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    }
  });

  it("на публичной странице с «admin» в адресе работает как обычно", () => {
    window.history.replaceState(null, "", "/krasnodar/administrator");
    expect(runInit().webvisor).toBe(true);
  });
});

describe("isMetrikaSkipped", () => {
  it("пропускает только раздел /admin", () => {
    expect(isMetrikaSkipped("/admin")).toBe(true);
    expect(isMetrikaSkipped("/admin/users")).toBe(true);
    expect(isMetrikaSkipped("/administrator")).toBe(false);
    expect(isMetrikaSkipped("/krasnodar/admin")).toBe(false);
    expect(isMetrikaSkipped("/")).toBe(false);
  });
});

describe("metrikaSafeHref", () => {
  it("убирает token и не трогает адрес без него", () => {
    expect(metrikaSafeHref(`${origin}/reset?token=abc`)).toBe(`${origin}/reset`);
    expect(metrikaSafeHref(`${origin}/x?token=abc&q=a`)).toBe(`${origin}/x?q=a`);
    expect(metrikaSafeHref(`${origin}/search?q=a%20b`)).toBe(`${origin}/search?q=a%20b`);
    expect(metrikaSafeHref("")).toBe("");
  });

  it("убирает from, ведущий в админку, и только его", () => {
    expect(metrikaSafeHref(`${origin}/login?from=%2Fadmin`)).toBe(`${origin}/login`);
    expect(metrikaSafeHref(`${origin}/login?from=%2Fadmin%2Fusers%3Fq%3D1&x=1`)).toBe(`${origin}/login?x=1`);
    expect(metrikaSafeHref(`${origin}/login?from=%2Fcabinet`)).toBe(`${origin}/login?from=%2Fcabinet`);
    expect(metrikaSafeHref(`${origin}/search?from=2026-10-21`)).toBe(`${origin}/search?from=2026-10-21`);
    expect(metrikaSafeHref(`${origin}/login?from=%2Fadministrator`)).toBe(`${origin}/login?from=%2Fadministrator`);
  });

  it("сводит свой адрес в админке к /admin, чужой не трогает", () => {
    expect(metrikaSafeHref(`${origin}/admin/visitors/abc?q=1`)).toBe(`${origin}/admin`);
    expect(metrikaSafeHref("https://example.com/admin/x")).toBe("https://example.com/admin/x");
  });
});

describe("<MetrikaPageHits>", () => {
  let ym: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    nav.pathname = "/";
    nav.search = "";
    ym = vi.fn();
    window.ym = ym;
    docNav.reloadDocument.mockClear();
  });

  function mount() {
    const r = render(<MetrikaPageHits id={42} />);
    return (pathname: string, search: string) => {
      nav.pathname = pathname;
      nav.search = search;
      r.rerender(<MetrikaPageHits id={42} />);
    };
  }

  it("не шлёт hit на первом показе — его отправляет init", () => {
    mount();
    expect(ym).not.toHaveBeenCalled();
  });

  it("шлёт hit на смену страницы с прошлым адресом как источником", () => {
    const go = mount();
    go("/krasnodar", "");
    expect(ym).toHaveBeenCalledTimes(1);
    expect(ym).toHaveBeenCalledWith(42, "hit", `${origin}/krasnodar`, { referer: `${origin}/` });
  });

  it("не шлёт hit, когда страница правит свой адрес на месте", () => {
    nav.pathname = "/krasnodar/instrumenty/perforator-1";
    const go = mount();
    // BookingWidget: даты и количество через replaceState.
    go("/krasnodar/instrumenty/perforator-1", "from=2026-10-10&to=2026-10-12");
    go("/krasnodar/instrumenty/perforator-1", "from=2026-10-10&to=2026-10-12&qty=2");
    // RequestsFeed: открытая заявка.
    nav.pathname = "/cabinet/requests";
    go("/cabinet/requests", "");
    ym.mockClear();
    go("/cabinet/requests", "request=abc");
    go("/cabinet/requests", "");
    expect(ym).not.toHaveBeenCalled();
  });

  it("на /search шлёт hit на новый запрос, но не на фильтры и сортировку", () => {
    nav.pathname = "/search";
    nav.search = "q=дрель";
    const go = mount();
    go("/search", "q=дрель&sort=price");
    go("/search", "q=дрель&sort=price&view=grid");
    expect(ym).not.toHaveBeenCalled();

    go("/search", "q=перфоратор&sort=price");
    expect(ym).toHaveBeenCalledTimes(1);
    const [, , href, opts] = ym.mock.calls[0];
    expect(new URL(href as string).searchParams.get("q")).toBe("перфоратор");
    // Источник — адрес с уже выбранными фильтрами, а не адрес входа.
    expect(new URL((opts as { referer: string }).referer).searchParams.get("view")).toBe("grid");
  });

  it("не шлёт hit по адресам админки и не делает их источником", () => {
    nav.pathname = "/krasnodar";
    const go = mount();
    go("/admin", "");
    go("/admin/users", "");
    expect(ym).not.toHaveBeenCalled();
    go("/krasnodar/instrumenty", "");
    expect(ym).toHaveBeenCalledTimes(1);
    expect(ym).toHaveBeenCalledWith(42, "hit", `${origin}/krasnodar/instrumenty`, { referer: `${origin}/krasnodar` });
  });

  it("пришли в админку клиентским переходом при живом счётчике — перезагрузка", () => {
    nav.pathname = "/login";
    const go = mount();
    go("/admin", "");
    expect(docNav.reloadDocument).toHaveBeenCalledTimes(1);
  });

  // Отказ поставили в другой вкладке: счётчик этой загрузки жив, но хиты не
  // уходят, а вкладка перезагружается — новая загрузка его не поднимет.
  it("отказ от учёта в другой вкладке — без хита и с перезагрузкой", () => {
    nav.pathname = "/krasnodar";
    const go = mount();
    document.cookie = "noanalytics=1; path=/";
    try {
      go("/krasnodar/instrumenty", "");
      expect(ym).not.toHaveBeenCalled();
      expect(docNav.reloadDocument).toHaveBeenCalledTimes(1);
    } finally {
      document.cookie = "noanalytics=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    }
  });

  it("документ открыт в админке (счётчика нет) — без перезагрузки", () => {
    delete window.ym;
    nav.pathname = "/admin";
    const go = mount();
    go("/admin/users", "");
    expect(docNav.reloadDocument).not.toHaveBeenCalled();
  });

  it("не отдаёт токен ни в адресе hit, ни в источнике", () => {
    nav.pathname = "/reset";
    nav.search = "token=secret";
    const go = mount();
    go("/login", "token=other");
    expect(ym).toHaveBeenCalledWith(42, "hit", `${origin}/login`, { referer: `${origin}/reset` });
  });
});

describe("pageViewKey", () => {
  const key = (path: string, q = "") => pageViewKey(path, new URLSearchParams(q));
  it("считает новой страницей следующую страницу выдачи", () => {
    expect(key("/krasnodar", "page=2")).not.toBe(key("/krasnodar"));
    expect(key("/krasnodar", "page=1")).toBe(key("/krasnodar"));
    expect(key("/search", "q=дрель&page=2")).not.toBe(key("/search", "q=дрель"));
  });
  it("не считает новой страницей правку дат и фильтров", () => {
    expect(key("/krasnodar", "sort=price_asc&from=2026-10-10&to=2026-10-12")).toBe(key("/krasnodar"));
  });
});

describe("<MetrikaGoals>", () => {
  let ym: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    _resetGoalsForTests();
    ym = vi.fn();
    window.ym = ym;
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("сбрасывает в поднятый счётчик цели, случившиеся до него", () => {
    reachGoal("listing_view");
    render(<MetrikaGoals id={42} />);
    expect(ym).toHaveBeenCalledWith(42, "reachGoal", "listing_view");
    reachGoal("booking_click", { authed: true });
    expect(ym).toHaveBeenLastCalledWith(42, "reachGoal", "booking_click", { authed: true });
  });

  it("стоит в YandexMetrika: очередь уходит при монтировании счётчика", () => {
    reachGoal("search", { kind: "text" });
    render(<YandexMetrika counterId="42" />);
    expect(ym).toHaveBeenCalledWith(42, "reachGoal", "search", { kind: "text" });
  });

  it("в админке отбрасывает очередь и не шлёт новых целей", () => {
    window.history.replaceState(null, "", "/admin/users");
    reachGoal("listing_view");
    render(<MetrikaGoals id={42} />);
    reachGoal("booking_sent");
    expect(ym).not.toHaveBeenCalled();
    expect(_pendingGoalsForTests()).toEqual([]);
  });

  it("после отказа от учёта отбрасывает очередь и не шлёт новых целей", () => {
    document.cookie = "noanalytics=1; path=/";
    try {
      reachGoal("listing_view");
      render(<MetrikaGoals id={42} />);
      reachGoal("booking_sent");
      expect(ym).not.toHaveBeenCalled();
      expect(_pendingGoalsForTests()).toEqual([]);
    } finally {
      document.cookie = "noanalytics=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    }
  });

  // Счётчик поднят, а отказ поставили в другой вкладке: цели этой загрузки не
  // уходят, а вернувшись во вкладку, человек получает её перезагруженной.
  it("отказ в другой вкладке: цели не уходят, возврат во вкладку — перезагрузка", () => {
    docNav.reloadDocument.mockClear();
    render(<MetrikaGoals id={42} />);
    ym.mockClear();
    document.cookie = "noanalytics=1; path=/";
    try {
      reachGoal("booking_sent");
      expect(ym).not.toHaveBeenCalledWith(42, "reachGoal", "booking_sent");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(docNav.reloadDocument).toHaveBeenCalledTimes(1);
    } finally {
      document.cookie = "noanalytics=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    }
  });

  it("возврат во вкладку без отказа — без перезагрузки", () => {
    docNav.reloadDocument.mockClear();
    render(<MetrikaGoals id={42} />);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(docNav.reloadDocument).not.toHaveBeenCalled();
  });

  // Порядок эффектов — <Script> раньше MetrikaGoals — юнит-тестом не поймать:
  // jsdom исполняет вставленный скрипт в своём глобальном объекте. Поэтому
  // проверяется не порядок, а то, что его сбой не теряет цели.
  it("на публичной странице ждёт счётчик, а не выключает цели", () => {
    vi.useFakeTimers();
    try {
      delete window.ym;
      reachGoal("listing_view");
      render(<MetrikaGoals id={42} />);
      reachGoal("booking_click", { authed: false });
      expect(_pendingGoalsForTests()).toHaveLength(2);

      window.ym = ym;
      vi.advanceTimersByTime(GOALS_ATTACH_STEP_MS);
      expect(ym.mock.calls.filter((c) => c[1] === "reachGoal")).toEqual([
        [42, "reachGoal", "listing_view"],
        [42, "reachGoal", "booking_click", { authed: false }],
      ]);
      reachGoal("booking_sent");
      expect(ym).toHaveBeenLastCalledWith(42, "reachGoal", "booking_sent");
    } finally {
      vi.useRealTimers();
    }
  });

  it("счётчик так и не поднялся — очередь ждёт со своим потолком", () => {
    vi.useFakeTimers();
    try {
      delete window.ym;
      render(<MetrikaGoals id={42} />);
      vi.advanceTimersByTime(GOALS_ATTACH_TRIES * GOALS_ATTACH_STEP_MS * 2);
      for (let i = 0; i < GOAL_QUEUE_LIMIT + 5; i++) reachGoal("listing_view");
      expect(_pendingGoalsForTests()).toHaveLength(GOAL_QUEUE_LIMIT);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // ClientID — в свою статистику раз на загрузку документа: по нему в Метрике
  // находится запись Вебвизора гостя.
  it("отдаёт ClientID в свою статистику, когда счётчик поднят", () => {
    tracker.track.mockClear();
    ym.mockImplementation((_id: number, method: string, cb?: (cid: unknown) => void) => {
      if (method === "getClientID") cb?.("1697712345123456789");
    });
    render(<MetrikaGoals id={42} />);
    expect(ym).toHaveBeenCalledWith(42, "getClientID", expect.any(Function));
    expect(tracker.track).toHaveBeenCalledWith("ym_client", { cid: "1697712345123456789" });
  });

  it("не цифры вместо ClientID — ничего не уходит", () => {
    tracker.track.mockClear();
    ym.mockImplementation((_id: number, method: string, cb?: (cid: unknown) => void) => {
      if (method === "getClientID") cb?.("abc");
    });
    render(<MetrikaGoals id={42} />);
    expect(tracker.track).not.toHaveBeenCalled();
  });

  it("в админке ClientID не спрашивается", () => {
    window.history.replaceState(null, "", "/admin/users");
    render(<MetrikaGoals id={42} />);
    expect(ym).not.toHaveBeenCalledWith(42, "getClientID", expect.anything());
  });
});
