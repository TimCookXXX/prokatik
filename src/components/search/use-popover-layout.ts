"use client";

import { useCallback, useSyncExternalStore } from "react";

// С lg календарь «Когда» — поповер под полем; ниже — шторка. Порог тот же, на
// котором шапка и hero меняют кнопку-триггер экрана поиска на настоящую форму.
const POPOVER_LAYOUT = "(min-width: 1024px)";

/**
 * Поповер (true) или шторка (false). Мерять ширину в JS здесь законно: выбор
 * делается при открытии, то есть только на клиенте, и серверный снапшот к
 * этому моменту уже заменён настоящим.
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
