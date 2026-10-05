import { siteUrl as getSiteUrl } from "@/lib/site-config";

// Эндпоинт Яндекса: пинг уходит прямо туда, а не через api.indexnow.org, — сайт
// русскоязычный, и отчёт о приёме виден в Вебмастере. Остальным участникам
// протокола Яндекс пересылает сам.
const INDEXNOW_ENDPOINT = "https://yandex.com/indexnow";
const INDEXNOW_URLLIST_LIMIT = 10_000;

/**
 * Ключ лежит по фиксированному адресу — его отдаёт `src/app/indexnow.txt/route.ts`
 * из `INDEXNOW_KEY`. Протокол разрешает `keyLocation` на том же хосте, а файл в
 * корне покрывает весь хост; ключ при этом не живёт в git, а в `public/`.
 */
export const INDEXNOW_KEY_PATH = "/indexnow.txt";

/**
 * Пинги уходят только из production-сборки с ключом. В dev и тестах — нет:
 * чужой поисковик не должен узнавать о localhost и тестовых объявлениях.
 * Окружение читается напрямую, а не через getEnv(): проверку зовут после
 * успешной мутации, и она не должна бросать.
 */
export function indexNowEnabled(): boolean {
  return process.env.NODE_ENV === "production" && Boolean(process.env.INDEXNOW_KEY);
}

// Что значит ответ — по документации IndexNow у Яндекса.
const STATUS_MEANING: Record<number, string> = {
  400: "неверный запрос",
  403: "ключ не принят: /indexnow.txt не отдаёт его или отдаёт другой",
  422: "адреса не с этого хоста или ключ не совпадает",
  429: "слишком много запросов",
};

// Пинг IndexNow. В dev/test, без INDEXNOW_KEY или без адресов — no-op. Ошибки
// fetch'а ловит, не пробрасывает: провал внешнего сервиса не должен валить
// вызвавшее его действие. Код ответа пишет в лог — по нему видно, принял ли
// поисковик ключ (200/202) или нет (403).
export async function pingIndexNow(urls: string[]): Promise<void> {
  if (!indexNowEnabled()) return;
  if (urls.length === 0) return;
  const key = process.env.INDEXNOW_KEY!;

  const siteUrl = getSiteUrl();
  const host = new URL(siteUrl).host;
  const urlList = urls.slice(0, INDEXNOW_URLLIST_LIMIT);

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${siteUrl}${INDEXNOW_KEY_PATH}`,
        urlList,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 200 || res.status === 202) {
      console.info(`[indexnow] ${res.status}: принято адресов: ${urlList.length}`);
    } else {
      console.warn(`[indexnow] ${res.status}: ${STATUS_MEANING[res.status] ?? "неожиданный ответ"}`);
    }
  } catch (e) {
    console.warn("[indexnow] ping failed", e);
  }
}
