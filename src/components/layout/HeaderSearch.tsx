"use client";

import { SearchBar, type SearchCity } from "@/components/search/SearchBar";

// Поиск в шапке — панель SearchBar в узком варианте. Обёртка оставлена, чтобы
// шапка не знала устройства панели.
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
  return <SearchBar variant="header" cities={cities} className={className} />;
}
