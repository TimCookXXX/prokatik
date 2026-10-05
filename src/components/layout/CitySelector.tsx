"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { content } from "@theme/content";
import { citySwitchHref } from "@/lib/catalog/current-city";
import { setCityPreference } from "@/server/actions/city";
import { useCurrentCity } from "./use-current-city";
import { useCityPreference } from "./CityPreference";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export interface CityOption {
  slug: string;
  name: string;
}

// Текущий город и адреса перехода считаются здесь, а не приходят из шапки:
// шапка отрисовывается один раз на весь сеанс (корневой layout не
// перерисовывается при навигации), и любое запечённое в неё значение адреса
// протухло бы на первом же переходе.
export function CitySelector({ cities }: { cities: CityOption[] }) {
  const { pathname, search, slug } = useCurrentCity(cities.map((c) => c.slug));
  const { slug: preferred, choose } = useCityPreference();
  const current = cities.find((c) => c.slug === slug);

  // Выбор города — единственное, что меняет предпочтение: хождение по чужому
  // городу его не трогает, это «смотрю», а не «переехал».
  //
  // Куку пишет server action, состояние обновляется тут же и не ждёт ответа:
  // переход всё равно ведёт на /{slug}, где город назван адресом, так что от
  // куки эта страница не зависит и гонки нет.
  //
  // Отказ экшена (город успели отключить) откатывает состояние: иначе шапка
  // показывала бы город, которого нет в куке, и спорила бы со страницами.
  //
  // Откат смотрит на текущее значение, а не пишет захваченное замыканием: при
  // двух кликах подряд A→B ответ по A приходит уже после того, как B записал
  // куку, и слепой откат вернул бы город, который сейчас неверен.
  const pick = (nextSlug: string) => {
    const rollback = () => choose((cur) => (cur === nextSlug ? preferred : cur));
    choose(nextSlug);
    setCityPreference(nextSlug)
      .then((r) => { if (!r.ok) rollback(); })
      .catch(rollback);
  };

  return (
    // modal={false}: без него Radix включает scroll-lock (overflow:hidden на
    // body), из-за чего sticky-хедер пересчитывается и прыгает к началу
    // страницы. См. тот же приём в UserMenu.
    <DropdownMenu modal={false}>
      {/* aria-label: без него скринридер слышит «Казань, кнопка» и не узнаёт,
        * что это переключатель города — а на телефоне другого способа его
        * сменить нет. */}
      <DropdownMenuTrigger
        aria-label={`Город: ${current?.name ?? content.nav.city}`}
        className="tap-target inline-flex h-9 min-w-0 items-center gap-1 rounded-sm px-2 text-sm text-foreground transition-colors hoverable md:px-3"
      >
        {/* На узком экране имя города режется сильнее: рядом стоят знак и
          * поиск, и длинное название («Петропавловск-Камчатский») съело бы
          * поле поиска целиком. Платит за место название, а не бренд. */}
        <span className="min-w-0 max-w-[4.5rem] truncate sm:max-w-[8rem]">
          {current?.name ?? content.nav.city}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {/* min-h-11: на телефоне это единственный способ сменить город, и пункт
          * обязан быть не мельче тач-таргета в таб-баре. */}
        {cities.map((c) => (
          <DropdownMenuItem key={c.slug} asChild className="min-h-11 md:min-h-0">
            <Link href={citySwitchHref(pathname, search, c.slug) as never} onClick={() => pick(c.slug)}>
              {c.name}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
