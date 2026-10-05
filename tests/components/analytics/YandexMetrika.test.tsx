import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import {
  MetrikaPageHits, YandexMetrika, metrikaInitSnippet, withoutToken, pageViewKey,
} from "@/components/analytics/YandexMetrika";

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
});

describe("withoutToken", () => {
  it("убирает только token и не трогает адрес без него", () => {
    expect(withoutToken(`${origin}/reset?token=abc`)).toBe(`${origin}/reset`);
    expect(withoutToken(`${origin}/x?token=abc&q=a`)).toBe(`${origin}/x?q=a`);
    expect(withoutToken(`${origin}/search?q=a%20b`)).toBe(`${origin}/search?q=a%20b`);
    expect(withoutToken("")).toBe("");
  });
});

describe("<MetrikaPageHits>", () => {
  let ym: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    nav.pathname = "/";
    nav.search = "";
    ym = vi.fn();
    window.ym = ym;
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
