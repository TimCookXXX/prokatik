import Link from "next/link";
import { MapPin, Wallet, MessageCircle, CalendarDays, Plus, type LucideIcon } from "lucide-react";
import { content } from "@theme/content";
import type { AuthPanelProps } from "@/lib/auth/panel-props";
import { Button } from "@/components/ui/button";
import { LoginTrigger } from "@/components/auth/LoginTrigger";
import { BracketsHandoff } from "@/components/brand/BracketsHandoff";
import { SearchBar, type SearchCity } from "@/components/search/SearchBar";

// Слово стоит на месте две с половиной секунды, считая перелёты: столько нужно,
// чтобы его прочли. 280 мс — длительность .handoff-out и .handoff-in.
const HERO_HOLD_MS = 2600 - 280 * 2;

const FACT_ICONS: Record<(typeof content.home.heroFacts)[number]["icon"], LucideIcon> = {
  "map-pin": MapPin,
  wallet: Wallet,
  "message-circle": MessageCircle,
  "calendar-days": CalendarDays,
};

export function Hero({
  city,
  placeHref,
  authProps,
}: {
  // Город витрины — тот же, что у подборок ниже. Без него нет ни поиска, ни
  // каталога города.
  city?: SearchCity;
  placeHref: string;
  // Задан — значит перед нами аноним: «Разместить» открывает вход модалкой
  // вместо ухода на /login.
  authProps?: AuthPanelProps;
}) {
  // Городов может не быть вовсе (пустая база, все выключены) — тогда витрины
  // нет и «Каталог» ведёт в поиск, а не в ссылку с undefined в пути.
  const catalogHref = city ? `/${city.slug}` : "/search";

  return (
    // Два слоя, роли которых меняет тема (см. .hero-panel в globals.css): в
    // тёмной панель — сама иллюстрация, а вуаль поверх её затемняет; в светлой
    // панель обычная, а вуаль несёт ленту фактурой. Внутри и там и там
    // обычные text-foreground / text-muted-foreground.
    <section className="hero-panel relative overflow-hidden rounded-lg">
      <div aria-hidden="true" className="hero-veil absolute inset-0" />

      {/* z-10 обязателен: фильтр героя нарисован псевдоэлементом ::after, а он
        * в дереве последний и без этого лёг бы поверх текста и кнопок.
        * Точка wide — общая для всех секций главной, см. tailwind.config.ts. */}
      {/* На телефоне — одна колонка с порядком «заголовок → подзаголовок →
        * поиск → плитки → кнопки», выключка по центру. С wide раскладка
        * макетная: текст, поиск и кнопки слева тремя строками, плитки справа на
        * все. Порядок в
        * разметке мобильный, десктопный собирается явной раскладкой по клеткам
        * — так DOM совпадает с тем, что читают с телефона. */}
      <div className="relative z-10 grid items-center gap-8 p-4 sm:p-6 wide:grid-cols-[minmax(0,1fr)_minmax(280px,528px)] wide:gap-x-12 wide:gap-y-8 wide:p-11">
        <div className="min-w-0 text-center wide:col-start-1 wide:row-start-1 wide:text-left">
          <h1 className="font-display text-hero font-extrabold leading-[1.02] tracking-mark text-foreground">
            {/* Слово меняется каждые пару секунд, поэтому доступное имя
              * заголовка неподвижно: скринридер не должен читать «Арендуй
              * гирлянду» как название страницы. */}
            <span className="sr-only">
              {content.home.heroLead} {content.home.heroTitleTail}
            </span>
            <span aria-hidden="true">
              {content.home.heroLead}
              <br />
              {/* Тот же знак и то же движение, что на экранах перехода;
                * size="inherit" сажает его на резиновый кегль заголовка и даёт
                * скобки в рост слова. Темп и остановка движения — от того, что
                * главная висит на экране, а не мелькает. */}
              <BracketsHandoff
                size="inherit"
                holdMs={HERO_HOLD_MS}
                pauseWhenReduced
                width="word"
                words={content.home.heroWords}
              />
            </span>
          </h1>

          {/* Прозрачность произвольная: шкала Tailwind идёт шагом в пять, 72 в
            * ней нет, и класс просто не сгенерировался бы — текст остался бы
            * цвета body, то есть невидимым в светлой теме. */}
          {/* 18 пунктов — кегль макета, нарисованного на 1440. На телефоне это
            * абзац в четыре строки крупнее основного текста сайта, поэтому там
            * обычные 15. */}
          <p className="mx-auto mt-6 max-w-[40ch] text-base leading-body text-foreground/[0.72] sm:text-xl wide:mx-0">
            {content.home.heroSubtitle}
          </p>
        </div>

        {/* На телефоне — список в одну колонку строками: четыре высокие плитки
          * 2×2 занимали там почти экран и отжимали кнопки за сгиб. С sm
          * ширины хватает, и плитки возвращаются к макетному виду. */}
        {/* Поиск сразу под подзаголовком и на телефоне, и на десктопе: на
          * телефоне плитки ниже растянулись бы на экран и унесли его за сгиб.
          * Списки подсказок — порталом: у секции overflow-hidden. */}
        {city && (
          <SearchBar
            variant="hero"
            cities={[city]}
            citySlug={city.slug}
            className="wide:col-start-1 wide:row-start-2"
          />
        )}

        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-2.5 wide:col-start-2 wide:row-start-1 wide:row-span-3">
          {content.home.heroFacts.map((fact) => {
            const Icon = FACT_ICONS[fact.icon];
            // Имя класса целиком, а не собранное из кусков: Tailwind вычищает
            // из @layer components всё, чего не нашёл в исходниках дословно, и
            // `hero-tile-${tone}` уносил за собой --tone вместе со всем видом
            // плитки.
            const toneClass = fact.tone === "accent" ? "hero-tile-accent" : "hero-tile-primary";
            return (
              <li
                key={fact.title}
                className={`hero-tile ${toneClass} relative flex items-center gap-3 overflow-hidden rounded-lg p-3 sm:min-h-[158px] sm:flex-col sm:items-stretch sm:justify-between sm:gap-0 sm:p-5`}
              >
                <span
                  aria-hidden="true"
                  className="hero-tile-glow pointer-events-none absolute -left-[30px] -top-10 h-[130px] w-[130px] rounded-full"
                />
                {/* Водяной знак вылезает за угол плитки — overflow-hidden его
                  * подрезает, поэтому иконка читается как фактура, а не как
                  * вторая иконка. В строке списка на телефоне он не помещается:
                  * 112px на плитке высотой в полсотни закрыли бы её целиком. */}
                <span
                  aria-hidden="true"
                  className="hero-tile-mark pointer-events-none absolute -bottom-[30px] -right-[26px] hidden opacity-[0.14] sm:block"
                >
                  <Icon size={112} strokeWidth={1.25} />
                </span>

                <span className="hero-tile-badge relative flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-sm">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>

                <span className="relative block">
                  <span className="block text-base font-semibold text-foreground">{fact.title}</span>
                  <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                    {fact.text}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        {/* На телефоне кнопки разведены к краям панели, на десктопе стоят
          * рядом слева, как в макете. */}
        <div className="flex flex-wrap items-center justify-between gap-3 wide:col-start-1 wide:row-start-3 wide:justify-start">
          <Button asChild className="h-12 px-6 text-base font-semibold">
            <Link href={catalogHref as never}>{content.home.heroCatalog}</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            // text-foreground обязателен, хотя кнопка ничего не перекрашивает:
            // цвет наследуется от body, где он уже вычислен по теме, и
            // переопределение токена на панели героя до него не достаёт — в
            // тёмной теме надпись выходила бы тёмной на тёмном.
            className="h-12 border-foreground/25 bg-transparent px-[22px] text-base font-semibold text-foreground"
          >
            {authProps ? (
              <LoginTrigger {...authProps} redirectTo="/cabinet/listings/new">
                <Plus className="mr-2 h-[18px] w-[18px]" aria-hidden="true" />
                {content.home.heroPlace}
              </LoginTrigger>
            ) : (
              <Link href={placeHref as never}>
                <Plus className="mr-2 h-[18px] w-[18px]" aria-hidden="true" />
                {content.home.heroPlace}
              </Link>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
