"use client";

import { Suspense, useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";

declare global {
  interface Window {
    ym?: (...args: unknown[]) => void;
  }
}

interface Props {
  counterId: string;
}

// Секрет из ссылки (сброс пароля — /reset?token=…) в Метрику не уходит: ни
// адресом страницы, ни источником перехода. Инлайн-сниппет повторяет это же
// правило на JS — импортировать функцию туда нельзя.
export function withoutToken(href: string): string {
  if (!href) return href;
  try {
    const url = new URL(href);
    if (!url.searchParams.has("token")) return href;
    url.searchParams.delete("token");
    return url.href;
  } catch {
    return href;
  }
}

// Код счётчика. Вебвизор включается опцией init `webvisor`, а не только
// галочкой в настройках счётчика: без неё записей визитов нет.
export function metrikaInitSnippet(id: number): string {
  return `
    (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
    m[i].l=1*new Date();
    for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
    k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
    (window, document, "script", "https://mc.yandex.ru/metrika/tag.js?id=${id}", "ym");
    (function(){
      function clean(s){try{var u=new URL(s);if(!u.searchParams.has("token"))return s;u.searchParams.delete("token");return u.href}catch(e){return s}}
      ym(${id}, "init", { ssr: true, webvisor: true, clickmap: true, trackLinks: true, accurateTrackBounce: true, referrer: clean(document.referrer), url: clean(location.href) });
    })();
  `;
}

export function YandexMetrika({ counterId }: Props) {
  const id = Number(counterId);
  // env.ts пропускает только цифры; проверка — чтобы в скрипт не попало ничего,
  // кроме числа.
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return (
    <>
      <Script
        id="ym-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: metrikaInitSnippet(id) }}
      />
      {/* useSearchParams требует Suspense-границы, иначе страница уходит в
        * клиентский рендер целиком. */}
      <Suspense fallback={null}>
        <MetrikaPageHits id={id} />
      </Suspense>
      <noscript>
        <div>
          <img
            src={`https://mc.yandex.ru/watch/${id}`}
            style={{ position: "absolute", left: "-9999px" }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}

// Что считается новым просмотром: другая страница, другая страница выдачи
// (`page`) или новый поиск (`q` на /search) — это настоящие переходы с новым
// содержимым. Остальное правится на месте через replaceState/pushState —
// даты и количество в форме брони, фильтр кабинета, открытая заявка
// (?request=) — и просмотром не является. Сортировка и фильтры каталога —
// тоже переходы, но той же выдачи; глубину просмотра они не увеличивают.
export function pageViewKey(pathname: string, params: URLSearchParams): string {
  const page = params.get("page");
  const q = pathname === "/search" ? `q=${params.get("q") ?? ""}` : "";
  const parts = [q, page && page !== "1" ? `page=${page}` : ""].filter(Boolean);
  return parts.length ? `${pathname}?${parts.join("&")}` : pathname;
}

// Переходы внутри сайта идут без перезагрузки страницы, и сам счётчик их не
// видит: первый просмотр отправляет init, следующие — hit, с адресом, на
// котором человек был перед переходом, как источником.
export function MetrikaPageHits({ id }: { id: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const view = pageViewKey(pathname, params);
  const prev = useRef<{ view: string; href: string } | null>(null);

  useEffect(() => {
    const href = withoutToken(`${window.location.origin}${pathname}${search ? `?${search}` : ""}`);
    const last = prev.current;
    if (last && last.view !== view) {
      window.ym?.(id, "hit", href, { referer: last.href });
    }
    // Адрес обновляется и без hit'а: источником следующего перехода станет
    // страница с выбранными фильтрами, а не та, что была при входе.
    prev.current = { view, href };
  }, [id, pathname, search, view]);

  return null;
}
