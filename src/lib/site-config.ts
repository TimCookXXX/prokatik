import { getEnv } from "@/lib/env";

/**
 * Адрес сайта без завершающего `/` — основа canonical, sitemap, robots.txt,
 * JSON-LD и ссылок в письмах. Единственный источник: NEXTAUTH_URL через
 * getEnv(), читается при вызове, а не при импорте модуля, — иначе адрес
 * застывал бы тем, что было в окружении на этапе сборки.
 */
export function siteUrl(): string {
  return getEnv().NEXTAUTH_URL.replace(/\/+$/, "");
}
