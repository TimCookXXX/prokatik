import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().refine(s => s.startsWith("postgres://") || s.startsWith("postgresql://"), {
    message: "DATABASE_URL must be a Postgres connection string",
  }),
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET must be ≥32 chars"),

  // Production-only (валидируется в superRefine ниже)
  DOMAIN: z.string().min(1).optional(),
  LETSENCRYPT_EMAIL: z.string().email().optional(),

  YANDEX_CLIENT_ID: z.string().min(1).optional(),
  YANDEX_CLIENT_SECRET: z.string().min(1).optional(),
  VK_CLIENT_ID: z.string().min(1).optional(),
  VK_CLIENT_SECRET: z.string().min(1).optional(),

  SMTP_HOST:     z.string().min(1).optional(),
  SMTP_PORT:     z.coerce.number().int().positive().optional(),
  SMTP_USER:     z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM:     z.string().email().optional(),

  // Дополняет встроенный список в src/lib/auth/email.ts: домен закрывается
  // рестартом контейнера, без пересборки.
  BLOCKED_EMAIL_DOMAINS: z.string()
    .transform((s) => s.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.string()))
    .optional(),

  STORAGE_ENDPOINT:          z.string().url().optional(),
  STORAGE_BUCKET:            z.string().min(1).optional(),
  STORAGE_ACCESS_KEY_ID:     z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_PUBLIC_BASE:       z.string().url().optional(),

  BACKUP_S3_ENDPOINT:          z.string().url().optional(),
  BACKUP_S3_BUCKET:            z.string().min(1).optional(),
  BACKUP_S3_ACCESS_KEY_ID:     z.string().min(1).optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

  INDEXNOW_KEY: z.string().regex(/^[a-f0-9]{8,128}$/, "INDEXNOW_KEY must be hex").optional(),
  YANDEX_METRIKA_ID: z.string().regex(/^\d+$/, "YANDEX_METRIKA_ID must be digits").optional(),

  // Поведение «Забронировать» у анонима: auth — вход и заявка из кабинета,
  // telegram — ссылка на бота и запасная форма (ADR 0028). Влияет только на
  // виджет: вебхук и таблица лидов работают при любом значении.
  BOOKING_FLOW: z.enum(["auth", "telegram"]).default("auth"),
  // Бот заявок. Токен от BotFather; секрет вебхука уходит в setWebhook и
  // сверяется с заголовком X-Telegram-Bot-Api-Secret-Token — правило Bot API
  // на его алфавит и длину (1–256), снизу 32 ради стойкости. Чат — id
  // админской группы, у групп он отрицательный.
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, "TELEGRAM_BOT_TOKEN must look like 123456:ABC…").optional(),
  TELEGRAM_BOT_USERNAME: z.string()
    .transform((s) => s.replace(/^@/, ""))
    .pipe(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{3,31}$/, "TELEGRAM_BOT_USERNAME must be a bot username"))
    .optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string()
    .regex(/^[A-Za-z0-9_-]{32,256}$/, "TELEGRAM_WEBHOOK_SECRET must be 32–256 of [A-Za-z0-9_-]")
    .optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string()
    .regex(/^-?\d{1,20}$/, "TELEGRAM_ADMIN_CHAT_ID must be an integer")
    .transform(Number)
    .pipe(z.number().int().safe())
    .optional(),
}).superRefine((v, ctx) => {
  for (const p of ["YANDEX", "VK"] as const) {
    const id = (v as Record<string, unknown>)[`${p}_CLIENT_ID`];
    const sec = (v as Record<string, unknown>)[`${p}_CLIENT_SECRET`];
    if (!!id !== !!sec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${p}_CLIENT_SECRET`],
        message: `${p}_CLIENT_ID and ${p}_CLIENT_SECRET must be set together`,
      });
    }
  }

  const storageKeys = [
    "STORAGE_ENDPOINT", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID",
    "STORAGE_SECRET_ACCESS_KEY", "STORAGE_PUBLIC_BASE",
  ] as const;
  const storagePresence = storageKeys.map(k => Boolean((v as Record<string, unknown>)[k]));
  const storageAll = storagePresence.every(Boolean);
  const storageNone = storagePresence.every(p => !p);
  if (!storageAll && !storageNone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STORAGE_BUCKET"],
      message: "STORAGE_* env vars must be all set or all empty",
    });
  }

  // Почта: все или ни одной. Отсутствие SMTP в проде допустимо — регистрация и
  // сброс пароля тогда просто скрыты, вход по уже заведённому паролю работает.
  const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
  const smtpPresence = smtpKeys.map(k => Boolean((v as Record<string, unknown>)[k]));
  if (!smtpPresence.every(Boolean) && !smtpPresence.every(p => !p)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SMTP_HOST"],
      message: "SMTP_* env vars must be all set or all empty",
    });
  }

  const backupKeys = [
    "BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET",
    "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY",
  ] as const;
  const backupPresence = backupKeys.map(k => Boolean((v as Record<string, unknown>)[k]));
  const backupAll = backupPresence.every(Boolean);
  const backupNone = backupPresence.every(p => !p);
  if (!backupAll && !backupNone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BACKUP_S3_BUCKET"],
      message: "BACKUP_S3_* env vars must be all set or all empty",
    });
  }

  // Бот: все или ни одной. Без группы бот выключен целиком — вебхук отвечает
  // 404, — а флаг telegram без бота вёл бы человека на ссылку в никуда.
  const telegramKeys = [
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_ADMIN_CHAT_ID",
  ] as const;
  const telegramPresence = telegramKeys.map(k => (v as Record<string, unknown>)[k] !== undefined);
  const telegramAll = telegramPresence.every(Boolean);
  if (!telegramAll && telegramPresence.some(Boolean)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["TELEGRAM_BOT_TOKEN"],
      message: "TELEGRAM_* env vars must be all set or all empty",
    });
  }
  if (v.BOOKING_FLOW === "telegram" && !telegramAll) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BOOKING_FLOW"],
      message: "BOOKING_FLOW=telegram requires TELEGRAM_* env vars",
    });
  }

  if (v.NODE_ENV === "production") {
    const required: Array<keyof typeof v> = ["DOMAIN", "LETSENCRYPT_EMAIL"];
    for (const k of required) {
      if (!v[k]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [k as string],
          message: `${String(k)} is required in production`,
        });
      }
    }
    if (!storageAll) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_BUCKET"],
        message: "STORAGE_* must be fully configured in production",
      });
    }
  }
});

export type Env = z.infer<typeof schema>;

export function parseEnv(input: Record<string, string | undefined>): Env {
  const normalized: Record<string, string | undefined> = {};
  for (const k of Object.keys(input)) {
    const v = input[k];
    normalized[k] = v === "" ? undefined : v;
  }
  const result = schema.safeParse(normalized);
  if (!result.success) {
    throw new Error("Invalid env: " + result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return result.data;
}

let cached: Env | null = null;
export function getEnv(): Env {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}

export function _resetEnvCacheForTests(): void {
  cached = null;
}
