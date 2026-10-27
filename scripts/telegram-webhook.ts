/**
 * Вебхук бота заявок (ADR 0028): установка, состояние, снятие.
 *
 *   pnpm tg:webhook set --url https://inrenta.ru/api/telegram/webhook
 *   pnpm tg:webhook info
 *   pnpm tg:webhook delete
 *
 * Токен и секрет — из .env (TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET); для
 * прода — значения прода: секрет в setWebhook обязан совпасть с тем, что
 * сверяет app. Адрес передаётся явно, а не из NEXTAUTH_URL: скрипт читает
 * локальный .env, и там адрес разработчика. Не-https Telegram не принимает —
 * скрипт отклоняет его сам, до запроса.
 *
 * Токен живёт в адресе запроса Bot API и не печатается: ни адрес, ни текст
 * сетевой ошибки в вывод не идут.
 */

import { realpathSync } from "node:fs";

export type Command =
  | { kind: "set"; url: string }
  | { kind: "info" }
  | { kind: "delete" };

const USAGE = "pnpm tg:webhook set --url <https-адрес> | info | delete";

/** Разбор аргументов. Бросает с текстом для человека. */
export function parseArgs(argv: string[]): Command {
  const [cmd, ...rest] = argv;
  if (cmd === "info" && rest.length === 0) return { kind: "info" };
  if (cmd === "delete" && rest.length === 0) return { kind: "delete" };
  if (cmd === "set") {
    const i = rest.indexOf("--url");
    const url = i >= 0 ? rest[i + 1] : undefined;
    if (!url || rest.length !== 2) throw new Error(`Нужен адрес: ${USAGE}`);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Не адрес: ${url}`);
    }
    if (parsed.protocol !== "https:") throw new Error("Telegram принимает вебхук только по https");
    return { kind: "set", url: parsed.toString() };
  }
  throw new Error(USAGE);
}

/** Параметры вызова Bot API по команде. */
export function botRequest(cmd: Command, secret: string | undefined): { method: string; params: Record<string, unknown> } {
  switch (cmd.kind) {
    case "set":
      if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET не задан");
      return {
        method: "setWebhook",
        params: {
          url: cmd.url,
          secret_token: secret,
          // Бот читает только сообщения и нажатия кнопок.
          allowed_updates: ["message", "callback_query"],
        },
      };
    case "info":
      return { method: "getWebhookInfo", params: {} };
    case "delete":
      return { method: "deleteWebhook", params: {} };
  }
}

async function main() {
  const cmd = parseArgs(process.argv.slice(2));
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  const { method, params } = botRequest(cmd, process.env.TELEGRAM_WEBHOOK_SECRET);
  let body: { ok?: boolean; result?: unknown; description?: string };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10_000),
    });
    body = await res.json();
  } catch (e) {
    throw new Error(`${method}: запрос не прошёл (${e instanceof Error ? e.name : "Error"})`);
  }
  if (!body.ok) throw new Error(`${method}: ${body.description ?? "отказ"}`);
  console.log(JSON.stringify(body.result, null, 2));
}

// Запуск командой, а не импорт из тестов (как в seo-check.ts).
function isMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(import.meta.filename);
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
