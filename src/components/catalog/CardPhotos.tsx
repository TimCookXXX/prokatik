"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { content } from "@theme/content";

const t = content.listingCard;

/** Приоритет загрузки первого фото: первые две карточки — high, остаток первого ряда — eager. */
export type PhotoPriority = "high" | "eager";

const IMAGE = "object-cover object-center transition-transform duration-300 " +
  "motion-safe:group-hover:scale-[1.03]";

// Листалка фото в карточке сетки. Карточка — серверная, сюда приходят только
// адреса снимков, подпись и ссылка: объявление целиком через границу клиента
// не идёт.
//
// Название карточки растянуто псевдоэлементом на всю карточку, и свайп по фото
// попал бы в него, а не в ленту. Поэтому фото — своя ссылка поверх (z-10), без
// табуляции и вне дерева доступности: ссылка названия уже ведёт туда же.
// Стрелки — соседи ссылки, не её потомки: кнопка внутри <a> невалидна.
//
// Сервер рисует только первый снимок — он один в HTML, с alt = название.
// Остальные слайды стоят пустыми заглушками и получают снимки на первом
// намерении: курсор над карточкой, касание или прокрутка ленты.
export function CardPhotos({
  photos,
  alt,
  href,
  sizes,
  eager,
}: {
  photos: string[];
  alt: string;
  href: string;
  sizes: string;
  eager?: PhotoPriority;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [active, setActive] = useState(0);
  const last = photos.length - 1;

  // Наведение на любую точку карточки, а не только на фото: пока курсор
  // дойдёт до стрелки, снимки уже грузятся. <article> — серверный, поэтому
  // слушатель вешается на него отсюда.
  useEffect(() => {
    if (armed) return;
    const host = track.current?.closest("article") ?? track.current;
    if (!host) return;
    const arm = () => setArmed(true);
    host.addEventListener("pointerenter", arm, { once: true });
    return () => host.removeEventListener("pointerenter", arm);
  }, [armed]);

  const arm = () => { if (!armed) setArmed(true); };

  const onScroll = () => {
    arm();
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.min(last, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
  };

  const step = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    arm();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  };

  // Видимый круг 32–36 px, зона нажатия — вся кнопка, 44 px. Только для мыши:
  // на таче листают свайпом, а с клавиатуры — без 48 лишних остановок.
  const arrow = "absolute top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center " +
    "opacity-0 transition-opacity group-hover:opacity-100 " +
    "[@media(hover:hover)_and_(pointer:fine)]:flex";
  const circle = "glass-photo flex h-8 w-8 items-center justify-center rounded-full sm:h-9 sm:w-9";

  return (
    <div className="relative">
      <Link
        href={href as never}
        tabIndex={-1}
        aria-hidden="true"
        draggable={false}
        className="relative z-10 block"
      >
        <div
          ref={track}
          onScroll={onScroll}
          onTouchStart={arm}
          className="flex overflow-x-auto overscroll-x-contain snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {photos.map((url, i) => (
            <div key={i} className="relative aspect-square w-full shrink-0 snap-start snap-always overflow-hidden bg-muted">
              {i === 0 ? (
                <Image
                  src={url}
                  alt={alt}
                  fill
                  sizes={sizes}
                  draggable={false}
                  loading={eager ? "eager" : undefined}
                  fetchPriority={eager === "high" ? "high" : undefined}
                  className={IMAGE}
                />
              ) : armed ? (
                // eager: слайд сбоку ленты ленивая загрузка не считает видимым и
                // не грузила бы до прокрутки — а монтируется он уже по намерению.
                <Image src={url} alt="" fill sizes={sizes} draggable={false} loading="eager" className={IMAGE} />
              ) : null}
            </div>
          ))}
        </div>
      </Link>

      {active > 0 && (
        <button type="button" tabIndex={-1} aria-label={t.prevPhoto} onClick={() => step(-1)}
          onPointerEnter={arm} className={`${arrow} left-1`}>
          <span className={circle}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></span>
        </button>
      )}
      {active < last && (
        <button type="button" tabIndex={-1} aria-label={t.nextPhoto} onClick={() => step(1)}
          onPointerEnter={arm} className={`${arrow} right-1`}>
          <span className={circle}><ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
        </button>
      )}

      {/* Точки — тёмная плашка, как у «Занято»: снимок о теме не знает. */}
      <div aria-hidden="true" data-dots
        className="glass-photo pointer-events-none absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-pill px-1.5 py-1">
        {photos.map((_, i) => (
          <span key={i} data-active={i === active || undefined}
            className={`h-1.5 w-1.5 rounded-full bg-current transition-opacity ${i === active ? "opacity-100" : "opacity-50"}`} />
        ))}
      </div>
    </div>
  );
}
