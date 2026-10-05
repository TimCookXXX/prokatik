# План: технический слой SEO для inrenta (ветка dev = прод)

Факты проверены по коду dev (HEAD `dda9251`) и по проду: 27 запросов curl, интервал не меньше 0,6 с, UA YandexBot, кроме одного запроса. Документация Next 16 взята из `node_modules/next/dist/docs`. По правилам CLAUDE.md задача крупная, поэтому план кладётся в `docs/plans/current/seo-technical.md`, его ревьюит агент со свежим контекстом, и он утверждается до начала кода.

## Что подтверждено сейчас

| # | Факт | Чем подтверждено |
|---|---|---|
| F1 | `/definitely-nope` → **200** + `noindex`. `/og-default.png` → **200** (файла нет, рендерится not-found) | curl `-w %{http_code}` |
| F2 | `/u/01AAAA…` → **404** и с YandexBot UA, и с браузерным UA. `/krasnodar/a/b/c` → **404**. У обоих тот же асинхронный корневой layout и тот же `not-found.tsx` с `await requireAuthState()`, но **нет `loading.tsx` на пути** | curl |
| F3 | Карточка с неверным слагом → **200** + `<meta http-equiv="refresh">` + `NEXT_REDIRECT;…;308` | curl + grep |
| F4 | `/krasnodar/ekshn-kamery` (подкатегория по прямому слагу) → **200** + meta refresh, canonical указывает на **себя** (`https://inrenta.ru/krasnodar/ekshn-kamery`) | curl |
| F5 | В HTML карточки: `<footer` на байте 16 825, лоадер «Ищем рядом…» на 16 619, `<div hidden id="S:` на 25 781, `<h1` на 28 087. У категории и у города то же самое: h1 после footer | python-разбор |
| F6 | Крошки и BreadcrumbList на карточке ведут на `/krasnodar/ekshn-kamery`, а не на `/krasnodar/foto-i-video/ekshn-kamery`. Уровня корня в крошках нет вовсе. Ссылка «Ещё в категории» собирается так же (`[sub]/page.tsx:248`) | HTML + код |
| F7 | `robots.txt`: только `Disallow /admin /banned /api/` и Sitemap. Clean-param нет | curl |
| F8 | У `/login` и `/reset` заголовок главной, нет `noindex`, нет canonical. У главной нет canonical. У `/privacy` описание дефолтное. Ни одного `og:` нет ни на одной странице | curl |
| F9 | `/krasnodar/detskie-tovary` (0 объявлений в Краснодаре) → 200 + «позиций не нашлось». `/krasnodar?page=99` → 200 | curl |
| F10 | Заголовки: «Аренда: vr в Краснодаре», у карточки 74 символа («…— аренда от 700 ₽/сутки в Краснодаре — inrenta»). Description карточки — сырой текст владельца | curl |
| F11 | Ссылок `href="/yablonovskiy…"` на главной нет: селектор города клиентский. Чипы «Часто ищут» ведут на `/search?city=…&q=…` (там noindex) | curl |
| F12 | `pingIndexNow` нигде не вызывается. DEPLOY 8.1 предлагает коммитить `public/<key>.txt` | grep |
| F13 | Next считает YandexBot «HTML-limited»: `HTML_LIMITED_BOT_UA_RE` содержит `yandex`. Поэтому для Яндекса метаданные стоят в `<head>` (title на байте 3 907 < `</head>` на 4 714). Обычному браузеру метаданные могут прийти стримом в body. **seo:check должен ходить с бот-UA** | `node_modules/next/dist/shared/lib/router/utils/html-bots.js` |
| F14 | TTFB/total на проде: карточка 0,22/0,31 с, категория 0,15/0,30 с. Скелетон выигрывает около 0,1 с | curl `-w` |

---

## 0. Сначала `pnpm seo:check` (пункт 11 идёт первым)

Скрипт нужен, чтобы снять базовую линию FAIL на проде до правок и потом проверять каждую правку одной командой.

- **Файлы:** `scripts/seo-check.ts` (новый); `package.json`: `"seo:check": "tsx scripts/seo-check.ts"`. Чистые хелперы разбора (позиции h1/footer/`S:`, canonical, robots-meta, og, JSON-LD, разбор robots.txt и sitemap) экспортируются из того же файла.
- **Поведение:**
  - вызов `pnpm seo:check <baseUrl> [--delay 600] [--sample 15] [--browser-ua]`;
  - `fetch` с `redirect: "manual"` и UA YandexBot;
  - для 404-проверок дополнительно один запрос с браузерным UA;
  - на выходе таблица `PASS/FAIL  check  url  detail`, при любом FAIL код выхода 1.
- **Проверки:**
  1. `/seo-check-nope-<rand>` → 404 (бот-UA и браузерный UA).
  2. Первая карточка из sitemap со слагом, заменённым на `x` → 308 или 301, `Location` равен каноническому пути.
  3. 5-сегментный URL подкатегории из sitemap `/c/root/sub`, запрошенный как `/c/sub` → 308 на `/c/root/sub`.
  4. Корень, который есть в sitemap у другого города, но не у этого → 404. `/{city}?page=9999` → 404.
  5. Одна категория и одна карточка: `<h1` раньше `<footer`, до `<h1` нет `hidden id="S:`.
  6. Canonical есть и абсолютный (origin совпадает с base) на `/`, на городе, на категории и на карточке. На `/privacy` и `/sources` тоже.
  7. `noindex` в `<meta name="robots">` на `/search`, `/login`, `/reset`.
  8. `robots.txt`: 200, `text/plain`, есть `Clean-param:`, есть `Sitemap: <base>/sitemap.xml`, нет `Host:`, у каждой строки Clean-param ≤ 500 символов.
  9. Карточка: `og:title`, `og:url`, `og:image` (абсолютный). Главная: `og:image`.
  10. JSON-LD карточки: `priceSpecification.unitCode === "DAY"`.
  11. Выборка из sitemap: все не-карточки плюс N случайных карточек → 200 без редиректа.
  12. `/indexnow.txt` → 200 с непустым телом, либо 404, если ключа нет (только печать, не FAIL).
- **Тесты:** `tests/scripts/seo-check.test.ts` гоняет хелперы на HTML-фикстурах: «стримовая» карточка (h1 после footer) и «нормальная».
- **Риски:** нагрузка на прод. По умолчанию `--delay 600` для не-localhost, выборка 15.
- **Как проверить:** прогон по проду до правок должен дать FAIL ровно по F1–F11. После деплоя — всё PASS.

## 1. P0: убрать стриминг из публичного каталога

- **Файлы:**
  - удалить `src/app/(public)/[city]/loading.tsx`;
  - удалить `src/app/(public)/search/loading.tsx`: на `/search?city=<неизвестный>` стоит `notFound()` (`search/page.tsx:33`), и сейчас он тоже отдаёт 200;
  - `(auth)/login/loading.tsx` и `(app)/cabinet/loading.tsx` **не трогать**: это noindex- и приватные страницы.
- **Что ещё на них опирается:** ничего. grep по `src`, `tests` и `docs` находит только сами файлы и `docs/decisions/0006`. `LoadingState` остаётся в использовании, его тест передаёт текст пропом. Других `Suspense` над страницами нет: единственный, в `YandexMetrika`, — соседний узел, а не предок `children`. Отдельного `(public)/layout.tsx` нет. Обратную связь при навигации даёт `NextTopLoader` в корневом layout.
- **Почему 404 и 308 станут настоящими** (по документации Next):
  - `loading.md`, раздел Status Codes: «The response body starts streaming when a Suspense fallback renders (for example, a `loading.tsx`)… not possible to change the status code after streaming started»;
  - `not-found.md`: «200 for streamed responses, and 404 for non-streamed»;
  - `permanentRedirect.md`: «in a streaming context… meta tag… Otherwise, it serves a 308».
  - Без `loading.tsx` над `page` нет ни одной Suspense-границы. Оболочка ответа (shell) включает страницу целиком, и `notFound()` или `permanentRedirect()` срабатывают до отправки заголовков.
  - Эмпирически это уже доказано F2: `/u/[id]` под тем же асинхронным layout и тем же асинхронным `not-found.tsx` отдаёт настоящий 404.
- **Документация:**
  - `docs/BACKLOG.md`: удалить раздел «Статус ответа врёт…». Причина, названная там (асинхронный layout и edge-middleware), опровергнута фактом F2, а дефект закрыт.
  - `docs/seo.md`, раздел «Канонические адреса»: редирект теперь настоящий 308, убрать абзац про 200 + meta refresh и `NEEDS REVIEW`.
  - Новый `docs/decisions/0024-no-loading-boundary-in-public-catalog.md`: он отменяет часть 0006 («`loading.tsx` оставлен»). Скелетон стоил статусов и порядка контента, выигрыш около 0,1 с (F14). В `0006` добавить строку-ссылку на 0024.
  - `docs/README.md`: добавить 0024 в список решений.
  - CLAUDE.md, «Ключевые ограничения»: строка «В публичном каталоге нет `loading.tsx`/Suspense над страницей — иначе 404/308 отдаются как 200».
- **Риски:**
  - При клиентской навигации старая страница держится около 0,3 с, пока работает top-loader. Prefetch динамических маршрутов без `loading` ничего не грузит заранее.
  - Регрессии зависания из 0006 не ожидается: по тем же замерам на 15.x зависание как раз *снималось* удалением `loading.tsx`. Проверить по стенду из 0006 (прод-сборка, CPU 6×, сеть 400 мс, 40 переключений вида).
- **Как проверить:**
  - новый тест `tests/app/no-public-loading.test.ts`: в `src/app/(public)/**` нет `loading.tsx`;
  - `pnpm build && pnpm start` → `pnpm seo:check http://localhost:3000`, проверки 1, 2, 3, 5.

## 2. Канонические ссылки на подкатегорию

- **Файлы:**
  - `src/lib/catalog/listing-path.ts`: новый `categoryPath(citySlug, cat, root?)` → `/{city}/{root}/{sub}` или `/{city}/{root}`.
  - `src/app/(public)/[city]/[seg]/[sub]/page.tsx`:
    - в ветке карточки у `resolve` добавить `root` (`getCategoryById(category.parentId)`, если `parentId` есть);
    - крошки: Главная / Город / **Корень** / **Подкатегория** / Название;
    - BreadcrumbList строится из тех же крошек;
    - ссылка «Ещё в категории» → `categoryPath(...)`.
  - `src/app/(public)/[city]/[seg]/page.tsx`: в `generateMetadata` для подкатегории canonical = `/{city}/{root}/{sub}` (подстраховка на случай, если редирект не сработал). Сам `permanentRedirect` после п. 1 даёт 308.
  - `src/app/sitemap.ts`: перейти на `categoryPath`.
- **Риски:** у объявления может быть корневая категория. Тогда крошка одна, и это покрыто тестом.
- **Как проверить:**
  - `tests/catalog/listing-path.test.ts` (`categoryPath`);
  - `tests/app/city-sub-page.test.ts`: крошки и JSON-LD карточки ведут на `/krasnodar/root/sub`; моки `getCategoryById` дополнить;
  - seo:check, проверка 3.

## 3. robots.txt как route handler

- **Файлы:**
  - удалить `src/app/robots.ts`: тип `MetadataRoute.Robots` не умеет Clean-param, в нём только `userAgent/allow/disallow/crawlDelay/host/sitemap`;
  - новый `src/lib/seo/robots.ts`: `buildRobotsTxt(siteUrl): string`;
  - новый `src/app/robots.txt/route.ts`: `GET` → `text/plain; charset=utf-8`, `dynamic = "force-dynamic"`, URL сайта из `getEnv().NEXTAUTH_URL`.
- **Содержимое:**
  ```
  User-agent: *
  Disallow: /admin
  Disallow: /banned
  Disallow: /api/
  Disallow: /cabinet
  Disallow: /chat
  Disallow: /profile

  Clean-param: from&to&qty&loc&la&src&lp&view&sort&price_min&price_max&deposit&handover&verified
  Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&_rsc

  Sitemap: <base>/sitemap.xml
  ```
- **Решения:**
  - **Синтаксис Clean-param.** У Яндекса формат `Clean-param: p0[&p1…] [path]`. Директива межсекционная, строка до 500 символов, параметры регистрозависимы. Google её игнорирует. `Host` не пишем: Яндекс его упразднил.
  - **`page` в Clean-param не входит:** страницы пагинации различаются содержимым.
  - **`category` и `q` не входят:** они живут только на `/search`, а там noindex.
  - **`/search` не закрываем Disallow,** оставляем `noindex`. Запрещённую к обходу страницу робот не скачает и метатег не прочитает. Google при этом может держать в индексе голый URL по внутренним ссылкам — с главной на `/search` их 7 (F11). Довод уже записан в `docs/seo.md`, его сохраняем.
  - **`/login` и `/reset` тоже не Disallow, а `noindex` (п. 4).** На `/login` ведёт ссылка с каждой страницы, и Disallow оставил бы в Google индекс голых URL.
  - `/cabinet`, `/chat`, `/profile` для анонима всё равно дают 307 на `/login` (middleware). Disallow только экономит обход.
- **Риски:**
  - конфликт папки `robots.txt/` с `robots.ts`, поэтому `robots.ts` удалить в том же коммите;
  - проверить на прод-сборке, что отдаётся именно route handler.
- **Как проверить:**
  - переписать `tests/seo/robots.test.ts` на `buildRobotsTxt`: Disallow-список, обе строки Clean-param ≤ 500 символов, Sitemap абсолютный, нет `Host:`;
  - смоук-тест `GET` route handler (content-type);
  - seo:check, проверка 8;
  - после деплоя: «Анализ robots.txt» в Яндекс Вебмастере (выполняет пользователь).

## 4. noindex и canonical на служебных страницах

- **Файлы:**
  - `src/app/(auth)/login/page.tsx` и `src/app/(auth)/reset/page.tsx`: `metadata = { title: "Вход" / "Восстановление пароля", robots: { index: false, follow: true } }`;
  - `src/app/(public)/page.tsx`: `alternates: { canonical: "/" }` (работает через `metadataBase`, п. 7);
  - `src/app/(public)/privacy/page.tsx`: `description: content.privacy.intro`, `alternates.canonical "/privacy"`;
  - `src/app/(public)/sources/page.tsx`: `alternates.canonical "/sources"`.
- **Риски:** `/login` всё ещё стримится (свой `loading.tsx`), но YandexBot получает метаданные блокирующе (F13). Google стримовые метаданные в body читает: так сказано в `generate-metadata.md`, Streaming metadata.
- **Как проверить:**
  - `tests/app/sources.test.tsx` (canonical) и `tests/app/privacy.test.tsx` (description, canonical);
  - новый `tests/app/auth-metadata.test.ts`: robots и title;
  - seo:check, проверки 6 и 7.

## 5. Пустые страницы: настоящий 404 (или noindex)

- **Пустой корень в городе.** В `src/app/(public)/[city]/[seg]/page.tsx`, внутри `RootCategoryPage`, до рендера: `getListingCountsByCategory([city.id])` → `rollupToRoots` → при 0 `notFound()`. Как у подкатегории, по собственному городу, а не по scope «Где».
- **Синхронизация с деревом.** В `src/server/catalog.ts` → `buildCategoryTree`: корень фильтровать и по `own`-роллапу. Иначе с точкой «Где» дерево покажет корень, у которого всё лежит у соседа, и ссылка поведёт в 404 (у детей эта логика уже есть).
- **`?page` за пределом.** В `src/components/catalog/CategoryListing.tsx`: `if (page > 1 && page > totalPages) notFound()`. Пустая выдача на первой странице из-за фильтров остаётся 200 с EmptyState: это законная комбинация.
- **Город без объявлений: решение — НЕ 404, а `robots: noindex` плюс исключение из sitemap и футера.** Селектор города ведёт ровно на `/{slug}` (`citySwitchHref`), и только что активированный город отдавал бы людям «Страница не найдена».
  - Файлы: `src/app/(public)/[city]/page.tsx` (`generateMetadata` смотрит количество), `src/app/sitemap.ts` (пропускать город с суммой 0).
  - Если продукт хочет именно 404 — одна строка, но тогда надо прятать город из селектора. Это вопрос к пользователю.
- **Риски:** лишний COUNT-запрос на корне. Запрос лёгкий, тот же, что уже делается в дереве.
- **Как проверить:**
  - `tests/catalog/category-tree.test.ts`: корень без своих объявлений скрыт при `own`;
  - новый `tests/app/city-seg-page.test.ts`: пустой корень → `notFound`, непустой рендерится, подслаг → redirect с canonical;
  - тест на sitemap (новый `tests/app/sitemap.test.ts`): пустой город не попадает;
  - seo:check, проверка 4.

## 6. Заголовки и описания

- **Решение по родительному падежу: поле сейчас не заводить.** Нужна миграция, правка в админке (переименования категорий там нет вообще, есть только create/delete), а `ensureCategories` существующие строки не обновляет. Поле вернётся вместе с посадочными страницами. Шаблон без падежа, с сохранением регистра (имя стоит первым и не уходит в `toLowerCase`, поэтому VR остаётся VR).
- **Файлы:**
  - Новый `src/lib/seo/titles.ts` с чистыми функциями:
    - `catalogTitle(name, city, minPrice)` → «Экшн-камеры — аренда и прокат в Краснодаре, от 700 ₽/сутки»;
    - `catalogDescription(name, city, stats)` → «12 объявлений от 5 владельцев: экшн-камеры напрокат в Краснодаре, от 700 до 1 500 ₽/сутки. Залог, даты и заявка на бронь онлайн.» Используются `listingsCountLabel`/`ownersCountLabel` из `src/lib/catalog/format.ts`;
    - `cityTitle(city, minPrice)` → «Аренда и прокат вещей в Краснодаре — от 150 ₽/сутки»;
    - `listingTitle(title, city, price)` → «{title} — аренда в Краснодаре, 700 ₽/сутки». Не длиннее 65 символов: `title` обрезается по слову с «…», через `title.absolute`, без хвоста « — inrenta»;
    - `listingDescription(listing, city)`: сначала факты (цена, залог или «без залога», самовывоз/доставка), потом начало текста владельца, до 160 символов;
    - `lowerFirst(name)`: строчная первая буква, только если вторая тоже строчная (VR → VR).
  - `[city]/page.tsx`, `[seg]/page.tsx`, `[sub]/page.tsx`: `generateMetadata` через эти функции. Цена «от» и количество — `getCategoryStats([city.id], ids)`, это +1 запрос в метаданных.
  - H1 категории и подкатегории → «{Name} — аренда и прокат в {городе}». Это видимый текст, **нужно согласие пользователя**.
- **proseCity.** В `src/lib/catalog/city-locative.ts` удалить `proseCity`. Без падежа она давала « , Казань» (пробел перед запятой: шаблон `…сутки ${proseCity}`). Везде использовать `headingCity` («в Казани» или «· Казань»). На проде баг спит: у обоих городов падеж заполнен.
- **Два «Аксессуара».** Кастомная миграция `pnpm drizzle-kit generate --custom` с `UPDATE categories SET name=… WHERE slug IN ('aksessuary-odezhda','aksessuary-elektronika')` → «Аксессуары к одежде» и «Аксессуары для электроники». Те же имена — в `src/lib/seed/categories.ts`. Слаги и URL не меняются. Это видимый текст, **нужно согласие**.
- **Риски:**
  - смена title переиндексирует сниппеты, это ожидаемо;
  - формулировки — вопрос вкуса, требуют утверждения;
  - выбор «аренда» или «прокат» в начале строки — по Wordstat, это вне плана.
- **Как проверить:**
  - новый `tests/seo/titles.test.ts`: VR, длина ≤ 65, обрезка по слову, город без падежа без « ,», цена null;
  - `tests/catalog/city-locative.test.ts`: `headingCity` с `nameLocative: null`;
  - `city-sub-page.test.ts`: метаданные.

## 7. Open Graph и metadataBase

- **Корневой layout.** `src/app/layout.tsx`: `metadata` → `generateMetadata()`, иначе URL фиксируется при импорте модуля. Возвращает `metadataBase: new URL(getEnv().NEXTAUTH_URL)` и `openGraph: { type: "website", siteName, locale: "ru_RU", images: [seo.ogDefault] }`.
- **Помощник для страниц.** Новый `src/lib/seo/page-metadata.ts`: `pageMetadata({ title, description, path, image? })` возвращает `title`, `description`, `alternates.canonical`, `openGraph` (с siteName/locale/url/images) и `twitter.card`. Нужен потому, что метаданные сегментов сливаются **поверхностно** (`generate-metadata.md`: «shallowly merged… Duplicate keys are replaced»). Страница с собственным `openGraph` теряет siteName и locale, а без него наследует og:title главной. Поэтому все публичные страницы идут через этот помощник.
- **Карточка:** `image = photos[0].url`, URL абсолютный, из S3.
- **og-default.png.** Его нет (F1). Решение — сделать: новая цель в `scripts/build-icons.ts`, `public/og-default.png` 1200×630, знак из `theme/brand/icon.svg` на `seo.themeColor`. Обновить `icons.lock.json`.
  - `NEEDS REVIEW`: устроит ли пользователя картинка без текста. Альтернатива — убрать `ogDefault`, тогда у главной и категорий картинки при шаринге не будет.
- **Риски:**
  - `NEEDS REVIEW`: VK превью webp-обложек не проверялось. Фото хранятся в webp, Telegram и Facebook webp принимают;
  - `metadata.icons` не задавать (ловушка описана в `seo.md`).
- **Как проверить:**
  - новый `tests/seo/page-metadata.test.ts`;
  - `tests/app/icons.test.ts` (lock);
  - seo:check, проверка 9.

## 8. IndexNow

- **Файлы:**
  - Новый `src/app/indexnow.txt/route.ts`: `GET` отдаёт `INDEXNOW_KEY` как `text/plain`, без ключа — 404. Статический сегмент имеет приоритет над `[city]`.
  - `src/lib/indexnow.ts`: `keyLocation = ${siteUrl}/indexnow.txt`; логировать HTTP-статус ответа (200/202 — ок, 403 — ключ не принят, 422/429).
  - Новый `src/server/indexnow.ts`:
    - `scheduleIndexNow(listingIds)` → `after(async () => pingIndexNow(await getListingCanonicalUrls(ids)))`;
    - `getListingCanonicalUrls` — в `src/server/catalog.ts`, join cities + categories, **без фильтра по статусу**: скрытую вещь тоже надо отправить, чтобы робот увидел 404.
  - Вызовы:
    - `src/server/actions/owner.ts`: `createListing`, `updateListing`, `setListingStatus`;
    - `src/server/actions/admin.ts`: `adminSetListingStatus`; в `adminBanUser` и `adminUnbanUser` к UPDATE listings добавить `.returning({ id })`.
- **Почему фиксированный путь, а не `/{key}.txt`:**
  - не нужен ключ в git (сейчас DEPLOY 8.1 предлагает коммитить `public/<key>.txt`);
  - не нужен env в edge-middleware;
  - протокол IndexNow разрешает `keyLocation` на том же хосте, а файл в корне покрывает весь хост.
  - `NEEDS REVIEW`: что Яндекс принимает такой `keyLocation`, подтвердит только первый пинг на проде (в логе 200/202, не 403) или отчёт IndexNow в Вебмастере.
- **Почему `after()`:** работает в Server Functions; при self-hosting через `next start` или Docker поддерживается полностью (`after.md`, `self-hosting.md#after`). Вне запроса `after()` падает, поэтому тесты мокают `@/server/indexnow`.
- **Риски:**
  - пинг уходит на каждое сохранение формы. Это нормально для IndexNow, и лимит не задет;
  - в dev/test пинг выключен (`NODE_ENV`).
- **Деплой:** `docs/DEPLOY.md` 8.1 переписать: задать `INDEXNOW_KEY` в `.env`, пересоздать `app`, проверить `curl https://inrenta.ru/indexnow.txt`. Шаг с `public/` удалить. `docs/environment.md`, строки 114 и 174: переменная используется.
- **Как проверить:**
  - `tests/lib/indexnow.test.ts`: `keyLocation`, логирование статуса;
  - `tests/server/listing-actions.test.ts`: create/update/status зовут `scheduleIndexNow` с id; отказ по правам — не зовут;
  - новый тест route handler;
  - seo:check, проверка 12.

## 9. Внутренние ссылки

- **Файлы:**
  - `src/server/catalog.ts`: `getCitiesWithListings()` — `cache()`, `GROUP BY city_id` по активным объявлениям, пересечение с активными городами;
  - `src/app/layout.tsx`: добавить в существующий `Promise.all`, с try/catch → `[]`, чтобы ошибка БД не роняла каждую страницу;
  - `src/components/layout/Footer.tsx`: проп `cities`, колонка «города» со ссылками `/{slug}`. Компонент остаётся синхронным ради существующего теста. Сетку `lg:grid-cols-[1.5fr_repeat(3,1fr)]` расширить до четырёх колонок; на мобайле остаются 2 колонки, без горизонтального скролла;
  - `theme/content.ts`: `footer.citiesTitle`.
- **Только заметка, без изменений:** чипы «Часто ищут» ведут на `/search` (noindex). Ссылочный вес уходит в noindex-страницу, лечится посадочными страницами, а они вне плана.
- **Риски:** +1 лёгкий запрос на каждый рендер, в том числе на приватных страницах.
- **Как проверить:**
  - `tests/components/layout/Footer.test.tsx`: города рендерятся ссылками, пустой список — колонки нет;
  - `curl / | grep 'href="/yablonovskiy"'`.

## 10. JSON-LD

- **Файл `src/lib/jsonld.ts`:**
  - в Offer добавить `priceSpecification: { "@type": "UnitPriceSpecification", price, priceCurrency: "RUB", unitCode: "DAY", referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "DAY" } }` и `itemCondition: "https://schema.org/UsedCondition"`. По `itemCondition` есть продуктовое допущение: в базе нет поля «новое/б/у», так что `NEEDS REVIEW`;
  - новые `buildOrganizationJsonLd` (name, url, logo = абсолютный `/icons/icon-512.png`, email из `content.site.contactEmail`) и `buildWebSiteJsonLd` (name, url). `SearchAction` не добавляем: Google с ноября 2024 не показывает sitelinks search box.
- **Страницы:** `src/app/(public)/page.tsx` — Organization + WebSite; `src/app/(public)/[city]/page.tsx` — BreadcrumbList «Главная → Город».
- **Как проверить:**
  - `tests/seo/jsonld.test.ts`: priceSpecification, itemCondition, Organization, WebSite;
  - seo:check, проверка 10;
  - вручную: валидатор микроразметки Яндекса и Rich Results Test.

## 11. Документация и команды

Сам скрипт описан в п. 0.

- `CLAUDE.md`: строка `pnpm seo:check <url>   # статусы, h1 до footer, canonical, robots, OG, sitemap` в «Команды» и ограничение из п. 1.
- `docs/testing.md`: строка про seo:check в таблице команд.
- `docs/seo.md` переписать по разделам:
  - «Метаданные»: `metadataBase`, `pageMetadata`, шаблоны из `src/lib/seo/titles.ts`;
  - «Канонические адреса»: настоящий 308;
  - «robots.txt»: route handler, Clean-param, решение по `/search`, `/login`, `/reset`;
  - пустые страницы → 404 или noindex;
  - JSON-LD: новые типы;
  - Open Graph;
  - IndexNow;
  - из «Чего сейчас нет» убрать OG и IndexNow.
- `docs/BACKLOG.md`: удалить раздел про статусы (п. 1).
- `docs/architecture.md:367`: удалить пункт «indexnow не подключён».
- `docs/DEPLOY.md` 8.1 и `docs/environment.md` — см. п. 8.
- `docs/decisions/0024-…` (п. 1) и ссылка в `0006`; `docs/README.md` — индекс решений.

## 12. Тесты: сводка

- **Новые:**
  - `tests/scripts/seo-check.test.ts`
  - `tests/app/no-public-loading.test.ts`
  - `tests/app/city-seg-page.test.ts`
  - `tests/app/sitemap.test.ts`
  - `tests/app/auth-metadata.test.ts`
  - `tests/seo/titles.test.ts`
  - `tests/seo/page-metadata.test.ts`
  - тест route handler для `robots.txt` и `indexnow.txt` (`tests/seo/routes.test.ts`)
- **Изменить:**
  - `tests/seo/robots.test.ts` (переписать)
  - `tests/seo/jsonld.test.ts`
  - `tests/app/city-sub-page.test.ts`
  - `tests/app/sources.test.tsx`
  - `tests/app/privacy.test.tsx`
  - `tests/catalog/listing-path.test.ts`
  - `tests/catalog/category-tree.test.ts`
  - `tests/catalog/city-locative.test.ts`
  - `tests/lib/indexnow.test.ts`
  - `tests/server/listing-actions.test.ts`
  - `tests/components/layout/Footer.test.tsx`
  - `tests/app/icons.test.ts` (lock)
- **Гейт:** `pnpm test`, `pnpm exec next typegen && pnpm exec tsc --noEmit`, `pnpm build && pnpm start` + `pnpm seo:check http://localhost:3000`, после деплоя `pnpm seo:check https://inrenta.ru`.

## Порядок коммитов

1. seo:check + базовая линия по проду.
2. П. 1 (P0) + ADR 0024 — отдельный деплой и прогон seo:check.
3. П. 2, 3, 4, 5.
4. П. 7, 10.
5. П. 6 — после утверждения формулировок и переименования «Аксессуаров».
6. П. 8, 9.
7. Документация закрывает каждый коммит, а не идёт хвостом.

## Что осознанно НЕ входит в план

- Посадочные страницы под вещи (`/{city}/arenda-…`) и порог индексации.
- Агломерация: Яблоновский в индексируемой выдаче Краснодара, отдельный ADR.
- Wordstat и выбор «аренда» или «прокат» в начале title.
- Поле родительного падежа у категорий.
- Отзывы и `AggregateRating`.
- Страница «О проекте/Контакты» с реквизитами.
- Карта.
- Переход `middleware` → `proxy`.
- `global-not-found.tsx`.
- Canonical пагинации: сейчас `?page=N` → страница 1, оставлено как есть.
- Динамические OG-картинки (`opengraph-image`).
- Что пользователь делает вне кода: Яндекс Вебмастер с регионом, Google Search Console, Яндекс Бизнес, Метрика на проде.

## Что не удалось проверить (NEEDS REVIEW)

1. Принимает ли Яндекс `keyLocation=/indexnow.txt`: только первым пингом на проде.
2. Превью webp-обложек в VK.
3. Дизайн `og-default.png` без текста.
4. `itemCondition: UsedCondition` как умолчание для всех объявлений.
5. Продуктовое решение «пустой город = noindex, а не 404».
6. Формулировки H1 и title, переименование «Аксессуаров».
7. Отсутствие зависаний навигации без `loading.tsx` на 16.3.3: перепрогнать стенд из ADR 0006.

## Замечания ревью плана и решения

| № | Замечание | Решение |
|---|---|---|
| 1 | `MetadataRoute.Robots` умеет Clean-param через `other` | Принято: п. 3 — правка `src/app/robots.ts` (`other: { "Clean-param": [...] }`, расширенный `disallow`), без route handler и `src/lib/seo/robots.ts` |
| 2 | 404 пустого корня ломает «Где» и подсказки разделов (корень есть только у соседнего города) | Принято: пустой по своему городу корень — 404 только без валидной точки «Где»; с точкой и ненулевым счётчиком по региону — 200 + `noindex`. Тест на путь `/{city}/{root}?loc=…` |
| 3 | Без `loading.tsx` `router.push` (поиск, даты) идёт без отклика | Принято: `search/loading.tsx` остаётся (noindex, SEO не мешает); `router.push` в SearchBar и DateRangeFilter — через `useRouter` из `nextjs-toploader/app`, чтобы полоска загрузки показывалась. Риск дописан в п. 1 |
| 4 | `tests/server/search-invalidation.test.ts` упадёт на `after()` | Принято: мок `@/server/indexnow` в нём |
| 5 | og:title Next дописывает сам из title | Принято: общий `openGraph` в layout (type, siteName, locale, images) + свой `openGraph` только у карточки; помощник `pageMetadata` не нужен |
| 6 | BACKLOG «Статус ответа врёт» удалять целиком нельзя | Принято: раздел сузить до `cabinet`/`login`, границы — в ADR 0024 |
| 7 | IndexNow: старый адрес при смене слага/категории/города; пинг после коммита в бане; `force-dynamic` | Принято все три; эндпоинт — `yandex.com/indexnow` |
| 8 | Двойной источник URL сайта; сборка без `.env` | Принято: один хелпер URL сайта (с обрезкой `/`), в гейт — `pnpm build` без `.env` |
| 9 | Футер: GROUP BY на каждой странице | Принято: колонка «Города» — из уже закэшированного `getActiveCities`; пустой город и так noindex |
| 10 | Двойные запросы `getCategoryStats` / счётчиков | Принято: `cache()` |
| 11 | `itemCondition: UsedCondition` не подтверждается; og:image без размеров | Принято: `itemCondition` не ставим; `og:image` с width/height из `photosJson` |
| 12 | seo:check: F10 не проверяется; проверка 4 зависит от данных | Принято: формулировка исправлена, проверка 4 берёт корень из sitemap другого города или пропускается с пометкой |

## Решения пользователя (2026-10-06)

- **Заголовки** — по шаблону п. 6: «{Раздел} — аренда и прокат {в городе}, от N ₽/сутки»; H1 — «{Раздел} — аренда и прокат {в городе}». Город — город страницы (`headingCity`: «в Краснодаре», «в Яблоновском», для нового города — из `cities.name_locative`, без падежа — «· Казань»).
- **«Аксессуары»** переименовать в «Аксессуары к одежде» и «Аксессуары для электроники» (слаги не меняются).
- **OG-картинка по умолчанию** — знак `[inrenta]` как в шапке (скобки охрой, слово шрифтом сайта), 1200×630; собирается на этапе сборки через `opengraph-image` (ImageResponse) или скриптом иконок — выбрать то, что даёт тот же шрифт без внешних запросов.
- **Пустой город** — `noindex`, не 404.
- **Новое: кнопка «Поделиться» на карточке объявления.** Телефон — Web Share API (системный лист); десктоп и без Web Share — меню: «Скопировать ссылку», Telegram, WhatsApp, VK. Делится канонической ссылкой без `from/to/qty/loc/la/src/lp`. Иконки — lucide, цвета — токены; тексты — `theme/content.ts`. Входит в коммит с Open Graph (п. 7). Тесты: Web Share вызывается с title/url; запасное меню; копирование; ссылка без параметров.
