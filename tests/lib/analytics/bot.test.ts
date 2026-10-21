// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isBotUserAgent } from "@/lib/analytics/bot";
import { BOT_UA as SEO_CHECK_UA, BROWSER_UA as SEO_CHECK_BROWSER_UA } from "../../../scripts/seo-check";

describe("isBotUserAgent", () => {
  it.each([
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
    "Mozilla/5.0 (compatible; YandexMetrika/2.0; +http://yandex.com/bots yabs01)",
    "Mozilla/5.0 (compatible; YandexRenderResourcesBot/1.0; +http://yandex.com/bots)",
    "Mozilla/5.0 (compatible; YandexScreenshotBot/3.0; +http://yandex.com/bots)",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 8_1 like Mac OS X) AppleWebKit/600.1.4 (KHTML, like Gecko) Version/8.0 Mobile/12B411 Safari/600.1.4 (compatible; YandexMobileBot/3.0; +http://yandex.com/bots)",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "TelegramBot (like TwitterBot)",
    "vkShare; +http://vk.com/dev/Share",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
    "curl/8.4.0",
    "Wget/1.21.4",
    "python-requests/2.31.0",
    SEO_CHECK_UA,
    "",
    "   ",
    null,
    undefined,
  ])("бот: %j", (ua) => {
    expect(isBotUserAgent(ua)).toBe(true);
  });

  it.each([
    // Яндекс Браузер и приложение Яндекса — люди.
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 YaBrowser/24.10.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; arm_64; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.146 YaApp_Android/24.104.1 YaSearchBrowser/24.104.1 BroPP/1.0 SA/3 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
    // «Как браузер» в seo-check — ровно для того, чтобы выглядеть человеком.
    SEO_CHECK_BROWSER_UA,
  ])("человек: %s", (ua) => {
    expect(isBotUserAgent(ua)).toBe(false);
  });
});
