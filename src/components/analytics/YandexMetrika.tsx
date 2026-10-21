"use client";

import { Suspense, useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { startGoals, stopGoals } from "./goals";
import { METRIKA_SKIPPED_PATH, isMetrikaSkipped, metrikaSafeHref } from "./metrika-url";
import { reloadDocument } from "./document-nav";
import { analyticsAllowedHere } from "./allowed-here";
import { track } from "./track";
import { ANALYTICS_ALLOWED_JS } from "@/lib/analytics/allowed";

declare global {
  interface Window {
    ym?: (...args: unknown[]) => void;
  }
}

interface Props {
  counterId: string;
}

// Код счётчика. Вебвизор включается опцией init `webvisor`, а не только
// галочкой в настройках счётчика: без неё записей визитов нет. На путях
// METRIKA_SKIPPED_PATH и после отказа от учёта (analyticsAllowed, кука
// noanalytics) сниппет не грузит tag.js и не заводит window.ym.
// clean() — та же чистка адреса, что metrikaSafeHref (metrika-url.ts), на JS.
export function metrikaInitSnippet(id: number): string {
  return `
    (function(){
      var skip = ${METRIKA_SKIPPED_PATH};
      if (skip.test(location.pathname)) return;
      if (!(${ANALYTICS_ALLOWED_JS})) return;
      (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
      m[i].l=1*new Date();
      for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
      k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
      (window, document, "script", "https://mc.yandex.ru/metrika/tag.js?id=${id}", "ym");
      function clean(s){try{var u=new URL(s),c=false,f;
        if(u.origin===location.origin&&skip.test(u.pathname))return u.origin+"/admin";
        if(u.searchParams.has("token")){u.searchParams.delete("token");c=true}
        f=u.searchParams.get("from");
        if(f!==null&&skip.test(f.split(/[?#]/,1)[0])){u.searchParams.delete("from");c=true}
        return c?u.href:s}catch(e){return s}}
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

/** Сколько раз и с каким шагом MetrikaGoals ждёт window.ym на публичной странице. */
export const GOALS_ATTACH_TRIES = 20;
export const GOALS_ATTACH_STEP_MS = 100;

// Очередь целей (goals.ts) уходит в счётчик, когда он поднят. Компонент стоит
// следом за <Script>: эффекты соседей идут по порядку, а Script исполняет
// инлайн-сниппет синхронно в своём эффекте — обычно к этому моменту window.ym
// уже заведён. Выключаются цели только там, где счётчика на этой загрузке
// документа точно не будет, — в админке, по пути, и после отказа от учёта.
// На публичной странице ym ждём, а не выключаем: сменись порядок эффектов,
// ошибка стоила бы задержки, а не всех целей до следующей загрузки. Не
// дождались — очередь остаётся ждать со своим потолком.
export function MetrikaGoals({ id }: { id: number }) {
  useEffect(() => {
    if (isMetrikaSkipped(window.location.pathname) || !analyticsAllowedHere()) {
      stopGoals();
      return;
    }
    let tries = 0;
    let timer: number | undefined;
    const attach = () => {
      if (typeof window.ym === "function") {
        startGoals(id);
        reportClientId(id);
      } else if (++tries < GOALS_ATTACH_TRIES) timer = window.setTimeout(attach, GOALS_ATTACH_STEP_MS);
    };
    attach();
    return () => window.clearTimeout(timer);
  }, [id]);
  return null;
}

// ClientID Метрики — в свою статистику, раз на загрузку документа: по нему в
// Метрике находится запись Вебвизора гостя. Роут пишет его только гостю без
// аккаунта и только когда значение сменилось. Чужой код: сбой — без ClientID.
function reportClientId(id: number): void {
  try {
    window.ym?.(id, "getClientID", (cid: unknown) => {
      const value = typeof cid === "string" || typeof cid === "number" ? String(cid) : "";
      if (/^\d{1,32}$/.test(value)) track("ym_client", { cid: value });
    });
  } catch {
    // Без ClientID карточка гостя покажет «ещё не получен».
  }
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
    if (isMetrikaSkipped(pathname)) {
      // Страховка: сюда пришли клиентским переходом, а счётчик с Вебвизором
      // поднят этой загрузкой документа на публичной странице. Загрузка
      // админки заново его не поднимет (сниппет смотрит на путь). Основное
      // правило — входить в админку полной загрузкой (metrika-url.ts): до
      // перезагрузки Вебвизор успевает снять кадр.
      if (typeof window.ym === "function") reloadDocument();
      return;
    }
    const href = metrikaSafeHref(`${window.location.origin}${pathname}${search ? `?${search}` : ""}`);
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
