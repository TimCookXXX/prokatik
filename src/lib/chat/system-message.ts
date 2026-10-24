// Запись о сделке в переписке по вещи: текст собирается из вида и meta.
//
// Почему текст не хранится: тред служит журналом сделки и живёт годами, а
// формулировку захочется править. Если бы строка лежала в базе, правка означала
// бы переписывание истории — и старые треды остались бы со старым текстом
// навсегда.
//
// Модуль чистый: тесты проекта живого Postgres не требуют, а это единственное
// место, где вид записи превращается в то, что человек прочитает.

import { content } from "@theme/content";
import { formatDayMonth, formatDayMonthNum } from "@/lib/catalog/dates";
import { depositValue, formatPrice, type DepositType } from "@/lib/catalog/format";
import { rentalDaysCount } from "@/lib/booking/params";
import { quote } from "@/lib/catalog/tariff";
import { ruPlural } from "@/lib/plural";

export const CHAT_SYSTEM_KINDS = [
  "request_created",
  "request_confirmed",
  "request_declined",
  "request_cancelled",
  "request_completed",
] as const;

export type ChatSystemKind = (typeof CHAT_SYSTEM_KINDS)[number];
/** `user` — реплика человека; всё остальное пишет сама сделка. */
export type ChatMessageKind = "user" | ChatSystemKind;

export function isSystemKind(kind: string): kind is ChatSystemKind {
  return (CHAT_SYSTEM_KINDS as readonly string[]).includes(kind);
}

/* Данные записи. Заявка может исчезнуть из виду (её страница, права, статус),
 * поэтому всё, что нужно прочитать запись, лежит рядом с ней. Поля
 * необязательны: старые записи и записи, у которых чего-то нет, обязаны
 * дочитываться, а не ронять ленту.
 *
 * Необязательность тут не стиль, а необходимость: meta приезжает из jsonb
 * непроверенным кастом — ни zod, ни констрейнта на форму нет. Читать поля
 * поэтому нужно ПО ЗНАЧЕНИЮ («есть и непусто»), а не полагаясь на то, что тип
 * не соврал. */
export type ChatSystemMeta = {
  requestId?: string;
  from?: string;
  to?: string;
  qty?: number;
  /** Что человек написал, отправляя заявку. Копия колонки заявки: колонку
   *  читает шторка в момент решения, эту — переписка. Разные экраны, и
   *  джойнить чат ради одной строки дороже, чем скопировать её при записи. */
  comment?: string;
  /* Условия сделки НА МОМЕНТ ЗАЯВКИ — той же копией, что легла колонками в саму
   * заявку. Не ссылка на вещь: владелец поменяет цену, и журнал переписался бы
   * задним числом, а он на то и журнал, чтобы этого не делать. */
  priceDay?: number;
  priceWeek?: number;
  priceMonth?: number;
  depositType?: DepositType;
  depositAmount?: number;
};

/* Дата из meta годится, только если она и правда дата: тип обещаний не даёт,
 * а `formatDayMonthNum("12.09.2026")` молча вернул бы «NaN.NaN». */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v);

function period(meta: ChatSystemMeta): string | null {
  if (!isDate(meta.from) || !isDate(meta.to)) return null;
  return meta.from === meta.to
    ? formatDayMonth(meta.from)
    : `${formatDayMonth(meta.from)} — ${formatDayMonth(meta.to)}`;
}

/* Строка записи: что произошло, а под ним — с какими датами. Обе части
 * возвращаются отдельно, потому что лента набирает их разным кеглем, а превью
 * в списке переписок берёт только первую. */
export function systemMessageText(
  kind: ChatSystemKind,
  meta: ChatSystemMeta | null,
): { title: string; detail: string | null; comment: string | null } {
  const title = content.chatSystem[kind];
  const m = meta ?? {};
  const comment = m.comment?.trim() || null;
  const p = period(m);
  if (!p) return { title, detail: null, comment };
  return {
    title,
    detail: m.qty && m.qty > 1 ? `${p} · ${m.qty} шт.` : p,
    comment,
  };
}

/** Одной строкой — для превью в списке переписок и для скринридера. */
export function systemMessageLine(
  kind: ChatSystemKind,
  meta: ChatSystemMeta | null,
): string {
  const { title, detail } = systemMessageText(kind, meta);
  return detail ? `${title}: ${detail}` : title;
}

const DEPOSIT_TYPES: readonly DepositType[] = ["money", "document", "none"];

export type NoteRow = { term: string; value: string };

/* Строки карточки заявки: что просили и на каких условиях. Только у
 * `request_created` — решениям по заявке («подтверждена», «отклонена»)
 * перечислять нечего, и четыре одинаковые карточки подряд забили бы ленту.
 *
 * Каждая строка появляется, только если данные под неё ЕСТЬ. Записи, сделанные
 * до появления снимка условий, обязаны дочитаться без цены и залога, а не
 * показать «≈ NaN ₽»: отсутствовать может что угодно, включая qty. */
export function requestNoteRows(meta: ChatSystemMeta | null): NoteRow[] {
  const m = meta ?? {};
  const labels = content.chatRequestNote;
  const rows: NoteRow[] = [];
  // Сутки считаются один раз: их спрашивают и строка дат, и стоимость.
  const days = isDate(m.from) && isDate(m.to)
    ? rentalDaysCount({ from: m.from, to: m.to, qty: 1 })
    : 0;

  /* Даты цифрами, а не словами: строка стоит в колонке рядом с подписью, и
   * «20 сентября — 22 сентября · 3 дня» переносится, оставляя висячий
   * разделитель. Плашка решений остаётся на словах — там строка одна, во всю
   * ширину и по центру. Та же причина и тот же формат, что в ленте заявок. */
  if (isDate(m.from) && isDate(m.to)) {
    const p = m.from === m.to
      ? formatDayMonthNum(m.from)
      : `${formatDayMonthNum(m.from)} — ${formatDayMonthNum(m.to)}`;
    rows.push({
      term: labels.dates,
      value: days > 0 ? `${p} · ${days} ${ruPlural(days, "день", "дня", "дней")}` : p,
    });
  }

  const qty = typeof m.qty === "number" && m.qty > 0 ? m.qty : 1;
  if (qty > 1) rows.push({ term: labels.qty, value: `${qty} шт.` });

  // Сумма выводится, а не хранится: слагаемые — факты, сумма из них следует
  // той же лестницей тарифов, что в шторке (quote). Нужны даты и хоть одна
  // цена, иначе строки не будет вовсе. Записи до тарифов несут одну суточную —
  // и считаются, как раньше.
  const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
  const q = days > 0
    ? quote({ priceDay: num(m.priceDay), priceWeek: num(m.priceWeek), priceMonth: num(m.priceMonth) }, days, qty)
    : null;
  if (q?.ok) {
    rows.push({ term: labels.price, value: `≈ ${formatPrice(q.total)}` });
  }

  /* Тип залога — из закрытого списка, а не «любая непустая строка»: чужое
   * значение попало бы в денежную ветку depositValue и выдало бы неизвестный
   * вид залога за сумму в рублях. */
  if (DEPOSIT_TYPES.includes(m.depositType as DepositType)) {
    const amount = typeof m.depositAmount === "number" ? m.depositAmount : null;
    rows.push({
      term: labels.deposit,
      value: depositValue(m.depositType as DepositType, amount),
    });
  }

  return rows;
}
