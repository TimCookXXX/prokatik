import Link from "next/link";
import { Plus } from "lucide-react";
import { content } from "@theme/content";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { authPanelProps } from "@/lib/auth/panel-props";
import { LoginTrigger } from "@/components/auth/LoginTrigger";
import { getActiveCities } from "@/server/catalog";
import { getCitiesGeo } from "@/server/city";
import { UserMenu } from "@/components/auth/UserMenu";
import { CitySelector } from "./CitySelector";
import type { SearchCity } from "@/components/search/SearchBar";
import { MobileSearchScreen } from "@/components/search/MobileSearchScreen";
import { HeaderSearch } from "./HeaderSearch";

export async function Header() {
  const [session, cities, citiesGeo] = await Promise.all([auth(), getActiveCities(), getCitiesGeo()]);
  const user = session?.user;
  // Аноним входит модалкой, остальные идут прямиком в создание объявления:
  // гейта на ник больше нет.
  const placeHref = user ? "/cabinet/listings/new" : "/login";

  // Флаги для модалки входа: аноним входит, не уходя со страницы.
  const authProps = authPanelProps();

  // Текущий город шапка не вычисляет: она живёт в корневом layout'е, а он при
  // клиентской навигации не перерисовывается — прочитанный здесь адрес протух
  // бы на первом же переходе. Город определяют сами клиентские компоненты: из
  // адреса, а где его там нет — из предпочтения, которое layout положил в
  // CityPreferenceProvider. Шапке нужен только список активных — с гео-контекстом
  // каждого, потому что поле «Где» тоже узнаёт свой город лишь на клиенте.
  // Гео-контекст движок геокодера не грузит — это метка из geo_imports.
  const searchCities: SearchCity[] = cities.map((c) => ({
    slug: c.slug, name: c.name, geo: citiesGeo.get(c.slug) ?? null,
  }));

  return (
    // Плавающая карточка: сам <header> — прозрачный sticky-контейнер, панель
    // внутри оторвана от краёв, скруглена со всех сторон и непрозрачна. Стекла
    // нет, поэтому подтягивать обложки под хедер отрицательным отступом нельзя:
    // спрятанное под панелью просто не увидят (в зазорах вокруг — увидят).
    // Сверху — системный инсет (--safe-top): веб-приложение с экрана «Домой»
    // иначе прятало бы панель под чёлкой и часами.
    <header data-site-header className="sticky top-0 z-40 w-full pt-[var(--safe-top)]">
      <div className="mx-auto max-w-[1200px] px-4 py-[var(--header-inset)]">
        <div className="flex h-[var(--header-h)] items-center gap-2 rounded-lg border border-border bg-header px-3 md:gap-3 md:px-4">
          {/* Бренд и город. Город виден и на мобайле: другого способа сменить
           * его с телефона нет — таб-бар города не показывает, а чипа в ленте
           * фильтров, который здесь когда-то обещали, никогда не было. Место
           * под него уступает не знак, а название города: оно режется по ширине
           * (см. CitySelector), знак остаётся целиком. */}
          <div className="flex min-w-0 shrink-0 items-center gap-1 md:gap-3">
            {/* flex, а не просто shrink-0: знак — inline-flex, и внутри строки
             * он садится на baseline с пустотой под ним, из-за чего ряд
             * центрирует ссылку вместе с этим «хвостом». */}
            <Link href="/" className="flex shrink-0 items-center" aria-label={content.site.name}>
              <Logo size={20} word={content.site.name} />
            </Link>
            <span className="hidden h-5 w-px shrink-0 bg-border md:block" aria-hidden="true" />
            {/* Пока город в системе один, на телефоне селектор молчит: выбрать
              * в нём нечего, а место он отнимает у поиска и у знака. На
              * десктопе место есть, и там он полезен даже с одним городом —
              * сообщает, чью выдачу вы смотрите. Появится второй город —
              * появится и на мобайле, тогда за место платит название города:
              * оно режется, знак остаётся целиком. */}
            <div className={cities.length > 1 ? "min-w-0" : "hidden min-w-0 md:block"}>
              <CitySelector cities={cities.map((c) => ({ slug: c.slug, name: c.name }))} />
            </div>
          </div>

          {/* Поиск занимает всё оставшееся место в ряду. Ниже lg это кнопка
            * экрана поиска; сам экран — порталом в body, вне HeaderSearch. */}
          <HeaderSearch className="min-w-0 flex-1" cities={searchCities} />
          <MobileSearchScreen cities={searchCities} />

          {/* Действия: на мобайле их роль берёт таб-бар — «Сдать», «Профиль»,
           * а переключатель темы живёт в подвале. */}
          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <Button asChild size="sm" className="shrink-0 px-4">
              {/* Анониму «Разместить» открывает вход модалкой и возвращает
                * на ту же страницу; остальным — обычная ссылка. */}
              {user ? (
                <Link href={placeHref as never} aria-label={content.nav.place}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {content.nav.place}
                </Link>
              ) : (
                <LoginTrigger {...authProps} aria-label={content.nav.place}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {content.nav.place}
                </LoginTrigger>
              )}
            </Button>

            {/* Профиль или вход. Тема переехала в меню пользователя, у анонима
              * она остаётся в подвале. */}
            {user ? (
              <UserMenu
                name={user.name ?? null}
                email={user.email ?? null}
                image={user.image ?? null}
                isAdmin={user.role === "admin"}
              />
            ) : (
              <Button asChild variant="ghost" size="sm">
                <LoginTrigger {...authProps}>{content.nav.login}</LoginTrigger>
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
