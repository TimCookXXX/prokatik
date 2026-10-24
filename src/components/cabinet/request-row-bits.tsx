"use client";

// Из чего собрана строка заявки: тип строки и пять кусочков, одинаковых в ленте
// и в сводке кабинета.
//
// Отдельным модулем, потому что рисуют заявку теперь два экрана. Вторая копия
// «вы сдаёте», формата периода и бейджа статуса разъехалась бы с первой на
// первой же правке — а ADR 0015 писался ровно про то, что одна заявка не должна
// жить двумя расходящимися кодами.

import Image from "next/image";
import { Clock, ImageOff } from "lucide-react";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/booking/status-labels";
import { formatDayMonthNum, formatTimeLeft } from "@/lib/catalog/dates";
import type { CabinetRequestRow } from "@/server/cabinet";
import type { PriceUnit } from "@/lib/catalog/tariff";

export type FeedRow = Omit<CabinetRequestRow, "createdAt" | "expiresAt"> & {
  createdAt: string;
  expiresAt: string;
  /** Ждёт решения владельца-меня: строке — охряная полоса и таймер. */
  hot: boolean;
  /** ≈ стоимость: сутки и цену сервер уже свёл. Цена — снимок из самой заявки,
   *  а не сегодняшняя цена вещи (ADR 0019). */
  estimate: number | null;
  /** По какой ступени тарифа посчитано (quote). null — суммы нет. */
  estimateBasis: { unit: PriceUnit; rate: number; capped: boolean } | null;
  /** Непрочитанное в переписке по этой вещи. Счёт по ТРЕДУ, а не по заявке:
   *  тред — пара (вещь, арендатор), и у двух заявок одного человека на одну
   *  вещь число будет общим. Пусто там, где треда ещё нет. */
  unread?: number;
};

// Цифрами, не словами: период стоит парой, и «8 сентября — 14 сентября» не
// влезал ни в колонку таблицы, ни в строку на телефоне.
export const period = (r: FeedRow) =>
  r.dateFrom === r.dateTo
    ? formatDayMonthNum(r.dateFrom)
    : `${formatDayMonthNum(r.dateFrom)} — ${formatDayMonthNum(r.dateTo)}`;

export const roleWord = (r: FeedRow) => (r.side === "owner" ? "вы сдаёте" : "вы арендуете");

export const isClosed = (r: FeedRow) =>
  r.status !== "new" && r.status !== "confirmed";

export function Thumb({ row, size }: { row: FeedRow; size: number }) {
  return (
    /* block обязателен, а не для красоты: это <span>, и в обычном потоке он
     * строчный — ширину и высоту игнорирует, схлопываясь в ноль вместе с
     * `fill`-картинкой внутри. В ленте он лежит во флексе и оболванивается в
     * блок сам; в грид-ячейке сводки такого везения нет. */
    <span
      className="relative block shrink-0 overflow-hidden rounded-lg bg-muted"
      style={{ width: size, height: size }}
    >
      {row.listing.image ? (
        <Image src={row.listing.image} alt="" fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center text-muted-foreground">
          <ImageOff className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

export function TimeLeft({ row, compact = false }: { row: FeedRow; compact?: boolean }) {
  const left = formatTimeLeft(new Date(row.expiresAt), undefined, compact);
  if (!left) return null;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm bg-selected px-2 py-0.5 text-2xs font-semibold text-selected-foreground">
      <Clock className="h-3 w-3" aria-hidden="true" />
      {/* SSR и гидрация считают от разных моментов: на минутной границе текст
        * расходится, и React шумел бы. */}
      <span suppressHydrationWarning>
        {/* Без «осталось» — там, где чип стоит вплотную к названию и места на
          * слово нет. Рядом с заявкой, ждущей ответа, оно и так читается: часы
          * и время могут значить только одно. */}
        {compact ? left : `осталось ${left}`}
      </span>
    </span>
  );
}

export function StatusBadge({ row }: { row: FeedRow }) {
  return (
    <span className={`whitespace-nowrap rounded-sm px-2 py-0.5 text-2xs font-medium ${STATUS_BADGE_CLASSES[row.status]}`}>
      {STATUS_LABELS[row.status]}
    </span>
  );
}
