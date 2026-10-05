"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ImageOff, X, ChevronLeft, ChevronRight, ZoomIn } from "lucide-react";

interface Photo { url: string; width: number; height: number }

export function Gallery({ photos, title }: { photos: Photo[]; title: string }) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  const count = photos.length;
  const go = useCallback(
    (dir: number) => setActive((i) => (i + dir + count) % count),
    [count],
  );

  // Клавиши в лайтбоксе + блокировка скролла (на <html> — наш скроллер).
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prev;
    };
  }, [lightbox, go]);

  if (count === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-lg rounded-br-[56px] bg-muted text-muted-foreground">
        <ImageOff className="h-10 w-10" aria-hidden="true" />
        <span className="sr-only">Без фото</span>
      </div>
    );
  }

  const current = photos[active];

  return (
    <>
      {/* Большое фото со скруглением снизу + превью поверх */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg rounded-br-[56px] bg-muted">
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="absolute inset-0 cursor-zoom-in"
          aria-label="Открыть фото на весь экран"
        >
          <Image
            key={current.url}
            src={current.url}
            alt={`${title} — фото ${active + 1}`}
            fill
            sizes="(max-width: 768px) 100vw, 60vw"
            className="object-cover"
            priority
          />
        </button>

        {count > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-start gap-2 p-3">
            {photos.map((p, i) => (
              <button
                key={p.url}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Фото ${i + 1}`}
                aria-current={i === active}
                className={`group pointer-events-auto relative h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-2 transition ${
                  i === active ? "ring-accent" : "ring-white/40 hover:ring-white/80"
                }`}
              >
                <Image src={p.url} alt="" fill sizes="48px" className="object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 transition group-hover:bg-black/15">
                  <ZoomIn className="h-4 w-4 text-white drop-shadow" aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Лайтбокс на весь экран */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95"
          onClick={() => setLightbox(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр фото"
        >
          <button
            type="button"
            onClick={() => setLightbox(false)}
            className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-10 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
            aria-label="Закрыть"
          >
            <X className="h-6 w-6" />
          </button>

          {/* pointer-events-none: фото занимает почти весь экран, и если оно
           * ловит клики, до фона не дотянуться — на телефоне лайтбокс
           * становится невыходным. Тап по снимку закрывает, как и по фону. */}
          <div className="pointer-events-none relative flex h-[90vh] w-[92vw] items-center justify-center">
            <Image
              key={current.url}
              src={current.url}
              alt={`${title} — фото ${active + 1}`}
              fill
              sizes="92vw"
              className="object-contain"
            />
          </div>

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); go(-1); }}
                className="absolute left-[max(0.75rem,env(safe-area-inset-left))] top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
                aria-label="Предыдущее фото"
              >
                <ChevronLeft className="h-7 w-7" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); go(1); }}
                className="absolute right-[max(0.75rem,env(safe-area-inset-right))] top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
                aria-label="Следующее фото"
              >
                <ChevronRight className="h-7 w-7" />
              </button>
              <span className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-10 -translate-x-1/2 rounded-sm bg-white/10 px-3 py-1 text-sm text-white">
                {active + 1} / {count}
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}
