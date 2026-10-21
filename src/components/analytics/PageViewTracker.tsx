"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { TRACK_RAW_PATH_MAX } from "@/lib/analytics/limits";
import { pageViewKey } from "./YandexMetrika";
import { currentPath, track } from "./track";

// Просмотр страницы для своей статистики. Правило «новый просмотр» то же, что
// у хитов Метрики (pageViewKey): другая страница, другая страница выдачи или
// новый запрос; правка дат, фильтров и сортировки на месте — тот же просмотр.
//
// У первого просмотра загрузки документа — вход: referrer и адрес с метками
// кампании. Из них роут узнаёт, откуда пришёл человек; у следующих
// просмотров — клиентских переходов — входа нет, и визит, начатый таким
// переходом, админка покажет продолжением открытой вкладки.
//
// Стоит в корневом layout'е вне условия Метрики: своя статистика от счётчика
// не зависит. Двойной эффект StrictMode гасит ref с последним ключом.
export function PageViewTracker() {
  const pathname = usePathname();
  const params = useSearchParams();
  const view = pageViewKey(pathname, params);
  const last = useRef<string | null>(null);
  const isFirst = useRef(true);

  useEffect(() => {
    if (last.current === view) return;
    last.current = view;
    const doc = isFirst.current;
    isFirst.current = false;
    track("pageview", doc
      ? { path: currentPath(), doc: true, ...(document.referrer ? { ref: document.referrer.slice(0, TRACK_RAW_PATH_MAX) } : {}) }
      : { path: currentPath() });
  }, [view]);

  return null;
}
