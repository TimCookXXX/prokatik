import type { Metadata, Viewport } from "next";
import NextTopLoader from "nextjs-toploader";
import { fontDisplay, fontText, fontMark, fontMono } from "@theme/fonts";
import { seo } from "@theme/seo";
import { siteUrl } from "@/lib/site-config";
import { baseOpenGraph } from "@/lib/seo/open-graph";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileNav } from "@/components/layout/MobileNav";
import { YandexMetrika } from "@/components/analytics/YandexMetrika";
import "./globals.css";
import "@theme/tokens.css";
import "@theme/typography.css";
import { headers } from "next/headers";
import { resolveViewerCity } from "@/server/city";
import { getActiveCities } from "@/server/catalog";
import { CityPreferenceProvider } from "@/components/layout/CityPreference";
import { RealtimeProvider } from "@/components/realtime/RealtimeProvider";
import { RealtimeToaster } from "@/components/realtime/RealtimeToaster";
import { ConnectionStatus } from "@/components/realtime/ConnectionStatus";

// Функция, а не объект: адрес сайта (metadataBase) читается при запросе, а не
// застывает при импорте модуля значением со сборки.
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: seo.defaultTitle, template: `%s — ${seo.siteName}` },
    description: seo.defaultDescription,
    // Картинку по умолчанию даёт src/app/opengraph-image.tsx: Next подставляет
    // её сам, пока здесь нет openGraph.images. og:title и og:description он
    // дописывает из title и description страницы.
    openGraph: { ...baseOpenGraph },
    twitter: { card: "summary_large_image" },
    // icons здесь намеренно не задаются: favicon.ico, icon.svg и apple-icon.png
    // лежат рядом в src/app/ и подхватываются файловой конвенцией. Next
    // подмешивает icon и apple-icon, ТОЛЬКО пока metadata.icons пуст: стоит
    // любому сегменту задать это поле, и вектор вкладки с иконкой iOS пропадут
    // без ошибки сборки. favicon.ico исключение — его Next добавляет всегда.
  };
}

// Цвет адресной строки. Один тёмный, а не пара под prefers-color-scheme: та
// media смотрит на тему ОС, а тема сайта от неё не зависит — next-themes берёт
// localStorage либо defaultTheme="dark", и системную подхватывает лишь при
// явном "system", которого в UI выбора темы нет. Пара разъезжалась бы у
// самого частого гостя: новый посетитель со светлой ОС видит тёмную страницу.
// Точное совпадение с выбранной темой требует правки meta на клиенте — см.
// docs/BACKLOG.md.
//
// viewportFit: "cover" — без него iOS Safari отдаёт env(safe-area-inset-*)
// нулями, и ни один отступ под чёлку и полосу «домой» не работает: таб-бар,
// полоса брони, шторки и композер переписки стоят вплотную к системным зонам.
export const viewport: Viewport = {
  themeColor: seo.themeColor,
  viewportFit: "cover",
};

// Флаг из middleware, а не auth(): Header и MobileNav и так зовут auth() каждый
// на своей стороне, и третий поход в базу на каждой публичной странице был бы
// платой ровно за то, чтобы решить, поднимать ли сокет анониму.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Город считается здесь один раз на запрос и раздаётся шапке и таб-бару: они
  // соседи, и провайдер обязан накрывать обоих. Без этого вкладка «Каталог»
  // после смены города вела бы в старый — ровно на мобайле, где селектор и
  // появился.
  //
  // Города для подвала — тот же справочник под cache(), что берут
  // resolveViewerCity, шапка и таб-бар: лишнего запроса нет. Ловить его отказ
  // здесь бессмысленно — тот же промис уже ждёт resolveViewerCity рядом, и без
  // базы layout падает и так.
  const [hasSession, viewerCity, footerCities] = await Promise.all([
    headers().then((h) => h.get("x-has-session") === "1"),
    resolveViewerCity(),
    getActiveCities(),
  ]);

  return (
    <html
      lang="ru"
      suppressHydrationWarning
      className={`${fontDisplay.variable} ${fontText.variable} ${fontMark.variable} ${fontMono.variable}`}
    >
      <body className="bg-background text-foreground font-sans antialiased min-h-screen flex flex-col">
        {process.env.NODE_ENV === "production" && process.env.YANDEX_METRIKA_ID && (
          <YandexMetrika counterId={process.env.YANDEX_METRIKA_ID} />
        )}
        <RealtimeProvider enabled={hasSession}>
        <CityPreferenceProvider initialSlug={viewerCity?.slug}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {/* Глобальный progress-bar поверх <html>: даёт моментальный visual
           * feedback на любой client-side навигации (Link/router.push), пока
           * RSC грузит новую страницу. Цвет — токен --color-primary. */}
          <NextTopLoader color="#34C759" height={3} showSpinner={false} />
          <Header />
          {/* Минимальная высота = экран минус шапка (пилюля h-12 + py-3).
            * Без неё на пустых страницах футер поднимается к середине экрана:
            * прилипание к низу работает, но сам подвал высокий и занимает
            * половину телефона. Так он всегда начинается за линией сгиба.
            * svh, а не vh: на мобиле vh считается по развёрнутому окну без
            * адресной строки, и футер выглядывал бы снизу. */}
          <div className="flex-1 min-h-[calc(100svh-4.5rem)]">{children}</div>
          {/* Отступ под нижнюю панель — таб-бар или полосу брони; на десктопе
            * обе нулевые. */}
          <div className="pb-[var(--bottom-bar-h)]">
            <Footer cities={footerCities} />
          </div>
          <MobileNav />
          <RealtimeToaster />
          <ConnectionStatus />
        </ThemeProvider>
        </CityPreferenceProvider>
        </RealtimeProvider>
      </body>
    </html>
  );
}
