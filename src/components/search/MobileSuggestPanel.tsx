"use client";

import { useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { content } from "@theme/content";

// С lg список подсказок — поповер под полем; ниже — эта панель на весь экран
// под шапкой. Порог один для шапки и hero: на телефоне и планшете поле в шапке
// узкое, и поповер шириной в поле был бы щелью.
const POPOVER_LAYOUT = "(min-width: 1024px)";

/**
 * Список подсказок — поповером (true) или панелью (false). Мерять ширину в JS
 * здесь законно: список открывается фокусом, то есть только на клиенте, и
 * серверный снапшот «панель» к моменту открытия уже заменён настоящим.
 */
export function usePopoverLayout(): boolean {
  const subscribe = useCallback((cb: () => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
    const mq = window.matchMedia(POPOVER_LAYOUT);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }, []);
  return useSyncExternalStore(
    subscribe,
    // Гарда на matchMedia: в jsdom его нет.
    () => typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia(POPOVER_LAYOUT).matches,
    () => false,
  );
}

/**
 * Полноэкранная панель подсказок на телефоне: от низа шапки до низа экрана.
 * Поле остаётся в шапке настоящим input'ом — тап сразу поднимает клавиатуру, а
 * панель лишь показывает список под ней. Высота в dvh, а не vh: на iOS vh
 * считается без панелей браузера, и низ списка уезжал бы под них.
 *
 * Портал — потому что шапка sticky и скруглена, а панель шире её. z-50 — выше
 * шапки и таб-бара (z-40).
 */
export function MobileSuggestPanel({
  onClose,
  toolbar,
  children,
}: {
  onClose: () => void;
  /** Чипы «Когда» и «Где» с текущими значениями — слева в верхней строке. */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return createPortal(
    // mousedown гасится на всей панели: иначе тап по строке или по пустому
    // месту увёл бы фокус из поля, клавиатура спряталась бы, и панель
    // закрылась бы раньше, чем дойдёт клик. Прокрутку пальцем это не трогает.
    <div
      data-suggest-panel
      onMouseDown={(e) => e.preventDefault()}
      className="fixed inset-x-0 top-[var(--header-total)] z-50 h-[calc(100dvh-var(--header-total))] overflow-y-auto overscroll-contain bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-foreground"
    >
      {/* Верхняя строка панели: чипы остальных полей и крестик. Закрыть
        * панель иначе нечем: она закрывает всё под шапкой, а Android прячет
        * клавиатуру кнопкой «назад», не снимая фокуса. */}
      <div className="flex items-center gap-2 pl-4 pr-2 pt-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">{toolbar}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label={content.search.closeSuggest}
          className="hoverable grid h-10 w-10 place-items-center rounded-lg text-muted-foreground"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}
