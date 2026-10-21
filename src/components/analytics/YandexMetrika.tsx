"use client";

import { Suspense, useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { startGoals, stopGoals } from "./goals";

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

// Админка в Метрику не попадает: ни визитом, ни записью Вебвизора, ни адресом
// страницы. Решение принимается один раз на загрузку документа — в
// инлайн-сниппете по пути, с которого документ открыт. Поэтому вход в админку
// из публичной части — обычная ссылка с полной загрузкой, а не клиентский
// переход: иначе админку записал бы счётчик, поднятый публичной страницей.
export const METRIKA_SKIPPED_PATH = /^\/admin(?:\/|$)/;

export function isMetrikaSkipped(pathname: string): boolean {
  return METRIKA_SKIPPED_PATH.test(pathname);
}

// Код счётчика. Вебвизор включается опцией init `webvisor`, а не только
// галочкой в настройках счётчика: без неё записей визитов нет. На путях
// METRIKA_SKIPPED_PATH сниппет не грузит tag.js и не заводит window.ym.
export function metrikaInitSnippet(id: number): string {
  return `
    (function(){
      if (${METRIKA_SKIPPED_PATH}.test(location.pathname)) return;
      (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
      m[i].l=1*new Date();
      for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
      k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
      (window, document, "script", "https://mc.yandex.ru/metrika/tag.js?id=${id}", "ym");
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
      {/* Строго после <Script>: см. MetrikaGoals. */}
      <MetrikaGoals id={id} />
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

// Очередь целей (goals.ts) уходит в счётчик, когда он поднят. Компонент стоит
// следом за <Script>: эффекты соседей идут по порядку, а Script исполняет
// инлайн-сниппет синхронно в своём эффекте — к этому моменту window.ym уже
// заведён, если счётчик на этой загрузке документа есть. Нет его (админка) —
// цели отбрасываются до следующей загрузки документа.
export function MetrikaGoals({ id }: { id: number }) {
  useEffect(() => {
    if (typeof window.ym === "function" && !isMetrikaSkipped(window.location.pathname)) startGoals(id);
    else stopGoals();
  }, [id]);
  return null;
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
    // Адрес админки не уходит ни хитом, ни источником следующего перехода.
    if (isMetrikaSkipped(pathname)) return;
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
