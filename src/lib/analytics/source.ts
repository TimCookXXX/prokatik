// Откуда пришёл человек — источник первой загрузки документа. Чистая функция
// над тем, что уже очищено (sanitize.ts, entryOf): хост referrer'а, метки
// кампании и рекламный клик. Админка показывает источник визита и первый
// источник браузера (visitors.first_source) человеческими словами; здесь —
// только вид и короткая метка.

import type { Entry } from "./sanitize";

export const SOURCE_KINDS = [
  /** Без referrer'а и меток: набрал адрес, закладка, приложение без referrer'а. */
  "direct",
  /** Загрузка документа со своего же сайта: перезагрузка, новая вкладка. */
  "internal",
  /** Поисковик. */
  "search",
  /** Мессенджер или соцсеть. */
  "social",
  /** Клик по рекламе: yclid/gclid/fbclid или платный utm_medium. */
  "ad",
  /** Ссылка с метками кампании без признаков рекламы. */
  "campaign",
  /** Любой другой сайт. */
  "referral",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Источник. `label` — метка из закрытого списка (`yandex`, `telegram`) у
 * поисковиков, соцсетей и рекламы, `utm_source` у кампании, хост у ссылки с
 * сайта; пусто у прямого и внутреннего захода.
 */
export interface Source {
  kind: SourceKind;
  label: string;
}

type HostRule = [RegExp, string];

// Хосты сайтов и имена пакетов Android (referrer `android-app://…`).
const SEARCH_HOSTS: HostRule[] = [
  [/(^|\.)(yandex\.[a-z.]+|ya\.ru)$|^(com|ru)\.yandex\./, "yandex"],
  [/(^|\.)google\.[a-z.]+$|^com\.google\.android\.googlequicksearchbox$/, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)go\.mail\.ru$/, "mail"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
];

const SOCIAL_HOSTS: HostRule[] = [
  [/(^|\.)(t\.me|telegram\.org|telegram\.me)$|^org\.telegram\./, "telegram"],
  [/(^|\.)(vk\.com|vk\.ru|vkontakte\.ru)$|^com\.vkontakte\./, "vk"],
  [/(^|\.)ok\.ru$/, "ok"],
  [/(^|\.)dzen\.ru$/, "dzen"],
  [/(^|\.)(wa\.me|whatsapp\.com)$|^com\.whatsapp$/, "whatsapp"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(facebook\.com|fb\.com)$/, "facebook"],
];

/** Платный трафик по utm_medium. */
const PAID_MEDIUM = /^(cpc|ppc|cpm|cpa|cpv|paid|display|banner)$/i;

function match(rules: HostRule[], host: string): string | null {
  for (const [re, label] of rules) if (re.test(host)) return label;
  return null;
}

/** `siteHost` — хост этого сайта без `www.`: свой referrer — внутренний переход. */
export function classifySource(entry: Entry, siteHost: string): Source {
  const host = entry.ref;
  const engine = host ? match(SEARCH_HOSTS, host) : null;
  const social = host ? match(SOCIAL_HOSTS, host) : null;
  const utmSource = entry.utm.utm_source;

  if (entry.ad) return { kind: "ad", label: entry.ad };
  if (entry.utm.utm_medium && PAID_MEDIUM.test(entry.utm.utm_medium)) {
    return { kind: "ad", label: engine ?? social ?? utmSource ?? "" };
  }
  if (utmSource) return { kind: "campaign", label: utmSource };
  if (!host) return { kind: "direct", label: "" };
  if (host === siteHost.toLowerCase().replace(/^www\./, "")) return { kind: "internal", label: "" };
  if (engine) return { kind: "search", label: engine };
  if (social) return { kind: "social", label: social };
  return { kind: "referral", label: host };
}
