"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRight, ImageOff, LocateFixed } from "lucide-react";
import { content } from "@theme/content";
import { formatPrice } from "@/lib/catalog/format";
import type { NearbyItem, NearbyResponse } from "@/lib/catalog/nearby";
import type { CityGeoContext } from "@/lib/geo/context";
import { locationQuery, type LocationQuery } from "@/lib/geo/location";
import { WHERE_PARAMS } from "@/lib/search/submit-href";
import { Button } from "@/components/ui/button";
import { ScrollRow } from "@/components/ui/ScrollRow";
import { useCanGeolocate, useGeolocate } from "@/components/search/geolocate";
import { usePanelWhere } from "@/components/search/panel-dates";
import { useStoredLocation } from "@/components/search/stored-location";
import { requestWhereOpen } from "@/components/search/where-open";
import { whereLabel } from "@/components/search/WhereField";

const t = content.home.nearby;
const HEADING_ID = "nearby-heading";

const noSubscribe = () => () => {};
/** Сервер и гидрация — false: место живёт в localStorage, сервер его не знает. */
const useHydrated = () => useSyncExternalStore(noSubscribe, () => true, () => false);

/** Параметры «Где» для ссылок: loc, la, src, lp — как в адресе выдачи. */
function whereParams(q: LocationQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of WHERE_PARAMS) {
    const v = q[key];
    if (v) params.set(key, v);
  }
  return params;
}

// Высота полосы: заглушка до гидрации и загрузка держат её место, чтобы
// страница ниже не прыгала, когда приходят карточки.
const STRIP_H = "min-h-[262px] sm:min-h-[290px]";

/**
 * «Рядом с вами» на главной (только в городе с геоданными). Место — последнее
 * «Где» с этого устройства (stored-location.ts): с ним — полоса ближайших вещей
 * региона с подписью расстояния, «Все рядом» в выдачу с этой точкой и «Сменить
 * место» — открывает «Где» в hero. Без места — приглашение определить его
 * геолокацией или указать адрес. Выдача без `loc` в адресе по этому месту не
 * фильтрует и не сортирует: полоса только показывает.
 */
export function NearbyItems({ city }: { city: { slug: string; name: string; geo: CityGeoContext } }) {
  const hydrated = useHydrated();
  const { region } = city.geo;
  const stored = useStoredLocation(region);
  const canLocate = useCanGeolocate();
  const geo = useGeolocate({ slug: city.slug, name: city.name, region });
  const [denied, setDenied] = useState(false);

  // Черновик «Где» панелей этой страницы: определённое здесь место сразу
  // видно в поле hero и уйдёт с «Найти».
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, setWhereDraft] = usePanelWhere(`${pathname}?${searchParams.toString()}`, null);

  const q = stored ? locationQuery(stored) : null;
  // Серверу — только точка и её точность: подпись ответа не меняет.
  const key = q
    ? new URLSearchParams({ city: city.slug, loc: q.loc, ...(q.lp ? { lp: q.lp } : {}) }).toString()
    : null;
  const [reply, setReply] = useState<{ key: string; items: NearbyItem[] } | null>(null);

  useEffect(() => {
    if (!key) return;
    let live = true;
    void fetch(`/api/listings/nearby?${key}`)
      .then(async (res) => (res.ok ? ((await res.json()) as NearbyResponse).items : []))
      // Сеть или 429 — «рядом пусто», без ошибки: главная работает и без полосы.
      .catch(() => [])
      .then((items) => { if (live) setReply({ key, items }); });
    return () => { live = false; };
  }, [key]);

  // Приглашение сменяется полосой, и кнопка, державшая фокус, исчезает:
  // фокус переходит к заголовку полосы, а не теряется в документе. Только
  // если его никто не забрал — шторка «Где» держит свой.
  const focusStrip = useRef(false);
  useEffect(() => {
    if (!stored || !focusStrip.current) return;
    focusStrip.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) document.getElementById(HEADING_ID)?.focus();
  }, [stored]);

  const locate = async () => {
    // Кнопка на это время aria-disabled, а не disabled: disabled сбросил бы
    // фокус в документ. Повторное нажатие просто ничего не делает.
    if (geo.locating) return;
    setDenied(false);
    focusStrip.current = true;
    const r = await geo.locate();
    if (r.status !== "ok") focusStrip.current = false;
    if (r.status === "ok") setWhereDraft(r.point);
    else if (r.status === "denied") setDenied(true);
  };

  // «Открыть „Где“» в hero; когда шторка закроется, фокус вернётся к кнопке,
  // а если её уже нет (место выбрано или сброшено, блок сменился) — к
  // заголовку блока.
  const openWhere = (e: MouseEvent<HTMLElement>) => {
    const trigger = e.currentTarget;
    requestWhereOpen(() => (trigger.isConnected ? trigger : document.getElementById(HEADING_ID)));
  };

  if (!hydrated) return <div aria-hidden="true" className={STRIP_H} />;

  if (!stored || !q) {
    return (
      <section aria-labelledby={HEADING_ID} className="surface flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
        <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <LocateFixed className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={HEADING_ID} tabIndex={-1} className="font-display text-xl font-extrabold tracking-mark text-foreground outline-none">
            {t.ctaTitle}
          </h2>
          <p className="mt-1 text-base text-muted-foreground">{t.ctaText}</p>
          {denied && <p role="status" className="mt-2 text-sm text-muted-foreground">{t.denied}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {canLocate ? (
            <>
              <Button
                type="button"
                onClick={() => void locate()}
                aria-disabled={geo.locating || undefined}
                className="h-11 px-5 text-base font-semibold aria-disabled:cursor-wait aria-disabled:opacity-60"
              >
                <LocateFixed className="mr-2 h-[18px] w-[18px]" aria-hidden="true" />
                {geo.locating ? t.locating : t.locate}
              </Button>
              <button
                type="button"
                onClick={openWhere}
                className="rounded-sm text-base font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {t.orAddress}
              </button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={openWhere} className="h-11 px-5 text-base font-semibold">
              {t.pickAddress}
            </Button>
          )}
        </div>
      </section>
    );
  }

  const carry = whereParams(q).toString();
  const items = reply?.key === key ? reply.items : null;

  return (
    <section aria-labelledby={HEADING_ID} className={items === null ? STRIP_H : undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id={HEADING_ID} tabIndex={-1} className="font-display text-2xl font-extrabold tracking-mark text-foreground outline-none">
          {t.heading}
        </h2>
        <Link
          href={`/${city.slug}?${carry}` as never}
          className="inline-flex shrink-0 items-center gap-1.5 text-base font-semibold text-accent hover:underline"
        >
          {t.all}
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      </div>
      <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
        <span className="min-w-0 truncate">{t.from(whereLabel(stored))}</span>
        <button
          type="button"
          onClick={openWhere}
          className="shrink-0 rounded-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t.change}
        </button>
      </p>

      {items && items.length === 0 ? (
        <p className="mt-4 text-base text-muted-foreground">{t.empty}</p>
      ) : (
        // Ниже lg — лента с прокруткой от кромки до кромки (как строка
        // категорий), с именем и, пока прокручивается, фокусируемая —
        // листается и с клавиатуры (ScrollRow). С lg — ряд из шести без
        // прокрутки: колесом вбок мышью не листают, остальное — за «Все
        // рядом». Маска гасит правый край, но в фокусе снимается: она срезала
        // бы и рамку фокуса.
        <ScrollRow
          as="ul"
          aria-label={t.listLabel}
          aria-busy={items === null || undefined}
          className="-mx-4 mt-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 scroll-px-4 [mask-image:linear-gradient(to_left,transparent,black_16px)] [scrollbar-width:none] focus-visible:[mask-image:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:mx-0 lg:grid lg:grid-cols-6 lg:overflow-visible lg:px-0 lg:[mask-image:none] [&::-webkit-scrollbar]:hidden"
        >
          {items
            ? items.map((item, i) => (
              <NearbyCard key={item.id} item={item} carry={carry} className={i >= LG_ROW ? "lg:hidden" : undefined} />
            ))
            : Array.from({ length: LG_ROW }, (_, i) => <CardSkeleton key={i} />)}
        </ScrollRow>
      )}
    </section>
  );
}

const CARD_W = "w-[156px] shrink-0 snap-start sm:w-[188px] lg:w-auto";
/** Карточек в ряду с lg. */
const LG_ROW = 6;

function NearbyCard({ item, carry, className }: { item: NearbyItem; carry: string; className?: string }) {
  return (
    <li className={className ? `${CARD_W} ${className}` : CARD_W}>
      <Link
        href={`${item.href}?${carry}` as never}
        className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="relative block aspect-[4/3] overflow-hidden rounded-lg bg-muted">
          {item.photoUrl ? (
            <Image
              src={item.photoUrl}
              alt=""
              fill
              sizes="(min-width: 1024px) 190px, 188px"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-6 w-6" aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="mt-2 line-clamp-2 min-h-[2lh] text-sm font-medium leading-snug text-foreground group-hover:underline">
          {item.title}
        </span>
        <span className="mt-1 flex items-baseline justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-mark font-semibold text-foreground">{formatPrice(item.priceDay)}</span>
            <span className="text-xs text-muted-foreground"> {content.search.perDay}</span>
          </span>
          <span title={item.distanceTitle} className="shrink-0 whitespace-nowrap text-xs font-medium text-foreground">
            {item.distanceLabel}
          </span>
        </span>
      </Link>
    </li>
  );
}

function CardSkeleton() {
  return (
    <li aria-hidden="true" className={CARD_W}>
      <span className="block aspect-[4/3] rounded-lg bg-muted" />
      <span className="mt-2 block h-4 w-4/5 rounded-sm bg-muted" />
      <span className="mt-2 block h-4 w-1/2 rounded-sm bg-muted" />
    </li>
  );
}
