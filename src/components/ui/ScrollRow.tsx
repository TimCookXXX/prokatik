"use client";

import { useEffect, useRef, useState, type HTMLAttributes, type Ref } from "react";

/**
 * Список-лента с горизонтальной прокруткой. В табуляции (tabIndex 0) — только
 * пока ему есть куда прокручиваться: с клавиатуры ленту листают стрелками, а
 * та же разметка, развёрнутая сеткой на широком экране, лишней остановкой Tab
 * не становится. Сервер и первый кадр — в табуляции: ширину знает только
 * браузер, а без JS ленту на телефоне должно быть можно листать.
 */
export function ScrollRow({
  as: Tag,
  ...props
}: { as: "ul" | "ol" } & HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  const [scrolls, setScrolls] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth);
    measure();
    // Ширина меняется с экраном, содержимое — с приходом карточек.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    mo?.observe(el, { childList: true });
    return () => { ro?.disconnect(); mo?.disconnect(); };
  }, []);

  return <Tag ref={ref as Ref<never>} {...props} tabIndex={scrolls ? 0 : undefined} />;
}
