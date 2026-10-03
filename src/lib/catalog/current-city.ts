// Текущий город по адресу страницы. Витрина и категории держат город в пути
// (`/kazan/instrumenty`), поиск — в параметре (`/search?city=kazan`), и шапке
// нужен ответ в обоих случаях: без него поиск из Петербурга уводил бы в город
// по умолчанию, а селектор города не знал бы, что показывать выбранным.
//
// Чистая функция без БД: список активных слагов приходит сверху, оттуда же, где
// его и так грузят для селектора.

export function resolveCitySlug(
  pathname: string,
  search: string,
  knownSlugs: readonly string[],
): string | undefined {
  const known = (slug: string | null | undefined): string | undefined =>
    slug && knownSlugs.includes(slug) ? slug : undefined;

  // Путь важнее параметра: человек физически стоит на витрине города, что бы ни
  // осталось в адресе от прошлого перехода.
  return known(pathname.split("/")[1]) ?? known(new URLSearchParams(search).get("city"));
}

// Город для страниц, где его нет в адресе: главная, поиск без ?city=, шапка,
// таб-бар, форма нового объявления. Кандидаты идут в том порядке, в каком их
// перечислил вызывающий, и первый активный побеждает.
//
// Порядок — параметр, а не константа, потому что он не один: витрине правильнее
// «где я смотрю» (кука) вперёд «где живу» (профиль), а форме объявления —
// наоборот, вещь лежит по месту жизни, а не по месту листания.
//
// Проверка по списку активных обязательна на каждом шаге: кука живёт год и
// правится руками, а город админ в любой момент отключает. Непроверенный слаг
// давал бы пустую витрину и 404 в поиске.
export function pickCitySlug(
  candidates: readonly (string | null | undefined)[],
  activeSlugs: readonly string[],
): string | undefined {
  for (const candidate of candidates) {
    if (candidate && activeSlugs.includes(candidate)) return candidate;
  }
  // Последнее слово — первый активный: человеку без предпочтений всё равно надо
  // что-то показать, а пустая витрина хуже чужого города.
  return activeSlugs[0];
}

// Куда ведёт выбор города в шапке. С поиска не уводит: переносится то, что
// человек выбрал про себя, — запрос, раздел, сортировка и вид. Не переносятся
// цена, даты, «Где» (`loc`, `la`, `src`, `lp`) и страница: они описывают выдачу
// покинутого города и в новом означали бы уже не то же самое. Вместе с точкой
// уходит и «Ближе» — без неё сортировке не от чего считать.
export function citySwitchHref(pathname: string, search: string, slug: string): string {
  if (pathname !== "/search") return `/${slug}`;

  const current = new URLSearchParams(search);
  const next = new URLSearchParams();
  for (const key of ["q", "category", "sort", "view"]) {
    const value = current.get(key);
    if (value && !(key === "sort" && value === "near")) next.set(key, value);
  }
  next.set("city", slug);
  return `/search?${next.toString()}`;
}
