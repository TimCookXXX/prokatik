// Боты для своей статистики посещений. События пишет только JS после
// монтирования, поэтому краулеры без JS не считаются и так; этот список
// отсекает тех, кто JS исполняет (рендер Яндекса и Google, превью ссылок в
// мессенджерах, безголовый Chrome), и утилиты, которым незачем получать id
// браузера. Его спрашивают middleware (кука vid) и роут сбора.
//
// Браузер и приложение Яндекса (YaBrowser, YaApp, YaSearchBrowser) — люди,
// поэтому в списке названия роботов целиком, а не общее «yandex». Общего «bot»
// нет по той же причине: он ловил бы телефоны CUBOT. Проверки Search Console
// (Google-InspectionTool) и PageSpeed (Chrome-Lighthouse) исполняют JS и
// навигатор webdriver не выставляют — их ловит только имя.
// Пустой User-Agent браузеры не шлют — это скрипт.

const BOT_UA = new RegExp([
  "YandexBot", "YandexMetrika", "YandexRenderResourcesBot", "YandexScreenshotBot", "YandexMobileBot",
  "Googlebot", "Google-InspectionTool", "GoogleOther", "AdsBot-Google", "Mediapartners-Google", "Storebot-Google",
  "Chrome-Lighthouse", "Applebot", "bingbot", "TelegramBot", "vkShare", "facebookexternalhit",
  "HeadlessChrome", "\\bcurl/", "\\bwget/", "python-requests",
].join("|"), "i");

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || !ua.trim()) return true;
  return BOT_UA.test(ua);
}
