// Что и как пишет scripts/seed-real.ts: разбор флагов, сужение таблиц до
// выбранных владельцев и отчёт о том, что создано и что изменилось. Чистая
// часть — без Postgres, проверяется тестами.
//
// Зачем это нужно: на живом проде уже есть реальные пользователи и объявления,
// и новый прокат надо добавить, не тронув чужих строк. `--owners` пишет только
// названных владельцев и их объявления (города не трогает вовсе), `--dry-run`
// проводит всю запись в транзакции и откатывает её — отчёт показывает, что
// случилось бы, по каждой строке и с именами изменённых полей.

import type { SeedData } from "./rows";

export interface SeedArgs {
  dryRun: boolean;
  /** null — все владельцы из users.csv и все города. */
  owners: string[] | null;
}

export type SeedArgsResult = { ok: true; args: SeedArgs } | { ok: false; error: string };

/** `--dry-run`, `--owners a,b` или `--owners=a,b`. Неизвестный флаг — ошибка, а не молчание. */
export function parseSeedArgs(argv: readonly string[]): SeedArgsResult {
  let dryRun = false;
  let owners: string[] | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--owners" || arg.startsWith("--owners=")) {
      const raw = arg === "--owners" ? argv[++i] : arg.slice("--owners=".length);
      const keys = (raw ?? "").split(",").map((k) => k.trim()).filter(Boolean);
      if (keys.length === 0) return { ok: false, error: "--owners без ключей: ожидается --owners key1,key2" };
      owners = [...new Set([...(owners ?? []), ...keys])];
      continue;
    }
    return { ok: false, error: `неизвестный аргумент «${arg}». Флаги: --dry-run, --owners key1,key2` };
  }
  return { ok: true, args: { dryRun, owners } };
}

export type ScopeResult = { ok: true; data: SeedData } | { ok: false; error: string };

/**
 * Таблицы, сужённые до владельцев: их строки users.csv и их объявления. Города
 * остаются целиком — по ним ищутся id, — но писатель в этом режиме их не
 * пишет. Ключ, которого нет в users.csv, — ошибка: опечатка в ключе иначе
 * выглядела бы как «записано ноль строк, всё хорошо».
 */
export function scopeSeedData(data: SeedData, owners: readonly string[] | null): ScopeResult {
  if (owners === null) return { ok: true, data };
  const known = new Set(data.users.map((u) => u.key));
  const unknown = owners.filter((k) => !known.has(k));
  if (unknown.length > 0) {
    return { ok: false, error: `в users.csv нет владельцев: ${unknown.join(", ")}` };
  }
  const keep = new Set(owners);
  return {
    ok: true,
    data: {
      cities: data.cities,
      users: data.users.filter((u) => keep.has(u.key)),
      listings: data.listings.filter((l) => keep.has(l.owner)),
    },
  };
}

/** Поля, которые сид запишет иначе, чем лежит в базе. Пустой массив — строка не меняется. */
export function changedFields(current: Record<string, unknown>, next: Record<string, unknown>): string[] {
  return Object.keys(next).filter(
    (k) => JSON.stringify(current[k] ?? null) !== JSON.stringify(next[k] ?? null),
  );
}

export interface EntityReport {
  created: string[];
  updated: Array<{ key: string; fields: string[] }>;
  unchanged: number;
}

export const emptyEntityReport = (): EntityReport => ({ created: [], updated: [], unchanged: 0 });

export interface SeedReport {
  dryRun: boolean;
  /** Режим --owners: города не пишутся. */
  ownersOnly: boolean;
  categories: string[];
  cities: EntityReport;
  users: EntityReport;
  listings: EntityReport;
  photos: number;
  /** Сколько владельцев получили dev-пароль (вне прода). */
  devPasswords: number;
}

function entityLines(title: string, r: EntityReport): string[] {
  const head = `${title}: создано ${r.created.length}, обновлено ${r.updated.length}, без изменений ${r.unchanged}`;
  return [
    head,
    ...r.created.map((k) => `  + ${k}`),
    ...r.updated.map((u) => `  ~ ${u.key}: ${u.fields.join(", ")}`),
  ];
}

/** Отчёт построчно: «+» — создано, «~» — обновлено, с именами изменённых полей. */
export function formatSeedReport(r: SeedReport): string[] {
  return [
    ...(r.dryRun ? ["DRY RUN — транзакция откатана, в базе ничего не изменилось."] : []),
    r.categories.length > 0
      ? `Категории: создано ${r.categories.length} — ${r.categories.join("; ")}`
      : "Категории: создано 0",
    ...(r.ownersOnly ? ["Города: не трогаются (--owners)"] : entityLines("Города", r.cities)),
    ...entityLines("Владельцы", r.users),
    ...entityLines("Объявления", r.listings),
    `Фотографий в объявлениях: ${r.photos}`,
  ];
}
