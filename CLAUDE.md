# inrenta — маркетплейс аренды вещей

Веб-сервис «арендуй что угодно рядом» в духе Авито, но для аренды. Вещи
размещают **прокатные сервисы** и **частные лица**; в продукте они не
различаются — аккаунт один, любой и размещает, и бронирует. Платежей внутри
нет — сервис сводит стороны и ведёт заявки на бронь, оплата и залог остаются
между ними.

Проект называется **inrenta**. Имя `prokat` осталось только у репозитория на
GitHub и у локального каталога — это рабочая заглушка с начала разработки, в
коде и текстах её быть не должно. Запрет касается имени проекта: слово
«прокат» как понятие предметной области — обычная лексика текстов.

Общение и UI — на русском; идентификаторы кода и commit-сообщения — на английском.

## Стек

- **Fullstack:** Next.js 16 (App Router, Server Components, Server Actions),
  React 19, TypeScript strict. SSR на всех публичных страницах.
- **БД:** PostgreSQL 16 + Drizzle ORM. Схема — `drizzle/schema.ts`.
- **Auth:** Auth.js v5, database-сессии. Яндекс ID, VK ID (свой OAuth 2.1 +
  PKCE), почта с паролем (argon2id).
- **Storage:** S3-совместимое, изображения через `sharp` → webp.
- **Стили:** Tailwind + CSS-токены в `theme/`, светлая и тёмная темы.
- **Тесты:** Vitest, только в `tests/**`.
- **Деплой:** docker-compose (Caddy + app + Postgres + backup).

## Команды

```bash
pnpm dev                 # dev-сервер (перед pnpm build остановить — общий .next)
pnpm dev:realtime        # процесс доставки в реальном времени, рядом с dev
pnpm build               # production-сборка
pnpm test                # vitest
pnpm exec next typegen   # типы роутов (нужны tsc при typedRoutes)
pnpm exec tsc --noEmit   # проверка типов
pnpm check-theme         # проверка обязательных CSS-токенов
pnpm build:icons         # иконки из theme/brand/*.svg (после правки исходников)
pnpm db:generate         # миграция из drizzle/schema.ts
pnpm db:migrate          # применить миграции
pnpm db:seed             # демо-данные (идемпотентно)
pnpm db:seed:real        # реальные данные из seed_real/ (идемпотентно)
pnpm seed:photos         # фотографии сида: обработать и залить в бакет
pnpm db:studio           # drizzle studio
```

Линтера нет: конфигурации ESLint в проекте не заведено, а команду `next lint`
в Next 16 удалили — скрипта `lint` больше нет. Подробности —
[docs/testing.md](docs/testing.md).

Поднять окружение: `docker compose up -d db` → `pnpm db:migrate && pnpm db:seed`
→ `pnpm dev`. Быстрый вход в dev: `GET /api/dev/login` (или `?role=admin`).

## Архитектурные принципы

Зависимости идут в одну сторону: `app → server → lib → db`.

| Слой | Отвечает за |
|---|---|
| `src/app/**` | роуты, страницы, метаданные |
| `src/server/*.ts` | чтение данных |
| `src/server/actions/*.ts` | мутации (Server Actions) |
| `src/lib/**` | доменная логика без БД + инфраструктура |
| `src/components/**` | UI |
| `drizzle/schema.ts` | схема БД |
| `realtime/*.ts` | процесс доставки: сокет, реестр, LISTEN |
| `theme/**` | токены, шрифты, тексты, SEO-дефолты |

Псевдонимы: `@/` → `src`, `@theme/` → `theme`, `@db/` → `drizzle`.

Подробно — [docs/architecture.md](docs/architecture.md).

## Рабочий процесс

Задача, которая меняет поведение, идёт по циклу:

1. **План.** Короткий: что меняется, каких слоёв и файлов касается, чего задача
   осознанно не делает. Обычная задача — план в ответе или в plan mode, отдельным
   `.md` в репозиторий он не кладётся. Крупная — план файлом в
   `docs/plans/current/`, который удаляется по завершении задачи.
2. **Ревью плана.** План читает отдельный агент со свежим контекстом и ищет
   пропущенные слои, непроверенные допущения и риски.
3. **Утверждение.** План и замечания к нему показываются целиком. Пока план не
   утверждён, код не пишется.
4. **Реализация** по утверждённому плану. Отклонение от плана называется вслух,
   а не проходит молча.
5. **Проверки:** `pnpm test` и `pnpm exec next typegen && pnpm exec tsc
   --noEmit`; плюс `pnpm check-theme`, если трогали `theme/tokens.css`.
6. **Ревью кода.** Диф против плана и правил этого файла читает отдельный агент
   со свежим контекстом. Каждая находка либо чинится, либо получает
   обоснованный отказ; итог показывается вместе с результатом задачи.

Ревью на обоих шагах делает **не тот контекст, который писал**: цель — поймать
неверно понятую задачу, а не только опечатки.

Исключение — косметика: текст, отступ, цвет, токен, опечатка, переименование.
Там сразу диф, без плана и ревью. Если неясно, косметика это или нет, —
считать, что нет.

## Правила разработки

- **Проверять права в самой мутации.** Server Action доступен по сети напрямую,
  минуя UI. Гарда на странице недостаточно.
- **Валидировать входные данные zod'ом** в actions: payload приходит извне и
  типу не соответствует автоматически.
- **Темы и адаптив обязательны на каждом экране.** Цвета — только через токены
  `theme/tokens.css`, не хардкодить. Мобайл проектируется первым классом, без
  горизонтального скролла body. Внимание: зелёный — это `--color-primary`,
  а `--color-accent` это охра.
- **Тесты только в `tests/**`**, импорт через `@/`. Тест рядом с исходником не
  запустится.
- **Коммиты** чистые и осмысленные, без нарратива задач и планов в теле.
  Идентификаторы и сообщения — на английском.

## Ключевые ограничения

- **Премодерации нет** — объявление публикуется сразу `active`.
- **Крона нет.** Единственный планировщик в проде — контейнер бэкапа.
  Протухание заявок, закрытие аренды по прошедшим датам и чистка прочитанных
  уведомлений ленивые, перед чтением списков.
- **Процессов в проде два.** `app` и `realtime` общаются только через Postgres
  (`LISTEN/NOTIFY`); прямых вызовов между ними нет. Лимитер поэтому тоже в двух
  экземплярах.
- **Rate limiter в памяти процесса** — обнуляется рестартом, не переживёт
  масштабирование.
- **Индекс поиска «Что» в памяти `app`** — один на процесс, не переживёт
  масштабирование; см. [0022](docs/decisions/0022-search-index-in-app-memory.md).
- **Даты держит только подтверждённая заявка.** Создание заявки календарь не
  трогает.
- **Диапазон брони включает обе границы.**
- **`emailVerified` не означает «аккаунт живой»** — у OAuth-пользователей он
  всегда `NULL`. Признак способа входа — строки в `accounts`.
- **Без `STORAGE_*` локально** `/api/upload` отвечает 503; это нормально.

## Документация

| Нужно | Читать |
|---|---|
| куда положить новую логику | [docs/architecture.md](docs/architecture.md) |
| правила брони, занятости, статусы | [docs/domain.md](docs/domain.md) |
| вход, сессии, письма, доступ | [docs/auth.md](docs/auth.md) |
| загрузка картинок, обложки | [docs/media.md](docs/media.md) |
| метаданные, sitemap, JSON-LD | [docs/seo.md](docs/seo.md) |
| цвета, скругления, кант, тени | [theme/tokens.schema.md](theme/tokens.schema.md) |
| переменные окружения | [docs/environment.md](docs/environment.md) |
| тесты и проверки | [docs/testing.md](docs/testing.md) |
| деплой и эксплуатация | [docs/DEPLOY.md](docs/DEPLOY.md) |
| восстановление БД | [docs/RECOVERY.md](docs/RECOVERY.md) |
| почему сделано именно так | [docs/decisions/](docs/decisions/) |
| что осознанно отложено | [docs/BACKLOG.md](docs/BACKLOG.md) |
| планы незавершённых крупных задач | [docs/plans/current/](docs/plans/current/) |

Оглавление — [docs/README.md](docs/README.md).

## Documentation Policy

Documentation describes the CURRENT state of the project.

Do not create documentation for temporary implementation plans. The single
exception is a large task: its plan lives in `docs/plans/current/` while the work
is in progress. That directory holds plans of unfinished tasks only.

After completing a task:

- update existing documentation if the current system changed;
- record significant architectural decisions in `docs/decisions/`;
- delete the task's plan from `docs/plans/current/` — what matters from it moves
  into `docs/decisions/`, the rest stays in git history.

Do not duplicate the same fact across multiple documentation files.

When documentation conflicts with the code, treat the code as the current source
of truth and update the documentation.

**If you are unsure how something works, inspect the code before documenting it.
Never guess.** Если после изучения кода однозначного ответа нет — пиши
`NEEDS REVIEW` и объясняй, что именно не удалось установить.

### Что проверить перед завершением задачи

Если задача изменила поведение системы, архитектурный подход, схему БД, API,
user flow, команды запуска/тестов/деплоя или важные ограничения — обнови
соответствующий документ **в той же задаче**. Если ничего из этого не менялось —
документацию писать не надо.

Не заводи новый `.md`, если факт можно корректно добавить в существующий.
Числа, статусы и списки файлов в прозе не пиши: они устаревают молча — вместо
них давай команду, которая покажет актуальный ответ.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
