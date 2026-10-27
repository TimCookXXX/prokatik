// Что обещать человеку после заявки — общее у бота и запасной формы на сайте.
// Днём на заявку отвечают за минуты, ночью — утром: обещание, которое не
// сдержать, хуже честного «после 9:00». Время — деловая зона сервиса
// (ADR 0013), а не зона браузера или процесса.

import { content } from "@theme/content";
import { businessHour } from "@/lib/catalog/dates";

export const REPLY_DAY_FROM = 9;
export const REPLY_DAY_TO = 21;

export function leadReply(now: Date = new Date()): string {
  const h = businessHour(now);
  const r = content.booking.leadReply;
  return h >= REPLY_DAY_FROM && h < REPLY_DAY_TO ? r.day : r.night;
}
