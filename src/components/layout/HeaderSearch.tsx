"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SearchBar, type SearchCity } from "@/components/search/SearchBar";

/** Поиск hero на главной: пока он на экране, поиск шапки его не дублирует. */
const HERO_SEARCH = "[data-hero-search]";

/**
 * Виден ли поиск hero под шапкой: на «/» — ответ IntersectionObserver, null —
 * ответа ещё нет (сервер, первый кадр, возврат на «/»). Вне «/» — false сразу,
 * без кадра пустоты. Наблюдателя нет или поиска hero нет (витрина без
 * города) — false.
 */
function useHeroSearchInView(): boolean | null {
  const home = usePathname() === "/";
  const [inView, setInView] = useState<boolean | null>(null);

  useEffect(() => {
    if (!home) return;
    const hero = document.querySelector(HERO_SEARCH);
    if (!hero || typeof IntersectionObserver === "undefined") {
      setInView(false);
      return;
    }
    // Верх видимой области — низ липкой шапки: поиск hero, ушедший под неё,
    // уже не виден, и шапка должна показать свой. Верхний системный инсет
    // (--safe-top) — env(), его в JS не разобрать: берём готовый отступ шапки.
    const css = getComputedStyle(document.documentElement);
    const siteHeader = document.querySelector("[data-site-header]");
    const safeTop = siteHeader ? parseFloat(getComputedStyle(siteHeader).paddingTop) || 0 : 0;
    const top = safeTop
      + (parseFloat(css.getPropertyValue("--header-h")) || 0)
      + (parseFloat(css.getPropertyValue("--header-inset")) || 0);
    const io = new IntersectionObserver(
      // Последняя запись — самая свежая: за один вызов их может прийти
      // несколько, если прокрутили туда и обратно, пока поток был занят.
      (entries) => setInView(entries[entries.length - 1].isIntersecting),
      { rootMargin: `-${top}px 0px 0px 0px` },
    );
    io.observe(hero);
    // Ушли с «/» — ответ забыт: вернувшись, ждём новый, а не верим старому.
    return () => { io.disconnect(); setInView(null); };
  }, [home]);

  return home ? inView : false;
}

// Поиск в шапке — панель SearchBar в узком варианте. Обёртка оставлена, чтобы
// шапка не знала устройства панели.
//
// На главной поиск шапки не дублирует hero: пока поиск hero на экране, он
// прозрачен, но место в ряду держит — шапка не прыгает, когда он появляется.
// Два состояния скрытости:
// - ответа наблюдателя ещё нет (сервер, первый кадр, без JS) — data-hero-pending:
//   globals.css прячет его visibility, только если на странице есть поиск hero.
//   Так без JS и без города (hero без поиска) поиск шапки работает, а с поиском
//   hero его скрытые поля не попадают ни в табуляцию, ни в дерево доступности.
// - поиск hero на экране — inert: вне табуляции, касаний и дерева доступности
//   вместе со всем, что панель смонтирует потом. Пока внутри фокус — в поле,
//   поповере или календаре (порталы, но события фокуса React всплывают по
//   дереву компонентов), — поиск не прячется. Экран поиска на телефоне
//   (MobileSearchScreen) живёт вне этой обёртки: inert его не задевает.
export function HeaderSearch({
  className,
  // Активные города — чтобы узнать город в адресе и не принять за него первый
  // попавшийся сегмент вроде /cabinet. Без города поиск уходил бы в город по
  // умолчанию, и листающий Петербург получал бы выдачу Казани.
  cities = [],
}: {
  className?: string;
  cities?: readonly SearchCity[];
}) {
  const heroInView = useHeroSearchInView();
  const [focused, setFocused] = useState(false);
  const pending = heroInView === null;
  const concealed = heroInView === true && !focused;

  return (
    <div
      data-header-search
      data-hero-pending={pending || undefined}
      inert={concealed || undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn(
        "flex transition-opacity duration-200 motion-reduce:transition-none",
        concealed && "pointer-events-none opacity-0",
        className,
      )}
    >
      <SearchBar variant="header" cities={cities} />
    </div>
  );
}
