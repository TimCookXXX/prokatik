import { siteUrl as getSiteUrl } from "@/lib/site-config";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_URLLIST_LIMIT = 10_000;

// Fire-and-forget пинг IndexNow API.
// В dev/test или без INDEXNOW_KEY — no-op. Ошибки fetch'а ловит, не пробрасывает,
// чтобы провал внешнего сервиса не валил вызвавшее его действие.
export async function pingIndexNow(urls: string[]): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  const key = process.env.INDEXNOW_KEY;
  if (!key) return;
  if (urls.length === 0) return;

  const siteUrl = getSiteUrl();
  const host = new URL(siteUrl).host;

  try {
    await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${siteUrl}/${key}.txt`,
        urlList: urls.slice(0, INDEXNOW_URLLIST_LIMIT),
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.warn("[indexnow] ping failed", e);
  }
}
