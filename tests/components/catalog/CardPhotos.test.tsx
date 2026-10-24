import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListingCard } from "@/components/catalog/ListingCard";
import type { AvailabilityMap } from "@/lib/catalog/availability";
import { content } from "@theme/content";

// Листалка фото в сетке (CardPhotos): только при нескольких снимках, не больше
// пяти, сервер рисует один снимок, остальные приходят на первом намерении.
// Сам свайп и snap — проверка глазами: jsdom не прокручивает и не считает
// раскладку.

const t = content.listingCard;
const TITLE = "Электровелосипед Kugoo Kirin V3 Pro";
const photo = (n: number) => ({ url: `https://cdn.test/p${n}.webp`, width: 1200, height: 1200 });
const photosOf = (n: number) => Array.from({ length: n }, (_, i) => photo(i + 1));

function card(photos: number, props: Record<string, unknown> = {}) {
  const item = {
    listing: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      ownerUserId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      slug: "kugoo-kirin",
      title: TITLE,
      quantity: 1,
      priceDay: 900,
      priceWeek: null,
      priceMonth: null,
      minDays: 1,
      depositType: "none",
      depositAmount: null,
      location: "Юбилейный, Краснодар",
      geoPrecision: "place",
      handoverPickup: true,
      handoverDelivery: false,
      photosJson: photosOf(photos),
    },
    ownerName: "ПикаВел",
    ownerImage: null,
    ownerIsVerified: false,
    categorySlug: "elektrovelosipedy",
    citySlug: "krasnodar",
    cityName: "Краснодар",
    distance: null,
  } as never;
  return <ListingCard item={item} citySlug="krasnodar" from="2026-09-04"
    availabilityMap={new Map() as AvailabilityMap} {...props} />;
}

const imgs = () => Array.from(document.querySelectorAll("img"));
const dots = () => document.querySelector("[data-dots]");
const intent = () => act(() => { fireEvent.pointerEnter(document.querySelector("article")!); });
const photoLink = () => document.querySelector<HTMLAnchorElement>("a[aria-hidden='true']");
const track = () => photoLink()!.firstElementChild as HTMLElement;

describe("листалка фото в сетке", () => {
  it("один снимок — одно фото, без стрелок и точек", () => {
    render(card(1));
    intent();
    expect(imgs()).toHaveLength(1);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(dots()).toBeNull();
    expect(photoLink()).toBeNull();
  });

  it("сервер рисует только первый снимок, с alt = название", () => {
    render(card(3));
    expect(imgs()).toHaveLength(1);
    expect(imgs()[0]).toHaveAttribute("alt", TITLE);
    expect(imgs()[0]).toHaveAttribute("src", photo(1).url);
    // Слайды-заглушки уже стоят: лента листается с первого касания.
    expect(track().children).toHaveLength(3);
    expect(track().children[1]).toHaveClass("bg-muted");
  });

  it("на намерении приходят остальные снимки, не больше пяти", () => {
    render(card(7));
    intent();
    expect(imgs()).toHaveLength(5);
    expect(imgs().map((i) => i.getAttribute("src"))).toEqual([1, 2, 3, 4, 5].map((n) => photo(n).url));
    expect(dots()!.children).toHaveLength(5);
    // В HTML и для SEO — одно фото с подписью; остальные декоративные.
    expect(imgs().filter((i) => i.getAttribute("alt"))).toHaveLength(1);
  });

  it("касание ленты — тоже намерение", () => {
    render(card(3));
    act(() => { fireEvent.touchStart(track()); });
    expect(imgs()).toHaveLength(3);
  });

  it("фото — своя ссылка вне табуляции и дерева доступности", () => {
    render(card(3, { hrefQuery: "from=2026-09-10" }));
    const link = photoLink()!;
    expect(link).toHaveAttribute("tabindex", "-1");
    expect(link).toHaveAttribute("href", "/krasnodar/elektrovelosipedy/kugoo-kirin-01ARZ3NDEKTSV4RRFFQ69G5FAW?from=2026-09-10");
    expect(link).toHaveClass("relative", "z-10");
    expect(track()).toHaveClass("overflow-x-auto", "overscroll-x-contain", "snap-x", "snap-mandatory");
    // Вертикальный свайп по фото должен листать страницу.
    expect(track().className).not.toMatch(/touch-pan|touch-action/);
    intent();
    for (const img of imgs()) expect(img).toHaveAttribute("draggable", "false");
  });

  it("точки скрыты от скринридера", () => {
    render(card(3));
    expect(dots()).toHaveAttribute("aria-hidden", "true");
  });

  describe("стрелки", () => {
    const scrollBy = vi.fn();
    const original = Element.prototype.scrollBy;
    beforeEach(() => {
      scrollBy.mockReset();
      Element.prototype.scrollBy = scrollBy as never;
    });
    afterEach(() => {
      Element.prototype.scrollBy = original;
      vi.unstubAllGlobals();
    });

    const width = (el: HTMLElement, w: number) => Object.defineProperty(el, "clientWidth", { value: w, configurable: true });
    const scrollTo = (left: number) => {
      Object.defineProperty(track(), "scrollLeft", { value: left, configurable: true });
      act(() => { fireEvent.scroll(track()); });
    };

    it("подписаны, вне ссылки, вне табуляции, только для мыши", () => {
      render(card(3));
      const next = screen.getByRole("button", { name: t.nextPhoto });
      expect(next.closest("a")).toBeNull();
      expect(next).toHaveAttribute("tabindex", "-1");
      expect(next).toHaveClass("hidden", "[@media(hover:hover)_and_(pointer:fine)]:flex", "h-11", "w-11", "z-20");
    });

    it("на первом фото нет «назад», на последнем — «вперёд»", () => {
      render(card(3));
      width(track(), 200);
      expect(screen.queryByRole("button", { name: t.prevPhoto })).toBeNull();
      expect(screen.getByRole("button", { name: t.nextPhoto })).toBeInTheDocument();
      scrollTo(200);
      expect(screen.getByRole("button", { name: t.prevPhoto }).closest("a")).toBeNull();
      expect(screen.getByRole("button", { name: t.nextPhoto })).toBeInTheDocument();
      expect(dots()!.children[1]).toHaveAttribute("data-active", "true");
      scrollTo(400);
      expect(screen.queryByRole("button", { name: t.nextPhoto })).toBeNull();
    });

    it("«вперёд» листает ленту на ширину фото плавно", () => {
      render(card(3));
      width(track(), 200);
      fireEvent.click(screen.getByRole("button", { name: t.nextPhoto }));
      expect(scrollBy).toHaveBeenCalledWith({ left: 200, behavior: "smooth" });
    });

    it("при reduced motion — без плавности", () => {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q }));
      render(card(3));
      width(track(), 200);
      fireEvent.click(screen.getByRole("button", { name: t.nextPhoto }));
      expect(scrollBy).toHaveBeenCalledWith({ left: 200, behavior: "auto" });
    });
  });

  it("увеличение при наведении — только без reduced motion", () => {
    render(card(3));
    expect(imgs()[0]).toHaveClass("motion-safe:group-hover:scale-[1.03]");
  });

  describe("приоритет загрузки", () => {
    it("high — fetchpriority только у первого снимка", () => {
      render(card(3, { eager: "high" }));
      intent();
      expect(imgs()[0]).toHaveAttribute("fetchpriority", "high");
      expect(imgs()[0]).toHaveAttribute("loading", "eager");
      // Остальные монтируются по намерению и грузятся сразу, но без high:
      // сбоку ленты lazy-загрузка не считала бы их видимыми.
      for (const img of imgs().slice(1)) {
        expect(img).not.toHaveAttribute("fetchpriority");
        expect(img).toHaveAttribute("loading", "eager");
      }
    });

    it("eager — без fetchpriority", () => {
      render(card(3, { eager: "eager" }));
      expect(imgs()[0]).toHaveAttribute("loading", "eager");
      expect(imgs()[0]).not.toHaveAttribute("fetchpriority");
    });

    it("без приоритета — ленивая загрузка по умолчанию", () => {
      render(card(3));
      expect(imgs()[0]).not.toHaveAttribute("loading");
      expect(imgs()[0]).not.toHaveAttribute("fetchpriority");
    });

    it("одно фото тоже получает приоритет", () => {
      render(card(1, { eager: "high" }));
      expect(imgs()[0]).toHaveAttribute("fetchpriority", "high");
    });

    it("sizes приходит пропом", () => {
      render(card(3, { sizes: "240px" }));
      expect(imgs()[0]).toHaveAttribute("sizes", "240px");
    });
  });

  it("carousel={false} — одно фото, без листалки", () => {
    render(card(3, { carousel: false }));
    intent();
    expect(imgs()).toHaveLength(1);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(dots()).toBeNull();
    expect(photoLink()).toBeNull();
  });

  it("списком — одно фото, без листалки", () => {
    render(card(3, { view: "list" }));
    intent();
    expect(imgs()).toHaveLength(1);
    expect(dots()).toBeNull();
    expect(photoLink()).toBeNull();
  });

  it("«Занято» лежит над ссылкой фото", () => {
    render(card(3, { availabilityMap: new Map([["2026-09-04", { bookedQty: 1, blockedQty: 0 }]]) }));
    expect(screen.getByText(t.busy)).toHaveClass("z-20", "pointer-events-none");
  });
});
