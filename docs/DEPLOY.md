# inrenta — Deployment Guide

> Целевая платформа: **Timeweb Cloud VPS** 1×5GHz / 1GB / 15GB. Один сервер,
> docker-compose (caddy + app + db + backup), Let's Encrypt автоматически.
>
> Гайд проверен пилотным деплоем (июль 2026, тогда домен был fuddly.ru).
> Шаги идут в правильном порядке — SSH-ключ и DNS раньше всего, т.к. у них
> внешние задержки. `example.ru` в примерах = твой домен (`inrenta.ru`, как в
> `.env.example`).
>
> Назначение каждой переменной окружения — в [environment.md](environment.md);
> здесь только прод-специфика.

## 0. Pre-deploy smoke (на локальной машине)

Перед первым деплоем и перед каждым релизом:

1. `pnpm test` — зелёно (нужен локальный Postgres: `docker compose up -d db`)
2. `pnpm exec tsc --noEmit` — зелёно
3. `docker compose build app` и `docker compose build realtime` — обе сборки
   локально проходят. По одной за раз: без аргумента compose собирает сервисы
   параллельно, а `next build` на гигабайте требует swap и рядом со второй
   сборкой уходит в OOM

Только после зелёного — деплой.

## 1. SSH-ключ (до создания VPS)

Timeweb привязывает ключ на этапе создания сервера, поэтому сначала ключ:

```bash
# Если ключа ещё нет:
ssh-keygen -t ed25519 -C "inrenta-vps" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

timeweb.cloud → Профиль → SSH-ключи → Добавить → вставить `.pub` целиком.

## 2. Создаём VPS на Timeweb

1. timeweb.cloud → Облачные серверы → Создать
2. Образ: **Ubuntu 24.04 LTS**
3. Тариф: **1×5GHz / 1GB / 15GB / 200 Мбит** (825 ₽/мес)
4. Сеть: IPv4 (+180 ₽/мес) + IPv6, **без приватной сети**
5. SSH-ключ: выбрать загруженный
6. Создать. Через ~60 секунд VPS готов; записать публичный IPv4.

## 3. DNS (сразу после создания VPS — пропагация идёт параллельно)

Если домен тоже на Timeweb — в том же кабинете, DNS-записи домена.
Существующие MX/TXT (почта) не трогать. Добавить:

- A-запись `@` (корень) → `<IPv4>`
- A-запись `www` → `<IPv4>`

Проверка с локальной машины (Timeweb пропагирует за 5–15 минут):

```bash
dig +short example.ru @1.1.1.1 && dig +short www.example.ru @1.1.1.1
# Оба должны вернуть <IPv4>
```

## 4. Базовая настройка сервера

Подключение: `ssh root@<IP>` (или Termius: Keychain → импорт приватного
ключа, Host → address/root/ключ).

### 4.1. Обновление, timezone, swap (обязательно!)

Без swap `next build` на 1GB RAM падает в OOM — это не опция, а обязательный шаг:

```bash
apt update && apt upgrade -y
timedatectl set-timezone Europe/Moscow

fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h   # Swap: 2.0Gi
```

### 4.2. Firewall + fail2ban

```bash
apt install -y ufw fail2ban
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban
```

### 4.3. Docker + compose plugin (официальный репозиторий)

В Ubuntu-репо устаревший docker.io без compose v2 — ставим из docker.com:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker --version && docker compose version
```

### 4.4. Reboot (загрузить обновлённое ядро)

```bash
reboot
# Через ~60 сек переподключиться, проверить:
uname -r && docker ps && free -h
```

## 5. S3-buckets в Timeweb

Реальные параметры Timeweb S3 (проверено пилотом):

- Endpoint: `https://s3.twcstorage.ru` (общий для standard и cold)
- Регион: `ru-1`
- Имя бакета — UUID, генерируется Timeweb (не выбирается)
- Публичный URL — **path-style**: `https://s3.twcstorage.ru/<bucket-uuid>`

### 5.1. Бакет для картинок (Standard)

1. Timeweb → S3-хранилище → Создать → тип **Standard**, публичное чтение: да
2. Доступы → создать service-пользователя → записать access/secret
3. В `.env`:
   - `STORAGE_ENDPOINT=https://s3.twcstorage.ru`
   - `STORAGE_BUCKET=<bucket-uuid>`
   - `STORAGE_PUBLIC_BASE=https://s3.twcstorage.ru/<bucket-uuid>`

Проверить бакет, не дожидаясь первой загрузки фото:

```bash
pnpm check-storage      # значения берутся из .env
```

Скрипт кладёт временный объект, читает обратно, дёргает публичную ссылку и
удаляет за собой; в конце сообщает, не осталось ли мусора. Полезно после
создания бакета и после смены ключей — иначе неверная настройка вскрывается
только когда человек не смог загрузить фотографию.

### 5.2. Бакет для бэкапов (Cold)

1. Создать → тип **Cold**
2. Lifecycle: удаление объектов старше `BACKUP_RETENTION_DAYS` дней
   (`src/lib/analytics/limits.ts`). **Обязательно, а не по возможности:**
   политика конфиденциальности обещает, что удалённое из базы — аккаунт,
   отказ от учёта, статистика по сроку — остаётся в резервных копиях не дольше
   этого срока, и подставляет в текст ту же константу. Нет правила в тарифе —
   менять текст политики, а не молчать. Проверить: в панели Timeweb у бакета
   есть правило lifecycle, а самый старый `db/backup-*.sql.gz` не старше срока.
3. В `.env`: `BACKUP_S3_*` (endpoint тот же, bucket — UUID cold-бакета)

## 6. OAuth-приложения

Redirect URI **разные по механике** — Яндекс идёт через next-auth,
VK — через собственный PKCE-роут:

- Яндекс (oauth.yandex.ru): `https://example.ru/api/auth/callback/yandex`
- VK ID (id.vk.com): `https://example.ru/api/oauth/vk/callback` ← **не** `/api/auth/callback/vk`!

К существующему приложению можно просто добавить prod-URI рядом с
localhost-URI — отдельное приложение не обязательно. Изменения применяются
сразу, перезапуск не нужен.

### 6.1. Почта для регистрации по паролю

Ящик `noreply@<домен>` поднимается в Яндекс 360, в `.env` идут `SMTP_*` (все пять
или ни одной). **SPF и DKIM обязательны** — без них письма подтверждения уходят в
спам, и регистрация по почте перестаёт работать на практике, оставаясь «рабочей»
технически.

`SMTP_FROM` обязан совпадать с `SMTP_USER` — Яндекс не даёт отправлять от чужого
адреса. Ящик может быть тем же, что и контактный из `theme/content.ts`: тогда на
письма сервиса можно ответить. Цена — пароль приложения в `.env` даёт доступ на
чтение всей входящей почты этого ящика.

Без `SMTP_*` в проде форма входа по паролю остаётся, а регистрация и сброс скрыты:
завершить их без письма всё равно нельзя.

**Исходящие SMTP-порты у Timeweb закрыты по умолчанию** — 25, 465, 587 и 2525,
список виден в панели. Пока их не откроют, письма не уходят: соединение молча
уходит в таймаут, а в логе появляется `[mail] send failed ... Connection timeout`.
Открывают по заявке в поддержку; в заявке стоит указать, что письма транзакционные
(подтверждение регистрации и сброс пароля), рассылок нет, домен подтверждён,
а фаервол на самом сервере отключён. Проверка **до** первой регистрации:

```bash
# из каталога с docker-compose.yml, иначе «no configuration file provided»
docker compose exec app node -e "const s=require('net').connect(465,'smtp.yandex.ru');s.setTimeout(8000);s.on('connect',()=>{console.log('OK');s.end()});s.on('timeout',()=>{console.log('TIMEOUT');s.destroy()});s.on('error',e=>console.log('ERR',e.message||'(empty)'))"
```

`OK` — порт открыт. `ERR` с пустым сообщением — это `AggregateError` от Happy
Eyeballs: не прошли **все** адреса, детали лежат в `e.errors`. Проверять надо
именно изнутри контейнера: у хоста может быть IPv6, которого у контейнера нет,
и тогда `nc` с хоста покажет успех при нерабочей отправке.

## 7. Деплой кода

```bash
cd /opt
git clone https://github.com/<you>/prokat.git inrenta   # репозиторий ещё зовётся prokat
cd inrenta
```

Дальше все команды на сервере выполняются из каталога проекта — здесь
`/opt/inrenta`. Если сервер поднят в другом каталоге, `cd` в примерах ниже — в
него.

### 7.1. Прод `.env`

Секреты сгенерировать на локалке:

```bash
openssl rand -base64 32                          # NEXTAUTH_SECRET
openssl rand -base64 24 | tr -d '/+=' | head -c 32   # DB_PASSWORD (без спецсимволов — попадает в URL)
openssl rand -hex 16                             # INDEXNOW_KEY
openssl rand -hex 32                             # TELEGRAM_WEBHOOK_SECRET
```

Шаблон рабочего прод `.env` (все переменные обязательны, кроме помеченных):

```bash
# Здесь NODE_ENV нужен: его читает контейнер. В локальном .env его,
# наоборот, быть не должно — там next выставляет его сам.
NODE_ENV=production

DOMAIN=example.ru
LETSENCRYPT_EMAIL=you@example.com
NEXTAUTH_URL=https://example.ru
NEXTAUTH_SECRET=<openssl rand -base64 32>
# Обязательно за reverse-proxy: без этого Auth.js режет все /api/auth/* (UntrustedHost)
AUTH_TRUST_HOST=true

DB_PASSWORD=<пароль>
# Хост db — имя сервиса в docker-compose, не localhost. Приложению эту строку
# всё равно подставляет compose (блок environment сильнее env_file), но её читают
# миграции и psql с хоста, поэтому держим верной.
DATABASE_URL=postgres://app:<пароль>@db:5432/app

YANDEX_CLIENT_ID=...
YANDEX_CLIENT_SECRET=...
VK_CLIENT_ID=...
VK_CLIENT_SECRET=...

# Почта: все пять или ни одной. Пароль приложения из id.yandex.ru, не пароль
# от аккаунта. SMTP_FROM обязан совпадать с SMTP_USER.
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_USER=official@example.ru
SMTP_PASSWORD=...
SMTP_FROM=official@example.ru
BLOCKED_EMAIL_DOMAINS=          # опционально, дополняет встроенный стоп-лист

STORAGE_ENDPOINT=https://s3.twcstorage.ru
STORAGE_BUCKET=<bucket-uuid>
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
STORAGE_PUBLIC_BASE=https://s3.twcstorage.ru/<bucket-uuid>

BACKUP_S3_ENDPOINT=https://s3.twcstorage.ru
BACKUP_S3_BUCKET=<cold-bucket-uuid>
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...

INDEXNOW_KEY=<openssl rand -hex 16>
YANDEX_METRIKA_ID=          # опционально, пусто = метрика выключена

# Бот заявок: все четыре или ни одной (§8.5). BOOKING_FLOW=telegram — только
# после проверки бота, до того auth.
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=    # openssl rand -hex 32
TELEGRAM_ADMIN_CHAT_ID=
BOOKING_FLOW=auth
```

```bash
chmod 600 .env
```

> `STORAGE_PUBLIC_BASE` читают трое: рантайм, сборка и `caddy` — подробности в
> [environment.md](environment.md). docker-compose прокидывает его во все три
> места сам, от тебя нужно только заполнить `.env` до первого
> `docker compose build`.

### 7.2. Первый запуск

```bash
docker compose build app && docker compose build realtime && docker compose up -d
```

Первый билд на 1GB VPS — 10–15 минут. Дальше по кешу быстрее (~3–5 мин).

Миграции БД применяются **автоматически** при старте app-контейнера
(`scripts/entrypoint.sh`: сначала `node migrate.cjs`, потом `node server.js`).
Запускать вручную ничего не нужно. В runner-образе нет pnpm/tsx —
`docker compose exec app pnpm ...` не сработает.

### 7.3. Проверки

```bash
docker compose ps        # все 4 сервиса Up, app и db — (healthy)
docker compose logs app --tail=20    # "Migrations applied" + "Ready in ..."
docker compose logs caddy | grep -i "certificate obtained"
# Ожидаемо две строки: для example.ru и www.example.ru (~30–60 сек после старта)
```

С локальной машины:

```bash
curl -I https://example.ru
# HTTP/2 200 + strict-transport-security. x-frame-options нет: встраивание
# ограничивает frame-ancestors в CSP (пускает только интерфейс Метрики).
# content-security-policy: в img-src обязан стоять адрес из STORAGE_PUBLIC_BASE,
# в connect-src — wss://example.ru, есть worker-src 'self'. Одинокий `/` вместо
# адреса = переменная не доехала до контейнера caddy.
```

В браузере (**в инкогнито** — обычная вкладка может держать кеш от локального
dev-стека и сыпать "Failed to find Server Action"):

- `/` открывается, фотографии объявлений грузятся (это проверяет next/image + S3)
- Логин через Яндекс и VK проходит и возвращает на сайт
- Создание объявления с фотографией — файл появляется в бакете
- Регистрация по почте: письмо приходит (проверить, что не в спаме), ссылка
  подтверждает аккаунт и логинит, повторный вход по паролю работает
- Сброс пароля: письмо приходит, новый пароль применяется, старая сессия
  в другом браузере перестаёт работать
- `@node-rs/argon2` — нативный модуль: убедиться, что контейнер стартует и
  регистрация внутри него проходит (трассировка standalone-сборки)
- Консоль браузера чиста от `Refused to load` / `Refused to connect` — это CSP.
  Пройти главную, карточку объявления, чат (сокет), выбор обложки в кабинете и
  поле адреса в форме объявления: первые три задевают Метрику и `wss://`,
  обложка — единственную картинку, которая грузится прямо с домена хранилища,
  мимо next/image, поле адреса — воркер подсказок (`worker-src`)
- Своя статистика посещений: пройти главную → поиск → объявление, затем в
  `/admin/visitors` с переключателем «С ботами и своими заходами» (браузер
  админа помечен своим) видна лента этого браузера, а в `/admin/searches` —
  запрос. `/privacy` → «Не учитывать меня на этом устройстве» удаляет её, и
  новые заходы не пишутся. Отказ без JS (выключить JS в браузере) тоже
  срабатывает и возвращает к кнопке

## 8. Post-deploy ручные шаги

### 8.1. IndexNow

Ключ живёт только в `.env` — файла в `public/` и коммита не нужно: его отдаёт
приложение по адресу `/indexnow.txt`. Как и когда уходят пинги —
[seo.md, «IndexNow»](seo.md#indexnow).

```bash
cd /opt/inrenta
# в .env: INDEXNOW_KEY=<openssl rand -hex 16>   (см. 7.1)
docker compose up -d --force-recreate app     # пересоздание, не restart: env_file
curl https://example.ru/indexnow.txt          # вернёт ключ; 404 — ключа нет в окружении
```

После первой правки объявления в логе должен быть ответ поисковика:
`docker compose logs app | grep indexnow` — `200` или `202` значит ключ
принят, `403` — нет (проверить, что `/indexnow.txt` отдаёт тот же ключ).

### 8.2. Yandex.Metrika

1. metrica.yandex.ru → создать счётчик → ID в `.env` (`YANDEX_METRIKA_ID=`)
2. `docker compose up -d --force-recreate app realtime` (пересоздание, не restart!)
3. Network в DevTools: грузится `mc.yandex.ru/metrika/tag.js?id=<ID>`
4. Что и как пишет Метрика (Вебвизор, переходы, скрытые личные разделы,
   `token`, CSP) — [seo.md, «Аналитика»](seo.md#аналитика). После правки
   `Caddyfile` — `docker compose up -d --force-recreate caddy`.

### 8.3. Yandex Webmaster / Google Search Console

1. Верификация HTML-файлом → файл в `public/` → redeploy
2. Submit sitemap: `https://example.ru/sitemap.xml`
3. Вебмастер → «Анализ robots.txt»: директивы `Clean-param` приняты без ошибок
4. С локалки: `pnpm seo:check https://example.ru` — все проверки PASS
   ([testing.md](testing.md#проверка-seo-живого-сайта))

### 8.4. UptimeRobot + Telegram

Мониторов нужно **два**: `/api/health` следит за приложением, `/realtime-health`
за процессом доставки. Подмешивать второй в первый нельзя — падение
вспомогательного сервиса начало бы поднимать алерт «сайт лёг».

1. uptimerobot.com (free) → Add Monitor → HTTP(s) → `https://example.ru/api/health`,
   interval 5 min, alert after 2 failures
2. Telegram-алерт: бот у @BotFather → Alert Contact типа Webhook →
   URL `https://api.telegram.org/bot<TOKEN>/sendMessage`, POST JSON:
   `{"chat_id":"<CHAT_ID>","text":"*alertTypeFriendlyName* - *monitorFriendlyName*"}`

### 8.5. Бот заявок

Заявки без аккаунта уходят через Telegram-бота в админскую группу
([0028](decisions/0028-telegram-booking-leads.md)); переменные —
[environment.md, «Бот заявок»](environment.md#бот-заявок-все-четыре). Исходящий
доступ VPS к `api.telegram.org` нужен `app`: им уходят ответы клиенту и
карточки.

**1. Бот и группа — руками, один раз.**

- @BotFather: `/newbot` → токен и имя бота.
- Группа: создать, добавить бота. «Права → Добавление участников» — только
  админы: любой участник группы меняет статусы заявок кнопками.
- После этого в @BotFather `/setjoingroups` → Disable: больше бота никто
  никуда не добавит. Privacy mode не трогать — боту в группе нужны только
  нажатия кнопок.
- id группы — пока вебхук не установлен: написать в группе
  `/start@<имя_бота>` (с privacy mode бот видит в группе только команды) и
  открыть `https://api.telegram.org/bot<TOKEN>/getUpdates` —
  `message.chat.id`, отрицательное число.

**2. `.env` прода** — четыре `TELEGRAM_*` и `BOOKING_FLOW=auth` (§7.1), затем:

```bash
docker compose up -d --force-recreate app     # пересоздание, не restart: env_file
```

**3. Вебхук — с машины разработчика, из корня репозитория.** Токен и секрет —
прода, из его `.env`:

```bash
read -rs TELEGRAM_BOT_TOKEN && read -rs TELEGRAM_WEBHOOK_SECRET && export TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
pnpm exec tsx scripts/telegram-webhook.ts set --url https://example.ru/api/telegram/webhook
pnpm exec tsx scripts/telegram-webhook.ts info
```

`read -s` читает значение без эха, и в историю команд оно не попадает. Скрипт
зовётся через `tsx` напрямую, а не `pnpm tg:webhook`: тот читает локальный
`.env`, а здесь нужны значения прода — как у импорта геоданных ниже. Адрес
вебхука передаётся явно, не-https скрипт отклоняет. В `info` — адрес прода,
`pending_update_count` около нуля и нет `last_error_message`.

**4. Проверка — с телефона** (iPhone Safari и Android): `BOOKING_FLOW=telegram`
и `--force-recreate app`, затем на чужом объявлении выбрать даты →
«Забронировать в Telegram» → бот показал сводку → отправить. Карточка пришла в
группу, кнопки «Передал прокату» → «Взял» правят её. Затем «Нет Telegram?
Оставьте телефон» — карточка тоже пришла; в поле телефона маска
`+7 (900) 123-45-67`, и стёртая в середине цифра (на Android — Gboard и
клавиатура Samsung) не уводит курсор в конец. С `?_ym_debug=2` в консоли видно,
что `tg_booking_click` уходит до перехода в Telegram. Заявки из браузера админа
помечены тестовыми: в списке `/admin/leads` они есть, в счётчиках — нет.

**Включение и откат** — `BOOKING_FLOW=telegram` или `auth` в `.env` и
`docker compose up -d --force-recreate app`. Флаг меняет только кнопку брони:
бот и уже отправленные заявки работают при любом значении. Долгий сбой
Telegram — откат на `auth`.

**Смена секрета вебхука:** новый `TELEGRAM_WEBHOOK_SECRET` в `.env` →
`--force-recreate app` → `set` из шага 3 с новым секретом. Между вторым и
третьим шагом вебхук отвечает 401; Telegram держит недоставленные апдейты до
суток и повторит их после `set`. После смены токена (`/revoke` в @BotFather) —
те же шаги и тоже `set` заново.

**Группа стала супергруппой** (обычную группу Telegram переводит сам при
смене части настроек): в логе `app` строка `[telegram] chat migrated <новый id>`.
Новый id — в `TELEGRAM_ADMIN_CHAT_ID`, затем `--force-recreate app`.

**Здоровье** — `/admin/leads`: черновики без привязки (люди кликают, а
`/start` не доходит), очередь и последняя ошибка вебхука, недоставленные
карточки. Повтор карточек ленивый — без трафика он ждёт следующей заявки,
апдейта или захода в эту страницу. Лог — `docker compose logs app | grep
-E '\[(telegram|leads)\]'`.

## 9. Регулярные операции

### Разовый переезд с прежнего имени проекта

Нужен только тем, у кого сервер поднимался до того, как в `docker-compose.yml`
появилось `name: inrenta`. Раньше имя проекта бралось из имени каталога
(`/opt/prokat`), поэтому тома звались `prokat_pg_data`, `prokat_caddy_data`,
`prokat_caddy_config`. После смены имени compose создаст **новые пустые тома**:
база и сертификаты Let's Encrypt останутся в старых.

Порядок важен — контейнеры надо остановить, пока конфиг ещё старый, иначе
compose перестанет их видеть и они останутся висеть:

```bash
cd /opt/prokat
docker compose down          # ещё под старым именем проекта
git pull                     # приезжает name: inrenta

cd /opt && mv prokat inrenta && cd inrenta
docker compose build app && docker compose build realtime && docker compose up -d
docker compose logs --tail 30 app     # "Running migrations..." → "Starting Next.js..."
```

База поднимется пустой: миграции применятся сами, данные нужно засеять заново
(раздел «Сиды на проде»). Caddy заново запросит сертификаты — это нормально,
но не повторяйте переезд по несколько раз в неделю: у Let's Encrypt есть лимит
на повторный выпуск одинаковых сертификатов.

Убедившись, что всё работает, старые тома можно удалить:

```bash
docker volume ls | grep prokat
docker volume rm prokat_pg_data prokat_caddy_data prokat_caddy_config
```

### Обновление кода

```bash
cd /opt/inrenta
git pull
docker compose build app && docker compose up -d app
# Процесс доставки собирается и обновляется отдельно — он переживает рестарт
# app и наоборот, потому что общаются они только через базу.
docker compose build realtime && docker compose up -d realtime

# Caddyfile примонтирован файлом, поэтому compose видит сервис неизменным и сам
# по себе контейнер не трогает — отсюда --force-recreate. Просто restart тоже не
# годится: он поднимает контейнер со старым окружением, а переменные (например
# STORAGE_PUBLIC_BASE для CSP) фиксируются при создании.
docker compose up -d --force-recreate caddy
```

Миграции применятся сами при старте контейнера `app`.

Проверка после обновления:

```bash
docker compose ps                       # realtime — healthy
curl -sS https://example.ru/realtime-health   # {"ok":true,...}
```

**Откат без простоя.** `docker compose stop realtime` возвращает сайт к
поведению до задачи: сообщения доезжают при переходе по страницам, всплывашек и
кружка нет. Ломается только живая доставка — на это и рассчитано.

`realtime` при первом старте таблиц не читает, только `LISTEN`, поэтому порядка
относительно миграций не требует.

### Изменение `.env`

`docker compose restart` **не перечитывает** env_file! Только пересоздание:

```bash
docker compose up -d --force-recreate app realtime
# STORAGE_PUBLIC_BASE читает ещё и caddy (img-src в CSP) — тогда и его.
```

### Сиды на проде

Сиды в docker-образ не входят (entrypoint гоняет только миграции) — их
запускают с сервера. Два подводных камня: `npm run db:seed` не годится,
потому что скрипт читает `.env`, где адрес БД — `@db:5432` (хост docker-сети,
с сервера не резолвится, снаружи порт проброшен на `127.0.0.1:5432`); и
`NODE_ENV=production` обязателен, иначе сид раздаст владельцам dev-пароль
и `emailVerified`.

```bash
cd /opt/inrenta
npm install --legacy-peer-deps   # npm строже pnpm к peer deps (nodemailer 9 vs @auth/core)

NODE_ENV=production \
DATABASE_URL="postgres://app:$(grep '^DB_PASSWORD=' .env | cut -d= -f2)@127.0.0.1:5432/app" \
npx tsx scripts/seed.ts

rm -rf node_modules              # диск маленький, после сида зависимости не нужны
```

Успех: `Seeded: 1 city, … 5 owners, 20 listings…` и **без** строки про
dev-пароль. Сид идемпотентен: если город «Казань» уже есть — выйдет, ничего
не тронув.

#### Реальные данные

`scripts/seed-real.ts` наполняет базу витриной из `seed_real/` — настоящие
города, владельцы и объявления. Ставить на прод оба сида не нужно: демо-сид
кладёт вымышленные товары в Казани.

Шагов два, и они делаются на разных машинах. Фотографии уезжают в бакет
локально, база наполняется на сервере.

**Шаг 1. Фотографии в прод-бакет — с локальной машины, где лежат снимки.**

Папка `seed_real/Фото/` вне git, на сервере её нет и не будет. Заливка идёт в
тот бакет, на который смотрят `STORAGE_*`, поэтому один раз их надо навести на
прод:

```bash
STORAGE_ENDPOINT=https://s3.twcstorage.ru \
STORAGE_BUCKET=<prod-bucket-uuid> \
STORAGE_ACCESS_KEY_ID=<prod-key> \
STORAGE_SECRET_ACCESS_KEY=<prod-secret> \
STORAGE_PUBLIC_BASE=https://s3.twcstorage.ru/<prod-bucket-uuid> \
pnpm exec tsx scripts/seed-photos.ts
```

Переменные переданы в командной строке, а не через `.env`: подменять рабочий
`.env` прод-ключами и забыть вернуть — верный способ залить потом тестовый файл
в прод. Скрипт спрашивает бакет, чего в нём нет, и льёт только недостающее, —
прогонять повторно безопасно.

Дальше `seed_real/photos.json` коммитится и пушится. В нём лежат ключи и
размеры, но не адреса, поэтому один манифест обслуживает и локальный MinIO, и
прод.

**Шаг 2. База — на сервере.**

```bash
NODE_ENV=production \
DATABASE_URL="postgres://app:$(grep '^DB_PASSWORD=' .env | cut -d= -f2)@127.0.0.1:5432/app" \
STORAGE_PUBLIC_BASE="$(grep '^STORAGE_PUBLIC_BASE=' .env | cut -d= -f2-)" \
npx tsx scripts/seed-real.ts
```

Ни снимков, ни ключей доступа тут не нужно: адреса и размеры берутся из
манифеста, `STORAGE_PUBLIC_BASE` подставляется в них как префикс. В бакет
скрипт не ходит вовсе.

Успех: строка `Seeded from seed_real: …` и **без** строки про dev-пароль.
Владельцы из `seed_real` на проде войти не могут — пароля им не выдаётся,
OAuth у них нет, а домен `@seed.local` почту не принимает. Это витрина.

Повторный прогон обновляет строки, а не плодит копии: города сверяются по
слагу, владельцы по почте, объявления по паре (владелец, заголовок). Если
ничего не менялось, не выполняется ни одного `UPDATE` — `updated_at` стоит на
месте, и sitemap не сообщает поисковикам, что обновилось разом всё.

Чего сид не делает: не удаляет и не архивирует объявления, исчезнувшие из
таблиц (на них могут висеть заявки и переписки), и не поднимает статус у
объявлений, погашенных баном владельца.

#### Новые владельцы на живом проде

Когда на проде уже есть живые пользователи и объявления, полный прогон
`seed-real.ts` не годится: он перепишет из таблиц все города и всех владельцев
`seed_real`, включая то, что с тех пор поправили в админке. Новый прокат
добавляется точечно — флагом `--owners` с ключами из `users.csv`: пишутся
только эти владельцы и их объявления, города не трогаются вовсе, разделы
заводятся лишь те, что нужны их объявлениям, а dev-пароль не раздаётся даже
без `NODE_ENV=production`. Флаг `--dry-run` проводит ту же
запись в транзакции и откатывает её; отчёт перечисляет созданное (`+`) и
обновлённое (`~`, с именами полей).

Порядок:

1. **Код с нужными колонками уже на проде.** Если таблица использует
   `price_week`, `price_month`, `min_days`, сначала выкладывается код с
   миграцией тарифов (раздел «Обновление кода»): миграции применяет старт `app`.
   Миграция тарифов ставит CHECK'и и проверяет ими существующие строки; перед
   выкладкой стоит убедиться, что нарушать их нечему — ожидается `0`:

   ```bash
   docker compose exec db psql -U app -d app -c "select count(*) from listings where price_day <= 0;"
   ```

   Не ноль — эти цены правятся руками до выкладки, иначе `app` не стартует на
   миграции.
2. **Локально — точки адресов и проверка.** Города с геоданными требуют точек,
   а сверка города с точкой на проде пропускается (движок геокодера там не
   строится), поэтому таблицу проверяет локальный прогон:

   ```bash
   pnpm geo:backfill --csv seed_real/listings.csv
   pnpm db:seed:real --owners <key1>,<key2> --dry-run     # против локальной базы
   ```

3. **Локально — фотографии в прод-бакет**: шаг 1 раздела «Реальные данные»
   выше, тем же `seed-photos.ts` с прод-ключами в командной строке.
4. **Коммит и пуш** `seed_real/*.csv` и `seed_real/photos.json`, на сервере —
   `git pull --ff-only`.
5. **На сервере — dry-run.** `NODE_ENV=production` обязателен: без него сид
   раздаст новым владельцам dev-пароль и `emailVerified`.

   ```bash
   cd /opt/inrenta
   npm install --legacy-peer-deps

   NODE_ENV=production \
   DATABASE_URL="postgres://app:$(grep '^DB_PASSWORD=' .env | cut -d= -f2)@127.0.0.1:5432/app" \
   STORAGE_PUBLIC_BASE="$(grep '^STORAGE_PUBLIC_BASE=' .env | cut -d= -f2-)" \
   npx tsx scripts/seed-real.ts --owners <key1>,<key2> --dry-run
   ```

   Первая строка отчёта — `DRY RUN — транзакция откатана…`. Ожидается
   `Города: не трогаются (--owners)`, у владельцев и объявлений — только
   «создано», `обновлено 0`, и **нет** строки про dev-пароль. Любое `~` в
   отчёте — повод остановиться и разобраться: значит, строка с той же почтой
   или тем же заголовком у владельца в базе уже есть.
6. **Запуск** — та же команда без `--dry-run`. Успех: отчёт без строки `DRY
   RUN` и итог `Seeded from seed_real: cities untouched, …`. Потом
   `rm -rf node_modules`.

Повторный запуск безопасен: найденные по почте и заголовку строки без
изменений дают `без изменений`, а не копии.

#### Переход с демо-данных на реальные

Если прод уже засеян демо-сидом, реальный сид не заменит его, а встанет рядом:
Казань с двадцатью «Тестовый товар из сидов» останется в выдаче. Сначала надо
понять, есть ли в базе живые данные:

```bash
docker compose exec db psql -U app -d app -c "
select
  (select count(*) from users)                                          as всего_юзеров,
  (select count(*) from users where email in
     ('owner1@seed.local','owner2@seed.local','owner3@seed.local',
      'owner4@seed.local','owner5@seed.local'))                         as демо_владельцев,
  (select count(*) from users where email not like '%@seed.local'
      and email not like '%@local.test')                                as похоже_живых,
  (select count(*) from booking_requests)                               as заявок,
  (select count(*) from chat_messages)                                  as сообщений,
  (select string_agg(slug, ', ') from cities)                           as города;"
```

**Живых нет** — проще всего полный сброс (раздел ниже) и один `seed-real.ts`.

**Живые есть** — сброс отменяется, демо-владельцы удаляются точечно; каскад
уносит их объявления, заявки и переписки:

```bash
docker compose exec db psql -U app -d app -c "
delete from users where email in
  ('owner1@seed.local','owner2@seed.local','owner3@seed.local',
   'owner4@seed.local','owner5@seed.local');"
```

Перечислять адреса поимённо обязательно. Маска `like '%@seed.local'` снесла бы
вместе с демо и владельцев из `seed_real` — они на том же домене.

**Казань гасится в обоих случаях**, кроме полного сброса, где её просто не
будет:

```bash
docker compose exec db psql -U app -d app -c "
update cities set is_active = false where slug = 'kazan';"
```

Иначе она остаётся дефолтным городом главной: `getActiveCities()` сортирует
города по имени, «Казань» идёт раньше «Краснодара», а посетитель без куки и без
профиля попадает на первый активный город — то есть на пустую витрину.
Деактивация обратима и ничего не удаляет.

### Геоданные (адреса)

Адреса ищет свой геокодер ([0021](decisions/0021-own-geocoder-and-listing-coordinates.md)).
Его данные — таблицы `geo_*` по региону — наполняет только `pnpm geo:import` из
JSON-выгрузки региона (для Краснодара и Яблоновского — `index.krasnodar.json`,
регион `krasnodar`). В образ импорт не входит, и **на сервере он не
запускается**: разбор файла и вставка поднимают Node до ≈ 1,4 ГБ RSS (≈ 0,6 ГБ
с `--max-old-space-size=600`), а у VPS гигабайт на всё, включая живой `app`.
Импорт идёт с машины разработчика через SSH-туннель к прод-Postgres.

**1. Туннель.** Postgres на сервере слушает только `127.0.0.1:5432`, снаружи
порта нет — туннель единственный путь:

```bash
ssh -N -L 55432:127.0.0.1:5432 root@<IP>    # держать открытым до конца импорта
```

**2. Импорт — во втором терминале, из корня репозитория.** Пароль — `DB_PASSWORD`
из прод-`.env`:

```bash
DATABASE_URL="postgres://app:<DB_PASSWORD>@127.0.0.1:55432/app" NODE_OPTIONS=--max-old-space-size=600 pnpm exec tsx scripts/geo-import.ts <путь>/index.krasnodar.json --region krasnodar
```

Скрипт зовётся через `tsx` напрямую, а не `pnpm geo:import`: тот читает
локальный `.env`, а здесь вся конфигурация — в командной строке, как у сидов
выше. Успех: строка `Geo import krasnodar: version …; places …, streets …,
houses …, pois … (… s, peak RSS … MB)`. Импорт — одна транзакция: оборвался
туннель — остались прежние данные, повтор безопасен. Повтор того же файла даёт
то же состояние.

**3. Рестарт `app` — сразу после импорта, на сервере:**

```bash
docker compose restart app
```

Без него `app` в течение минуты заметит новую версию данных и соберёт новый
движок, ещё держа в памяти старый.

**4. Города.** Геокодер работает у города, которому заданы регион и центр
(`geo_region`, `lat`, `lon`). Задаются либо реальным сидом на сервере —
`seed_real/cities.csv` их несёт (раздел «Реальные данные» выше), — либо в
админке: «Города» → поля центра и «Геоданные». Админка предлагает только уже
загруженные регионы, поэтому сначала импорт.

**5. Проверка.**

```bash
curl -sG https://example.ru/api/geo/suggest \
  --data-urlencode city=yablonovskiy --data-urlencode 'q=гагарина 1'
# первым — «улица Гагарина, 1» в Яблоновском, а не в Краснодаре
```

**Первый выкат геокодера** — те же шаги по порядку: деплой кода (миграция с
таблицами `geo_*` применится на старте `app`) → импорт через туннель → рестарт
`app` → регион и центр городов → проверка.

#### Адреса объявлений

У объявления обязательный адрес с точкой
([domain.md](domain.md#адрес-получения)). Строкам, которые появились до этого,
адрес находит `geo:backfill`. Первый выкат адресов идёт **после** выката
геокодера (шаги 1–5 выше: импорт, рестарт, регион и центр городов) и сам
состоит из трёх шагов — именно в этом порядке.

**1. Деплой кода** — как в «Обновление кода» выше, вместе с пересозданием
`caddy`: в CSP добавлен `worker-src 'self'` для воркера подсказок адресов.
Миграция добавит колонки адреса на старте `app`. До шага 3 у старых объявлений
адреса нет: в каталоге они видны как раньше, но в кабинете помечены «Уточните
адрес», а их правка требует выбрать адрес из подсказок, — поэтому шаги 2 и 3
делаются сразу.

**2. Реальный сид на сервере** — команда из «Реальные данные» выше, с
`seed_real/listings.csv`, где у строк уже стоят `address`, `lat`, `lon`,
`precision` (их находит `pnpm geo:backfill --csv`, и таблицу проверяет человек
до коммита — [seed_real/README.md](../seed_real/README.md)). Сид идёт **до**
backfill: иначе `--db` геокодировал бы строки сида по сырым меткам, без
ручных правок таблицы. Таблицу, где у объявления в городе с геоданными нет
точки, сид не примет вовсе.

**3. Backfill остальных строк — с машины разработчика, через туннель.** Как
импорт: скрипт строит движок региона в своём процессе (сотни МБ), и на сервере
рядом с живым `app` его не запускают. Туннель — шаг 1 импорта выше; во втором
терминале:

```bash
DATABASE_URL="postgres://app:<DB_PASSWORD>@127.0.0.1:55432/app" pnpm exec tsx scripts/geo-backfill.ts --db
```

Скрипт берёт только строки без адреса — после шага 2 это объявления, которых
нет в `seed_real`, — и печатает таблицу «метка → найдено → точность». Ненайденные
получают адрес текстом без точки: в каталоге они остаются, а владелец
видит в кабинете «Уточните адрес». Повторный запуск безопасен; когда строк без
адреса нет, он так и пишет.

**Пересчёт подписей** — когда меняется правило подписей адреса (сейчас: подпись
всегда называет свой пункт, [domain.md](domain.md#адрес-получения)), а в базе
уже есть объявления с точкой, сохранённые по прежнему. Деплой кода и реальный
сид с пересчитанной таблицей (`--csv … --relabel`, см.
[seed_real/README.md](../seed_real/README.md)) идут первыми, затем — тем же
туннелем:

```bash
DATABASE_URL="postgres://app:<DB_PASSWORD>@127.0.0.1:55432/app" pnpm exec tsx scripts/geo-backfill.ts --db --relabel
```

Скрипт берёт строки с точкой, находит тот же адрес по сохранённой подписи рядом
с точкой и переписывает только `address` и `location` — точка, точность, город
и `updated_at` остаются. Печатает сменившиеся подписи «было → стало»; адреса,
которых рядом с точкой не нашлось (переимпорт геоданных убрал объект), —
списком с id объявления, их подписи не тронуты, код выхода 1. Такие подписи
правятся вручную тем же туннелем — иначе страница объявления покажет их без
пункта (город к точному адресу не дописывается):

```sql
UPDATE listings SET address = '<полная подпись>, <пункт>', location = '<подпись без дома>, <пункт>' WHERE id = '<id>';
```

Повторный запуск ничего не меняет.

**Проверка.** В форме нового объявления набрать улицу (поиск идёт в регионе
своего города, под полем — «В каталоге: …» после выбора): подсказки появляются, а в консоли браузера нет `Refused to create a worker` —
это CSP. На странице объявления из `seed_real` в блоке продавца — улица, ЖК
или пункт без номера дома. В шапке выбрать «Где» по адресу: на карточках
появляется расстояние, сортировка — «Ближе», над выдачей — «… и рядом».

#### Память: `docker stats`

Движок грузится лениво — первым запросом к `/api/geo/*`, а не стартом `app` и
не рендером страниц. Поэтому меряют дважды: после рестарта и после первой
подсказки адреса (тот же `curl`):

```bash
docker stats --no-stream $(docker compose ps -q app)
```

Ориентиры: замер на машине разработчика — ≈ +190 МБ RSS на движок Краснодара;
цифры исходного проекта — ≈ +80 МБ постоянно и ≈ +280 МБ пиком на ~15 с при
сборке. Сколько `app` держит на проде, известно только по этой проверке. Если
`app` упирается в лимит и сервер уходит в своп — аварийный выключатель.

#### Аварийный выключатель

Админка → «Города» → у каждого города региона «Геоданные: — нет —» →
сохранить, затем `docker compose restart app`: выключатель отключает поиск
адресов сразу, но память уже собранного движка освобождает только рестарт.
Подсказки и обратный геокодер для этих городов отвечают пусто (уже полученные
подсказки браузер держит до минуты — `private, max-age=60`), мини-индекс —
404; геоданные в базе остаются. Новый адрес объявления в таких городах
вводится текстом, без точки; сохранённые точки правка не трогает. Поле «Где»
в поиске пропадает, а `loc` старых ссылок выдачу не меняет: ни расстояний, ни
«Ближе», ни соседних городов.

Пока выключено, `db:seed:real` не гоняют с заполненной колонкой `geo_region` в
`seed_real/cities.csv`: сид пишет заполненную ячейку поверх пустой и включит
регион обратно. Включение — тот же выбор региона в админке; рестарт не нужен,
движок соберётся на первом запросе.

#### Обновление данных

Только вручную, крона нет. Свежая выгрузка собирается конвейером исходного
проекта (в inrenta он не перенесён — [BACKLOG](BACKLOG.md)), дальше — шаги 1–3
и проверка. Импорт заменяет регион целиком; метка данных меняется, и браузеры
сами скачают новый мини-индекс адресов. Гео-таблицы растут в каждом дампе
бэкапа на свой размер в Postgres; текущий:

```bash
docker compose exec db psql -U app -d app -c "select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class where relname like 'geo\_%' and relkind = 'r';"
```

### Полный сброс БД и пересев

```bash
cd /opt/inrenta
docker compose stop app
docker compose exec db psql -U app -d app -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose exec db psql -U app -d app -c "DROP SCHEMA IF EXISTS drizzle CASCADE;"
docker compose up -d app         # миграции применятся на старте; проверить логи!
docker compose logs --tail 20 app   # ждём "Running migrations..." → "Starting Next.js..."
```

Затем сиды — блоком выше. Если сид падает с `relation "cities" does not
exist` — app после сброса не поднялся и миграции не прогнались: смотреть
`docker compose ps` и логи, либо накатить руками тем же способом, что сид
(`npx tsx scripts/migrate.ts` с тем же `DATABASE_URL`).

Если менялся `STORAGE_PUBLIC_BASE` — нужен ещё и rebuild (он запечён в билд) и
пересоздание `caddy` (адрес стоит в `img-src` политики CSP).

### Удаление аккаунта по запросу

Политика обещает удалить аккаунт по письму (`deleteBody` в `theme/content.ts`).
Кнопки для этого нет — удаление делается SQL. Сначала убедиться, что это тот
аккаунт, и выписать ключи его файлов (после удаления их уже не найти):

```bash
docker compose exec db psql -U app -d app -c "
select id, email, name, role, created_at,
  (select count(*) from listings l where l.owner_user_id = users.id)      as объявлений,
  (select count(*) from booking_requests b where b.customer_user_id = users.id
                                            or b.owner_user_id = users.id) as заявок,
  (select count(*) from visitors v where v.user_id = users.id)            as браузеров
from users where email = 'person@example.ru';"
docker compose exec db psql -U app -d app -c "
select key from uploads where user_id = (select id from users where email = 'person@example.ru');"
```

Потом удалить одной строкой. Каскад уносит входы и сессии, объявления с их
заявками и переписками, заявки и переписки человека по чужим вещам,
уведомления, реестр загрузок, а также его браузеры и события своей статистики
(`visitors`, `visitor_events`). В журнале сделок `events` строки остаются без
автора (`user_id` → `NULL`):

```bash
docker compose exec db psql -U app -d app -c "
delete from users where email = 'person@example.ru';"
```

Чего каскад не делает:

- **Файлы в бакете остаются** — из хранилища не удаляется ничего
  ([BACKLOG.md](BACKLOG.md#уборка-файлы-и-архив-никто-не-удаляет)). Фото и
  обложку убирать руками по выписанным ключам.
- **Резервные копии** держат удалённое до `BACKUP_RETENTION_DAYS` — так и
  сказано в политике (см. «Бакет для бэкапов»).
- **История гостя до входа** с аккаунтом не связана и с ним не уходит. По
  письму её можно найти, только если человек пришлёт ClientID Метрики (кука
  `_ym_uid` его браузера):

  ```bash
  docker compose exec db psql -U app -d app -c "
  delete from visitors where user_id is null and (ym_client_id = '<ClientID>'
    or id in (select visitor_id from visitor_events
              where type = 'ym_client' and props->>'cid' = '<ClientID>'));"
  ```

  Проще ему нажать «Не учитывать меня на этом устройстве» на `/privacy` в том
  браузере: это удаляет сразу и нынешнюю историю браузера, и историю под его
  прежними id из куки `vid_prev` — до входа в аккаунт и после выхода (не больше
  `PREVIOUS_VISITORS_MAX` последних; более давние уходят по сроку хранения).

### Логи

```bash
docker compose logs -f --tail=200 app
docker compose logs -f --tail=200 caddy
docker compose logs backup --tail=50
```

### Бэкапы

Ежедневно ~03:00 MSK в cold-бакет `db/backup-YYYY-MM-DD-HHMM.sql.gz`.
Ручной прогон: `docker compose exec backup sh /backup.sh`.
Восстановление: [`docs/RECOVERY.md`](./RECOVERY.md).

## 10. Troubleshooting (реальные кейсы пилота)

| Симптом | Причина | Действие |
|---|---|---|
| `[auth][error] UntrustedHost` на все /api/auth/* | Нет `AUTH_TRUST_HOST=true` в `.env` | Добавить + `up -d --force-recreate app realtime` |
| OAuth-редирект уводит на `http://<container-id>:3000` | Редиректы строились от `req.url` | Исправлено в коде (base = `NEXTAUTH_URL`); проверить, что `NEXTAUTH_URL` = публичный https-URL |
| Upload фото → 500, в логах `sharp ... ERR_DLOPEN_FAILED libvips` | Версия sharp в package.json ≠ версии, которую Next несёт как optional dep → standalone-трейс не кладёт libvips | Держать sharp той же minor-версии, что у Next (см. `pnpm why sharp`); `.npmrc` с `node-linker=hoisted` — в репо |
| Картинка `/_next/image?url=...` → 400, хотя прямая ссылка на файл открывается | `STORAGE_PUBLIC_BASE` не был доступен при сборке → S3-хост не в remotePatterns | Заполнить `.env` до сборки; compose прокидывает build arg сам |
| `app` контейнер `unhealthy`, но сайт работает | Next standalone биндился на `$HOSTNAME` (= container ID), healthcheck по localhost не проходил | Исправлено: `ENV HOSTNAME=0.0.0.0` в Dockerfile |
| Поменял `.env`, но ничего не изменилось | `restart` не перечитывает env_file | `up -d --force-recreate app realtime`; для `STORAGE_PUBLIC_BASE` ещё и `caddy` |
| `acme: error` в Caddy | DNS ещё не указывает на VPS / 80,443 закрыты | `dig +short example.ru @1.1.1.1`; `ufw status` |
| `Failed to find Server Action` в браузере | Кеш вкладки от другого билда/стека | Инкогнито или hard reload |
| Регистрация → «Не удалось отправить письмо», в логах `[mail] send failed ... Connection timeout` | Timeweb режет исходящие 25/465/587/2525 | §6.1 — заявка в поддержку; код и `.env` ни при чём |
| То же, но в логах `535 authentication failed` | Пароль приложения ещё не активен (Яндекс пишет про 2–3 часа) либо в Яндекс 360 не разрешён доступ по протоколам для доменного ящика | Подождать; проверить настройку доступа по протоколам в админке 360 |
| Бэкап падает `Unable to locate credentials` | AWS_* не экспортированы в сессии | Уже самодостаточно в `scripts/backup.sh`; проверить `BACKUP_S3_*` в `.env` |
| `pnpm build` OOM на VPS | Нет swap | §4.1 — swap обязателен |
| Бот молчит на `/start` | Вебхук не установлен, секрет в `.env` не совпал с `setWebhook` (401) или в `app` нет `TELEGRAM_*` (404) | `info` из §8.5 — `last_error_message` назовёт код ответа; дальше §8.5, шаги 2–3 |
| Кнопки на карточке в группе крутят часики и ничего не меняют | Группа стала супергруппой: апдейты идут из чата с новым id, и вебхук их молча отбрасывает | `docker compose logs app \| grep "chat migrated"` → новый id в `TELEGRAM_ADMIN_CHAT_ID`, `up -d --force-recreate app` |
| `/api/geo/suggest` отвечает `{"items":[]}` на любой адрес | У города нет `geo_region` или центра, либо регион не импортирован | `select slug, geo_region, lat, lon from cities;` и `select region, version, built_at, counts from geo_imports;` через `docker compose exec db psql -U app -d app -c "…"`; дальше «Геоданные (адреса)» |

## 11. Восстановление из бэкапа

См. отдельный документ: [`docs/RECOVERY.md`](./RECOVERY.md).
