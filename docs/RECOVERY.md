# Восстановление базы из бэкапа

Аварийный документ. Дампы лежат в Timeweb S3 Cold, бакет из `BACKUP_S3_BUCKET`,
путь `db/backup-YYYY-MM-DD-HHMM.sql.gz`. Кладёт их туда контейнер `backup`
ежедневно около 03:00 MSK.

Ручной прогон бэкапа: `docker compose exec backup sh /backup.sh`.

## 1. Достать нужный дамп

На VPS (или локально, если есть credentials):

```bash
sudo apt install awscli

# Значения — из .env, блок BACKUP_S3_*
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=ru-1

# Что вообще есть
aws --endpoint-url=https://s3.twcstorage.ru s3 ls s3://<cold-bucket-uuid>/db/

# Скачать нужный
aws --endpoint-url=https://s3.twcstorage.ru s3 cp \
  s3://<cold-bucket-uuid>/db/backup-2026-08-19-0300.sql.gz /tmp/restore.sql.gz
```

## 2. Восстановление в отдельную базу (так и надо делать)

Никогда не накатывайте дамп поверх живой базы, не проверив его. Сначала — в
отдельную:

```bash
docker compose up -d db
docker compose exec db psql -U app -d postgres -c "CREATE DATABASE restore_test;"

gunzip -c /tmp/restore.sql.gz | docker compose exec -T db psql -U app -d restore_test
```

### Проверка содержимого

```bash
docker compose exec db psql -U app -d restore_test -c "
  SELECT 'users'            AS entity, count(*) FROM users
  UNION ALL SELECT 'listings',         count(*) FROM listings
  UNION ALL SELECT 'booking_requests', count(*) FROM booking_requests
  UNION ALL SELECT 'availability',     count(*) FROM availability
  UNION ALL SELECT 'cities',           count(*) FROM cities
  UNION ALL SELECT 'categories',       count(*) FROM categories;
"
```

Ожидание: числа близки к боевым с поправкой на окно до суток с момента дампа.

Геоданные адресов (таблицы `geo_*`) лежат в том же дампе, отдельно их
восстанавливать не нужно. Какой импорт в них лежит и сколько строк:

```bash
docker compose exec db psql -U app -d restore_test -c "
  SELECT region, version, built_at, counts FROM geo_imports;
  SELECT region, count(*) AS houses FROM geo_houses GROUP BY region;
"
```

Ожидание: строка на регион, `houses` совпадает с `counts`. Если таблицы пусты
(дамп старше первого импорта), адреса возвращаются повторным импортом —
[DEPLOY.md](DEPLOY.md#геоданные-адреса).

Проверить, что дамп не обрезан и схема цела. Таблиц в `public` должно быть
столько же, сколько объявлено в схеме, — для дампа той же версии кода (плюс
своя схема drizzle с журналом миграций):

```bash
# Сколько таблиц объявлено в схеме (в репозитории)
grep -c 'pgTable("' drizzle/schema.ts

# Сколько их в восстановленной базе
docker compose exec db psql -U app -d restore_test -c "
  SELECT count(*) AS tables FROM information_schema.tables
  WHERE table_schema = 'public';
"

# Журнал применённых миграций
docker compose exec db psql -U app -d restore_test -c "
  SELECT count(*) AS applied FROM drizzle.__drizzle_migrations;
"
```

Дамп может быть старше последней миграции — это нормально: миграции применятся
автоматически при старте контейнера приложения.

Убрать за собой:

```bash
docker compose exec db psql -U app -d postgres -c "DROP DATABASE restore_test;"
```

## 3. Восстановление поверх боевой базы

**Деструктивно.** Только если живая база потеряна или повреждена.

```bash
docker compose stop app

docker compose exec db psql -U app -d postgres -c "DROP DATABASE app;"
docker compose exec db psql -U app -d postgres -c "CREATE DATABASE app;"

gunzip -c /tmp/restore.sql.gz | docker compose exec -T db psql -U app -d app

docker compose start app
docker compose logs --tail 30 app   # ждём "Running migrations..." → "Starting Next.js..."
```

Миграции применятся сами при старте (`scripts/entrypoint.sh`).

### После восстановления

- Проверить, что сайт открывается и вход работает.
- **Загруженные изображения дампом не покрываются.** Они лежат в отдельном
  S3-бакете (`STORAGE_*`) и от базы не зависят: если бакет цел, картинки
  вернутся вместе со строками `uploads` и `photosJson`. Если утрачен бакет —
  восстанавливать нечего, ссылки останутся битыми.
- Сессии в дампе есть, но старые cookie после восстановления могут указывать на
  строки, которых уже нет: пользователей просто разлогинит.

## 4. Учения (раз в квартал)

Смысл в том, чтобы узнать о сломанном бэкапе не в день аварии.

1. Скачать свежий дамп из S3.
2. Восстановить в `restore_test` по разделу 2.
3. Сверить counts с боевой базой.
4. Дропнуть `restore_test`.
5. Записать результат в таблицу ниже.

## История учений

| Дата | Дамп | Результат | Кто | Заметки |
|---|---|---|---|---|
| 2026-08-21 | боевой `backup.sh` → MinIO | цикл прошёл целиком | tequilex | Прогон **всей** процедуры на текущей схеме: `scripts/backup.sh` снял дамп и залил его в бакет, `aws s3 ls` показал файл, `aws s3 cp` скачал, восстановление в `restore_test` прошло без ошибок, счётчики сошлись один в один, 12 таблиц и 4 записи в журнале миграций. Хранилище — локальный MinIO вместо Timeweb, см. оговорку ниже. |
| 2026-06-29 | синтетический, локально | counts совпали | tequilex | Прогон на **прежней схеме данных** (модель контентного движка-предка, таблицы `posts`/`comments`). К текущей схеме отношения не имеет. |

Оговорка к прогону 2026-08-21: S3-часть проверена против **MinIO**, а не против
Timeweb. Протокол один и тот же, и команды из этого документа отработали без
единой правки, но остаются вещи, которые повторяются только на боевом бакете:
доступность endpoint'а Timeweb, права сервисного пользователя, поведение
холодного хранилища и правило lifecycle, удаляющее объекты старше 30 дней.
Поднять локальное S3 — [testing.md](testing.md).
