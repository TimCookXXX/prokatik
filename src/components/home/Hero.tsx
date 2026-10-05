import Link from "next/link";
import { MapPin, Wallet, MessageCircle, CalendarDays, type LucideIcon } from "lucide-react";
import { content } from "@theme/content";
import { Button } from "@/components/ui/button";
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
  popular = [],
}: {
  // Город витрины — тот же, что у подборок ниже. Без него нет ни поиска, ни
  // каталога города.
  city?: SearchCity;
  /** Чипы «Часто ищут»: запросы, по которым в городе что-то находится. */
  popular?: readonly string[];
}) {
  return (
    // Два слоя, роли которых меняет тема (см. .hero-panel в globals.css): в
    // тёмной панель — сама иллюстрация, а вуаль поверх её затемняет; в светлой
    // панель обычная, а вуаль несёт ленту фактурой. Внутри и там и там
    // обычные text-foreground / text-muted-foreground.
    <section className="hero-panel relative overflow-hidden rounded-lg">
      <div aria-hidden="true" className="hero-veil absolute inset-0" />

      {/* z-10 обязателен: фильтр героя нарисован псевдоэлементом ::after, а он
        * в дереве последний и без этого лёг бы поверх текста и поиска.
        * Одна колонка: заголовок → подзаголовок → поиск → чипы → факты. На
        * телефоне по центру, с wide — слева, справа остаётся иллюстрация
        * (фильтр там прозрачнее). Точка wide — общая для секций главной. */}
      <div className="relative z-10 mx-auto flex w-full max-w-[960px] flex-col gap-6 p-4 text-center sm:p-6 wide:gap-7 wide:p-11">
        <div className="min-w-0">
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
          <p className="mx-auto mt-6 max-w-[40ch] text-base leading-body text-foreground/[0.72] sm:text-xl">
            {content.home.heroSubtitle}
          </p>
        </div>

        {/* Поиск сразу под подзаголовком. Списки подсказок — порталом: у
          * секции overflow-hidden. Без города искать негде (подсказки и выдача
          * городские) — вместо поиска одна кнопка в общую выдачу. */}
        {city ? (
          <div className="flex flex-col gap-3">
            <SearchBar variant="hero" cities={[city]} citySlug={city.slug} />
            {popular.length > 0 && (
              // На телефоне — одна строка с прокруткой от кромки до кромки
              // панели: восемь чипов переносом заняли бы три строки и унесли
              // факты за сгиб. С sm — перенос, по центру, с wide — слева.
              <nav
                aria-label={content.home.popularLabel}
                className="-mx-4 -my-1.5 flex items-center gap-2 overflow-x-auto px-4 py-1.5 [mask-image:linear-gradient(to_left,transparent,black_16px)] [scrollbar-width:none] sm:mx-0 sm:my-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 sm:py-0 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden"
              >
                <span aria-hidden="true" className="shrink-0 text-sm text-muted-foreground">
                  {content.home.popularLabel}:
                </span>
                {popular.map((q) => (
                  <Link
                    key={q}
                    href={`/search?${new URLSearchParams({ city: city.slug, q })}` as never}
                    className="tap-target hoverable shrink-0 rounded-sm border border-border bg-card px-3 py-1.5 text-sm text-foreground"
                  >
                    {q}
                  </Link>
                ))}
              </nav>
            )}
          </div>
        ) : (
          <div className="flex justify-center">
            <Button asChild className="h-12 px-6 text-base font-semibold">
              <Link href="/search">{content.home.heroCatalog}</Link>
            </Button>
          </div>
        )}

        {/* Факты строкой: иконка и заголовок. На телефоне 2×2 без прокрутки,
          * с sm — в один ряд. Охра — предмет и его свойства (закон цвета). */}
        <ul className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-left sm:flex sm:flex-wrap sm:justify-center sm:gap-x-6">
          {content.home.heroFacts.map((fact) => {
            const Icon = FACT_ICONS[fact.icon];
            return (
              <li key={fact.title} className="flex min-w-0 items-center gap-2">
                <Icon className="h-[18px] w-[18px] shrink-0 text-accent" aria-hidden="true" />
                <span className="text-sm font-semibold text-foreground">{fact.title}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
