"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";

/* Аватарка, которую можно открыть на весь экран.
 *
 * Ставится только на крупные аватарки — в шапке кабинета и на публичной
 * странице продавца. Мелкие (хедер, таб-бар, список переписок) остаются
 * обычным Avatar: там клик уже занят навигацией.
 *
 * Без src смотреть нечего: буквенный кружок рисуется сам собой из имени, и
 * кнопка вокруг него была бы обещанием, которое некому выполнить.
 *
 * Лайтбокс намеренно не переиспользует Avatar: тот рендерит next/image с
 * width={size}, и на весь экран приехал бы ассет под 120px. */
export function AvatarViewer({
  src,
  name,
  size,
  className = "",
}: {
  src: string | null;
  name?: string | null;
  size: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /* Клавиши, фокус и блокировка скролла — только пока открыто.
   *
   * Диалог объявлен модальным, значит фокус обязан быть внутри: уводим его на
   * крестик, а Tab возвращаем туда же — интерактивный элемент здесь ровно
   * один, поэтому такая ловушка полная. На закрытии фокус возвращается кнопке,
   * с которой всё началось, иначе он падает в начало страницы. */
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "Tab") {
        e.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prev;
      trigger?.focus();
    };
  }, [open]);

  if (!src) return <Avatar src={null} name={name} size={size} className={className} />;

  const who = name?.trim() || "пользователя";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Открыть аватар ${who}`}
        // rounded-full на самой кнопке: иначе кольцо фокуса обводит квадрат.
        className="block rounded-full cursor-zoom-in focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Avatar src={src} name={name} size={size} className={className} />
      </button>

      {/* Портал в body. Триггеры стоят в обёртках, которые прячутся по
        * брейкпоинту (md:hidden / hidden md:block на публичной странице, весь
        * герой — md:flex), и оверлей внутри такого поддерева исчез бы вместе с
        * ним при смене ширины окна: картинки нет, а overflow: hidden на <html>
        * снять уже некому — страница перестала бы прокручиваться без видимой
        * причины. Заодно fixed перестаёт зависеть от transform у предков. */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`Аватар ${who}`}
        >
          <button
            ref={closeRef}
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-10 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
            aria-label="Закрыть"
          >
            <X className="h-6 w-6" />
          </button>

          {/* pointer-events-none — тем же приёмом, что в галерее: снимок
            * занимает почти весь экран, и если он ловит клики, до фона не
            * дотянуться. Тап по аватарке закрывает, как и по фону.
            *
            * Потолок 1024px — это сторона нашего кадра. Аватарки от Яндекса и
            * VK бывают и по 200px: без потолка их растянуло бы на весь экран
            * в кашу. */}
          <div className="pointer-events-none relative h-[min(88vw,88vh,1024px)] w-[min(88vw,88vh,1024px)]">
            <Image
              src={src}
              alt={`Аватар ${who}`}
              fill
              sizes="min(88vw, 1024px)"
              className="object-contain"
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
