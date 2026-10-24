// Сборка строк ленты заявок из строк выборки. Отдельным серверным модулем,
// потому что вызывающих два — лента и страница вещи в кабинете, — а положить
// функции рядом с компонентом нельзя: у модуля с "use client" все экспорты
// становятся клиентскими ссылками, и серверный вызов падает в рантайме.
// Тип FeedRow импортируется только как тип — типы границу не пересекают.

import { rentalDaysCount } from "@/lib/booking/params";
import { quote } from "@/lib/catalog/tariff";
import type { CabinetRequestRow } from "@/server/cabinet";
import type { FeedRow } from "@/components/cabinet/RequestsFeed";

export function toFeedRow(r: CabinetRequestRow): FeedRow {
  // Горит только новая заявка владельцу: ответить на неё может он один, и
  // охряный призыв к действию у арендатора звал бы туда, где кнопок нет.
  const hot = r.side === "owner" && r.status === "new";
  const days = rentalDaysCount({ from: r.dateFrom, to: r.dateTo, qty: r.qty });
  // Минимальный срок не передаётся: его в снимке нет, а заявка уже подана.
  const q = days > 0 ? quote(r, days, r.qty) : null;

  return {
    ...r,
    // Date через границу RSC проходит, но строка честнее: клиенту нужны только
    // вывод и сравнение, а несериализуемого в пропсах лучше не держать.
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    hot,
    // По цене из самой заявки, а не по сегодняшней цене вещи: иначе сумма
    // старой заявки ползла бы вслед за прайсом владельца, и человек видел бы
    // не то, на что соглашался. Снимок — в drizzle/schema.ts.
    estimate: q?.ok ? q.total : null,
    estimateBasis: q?.ok ? { unit: q.unit, rate: q.rate, capped: q.capped } : null,
  };
}

/* Вес строки: сперва то, что требует действия, затем идущее, закрытые позади.
 * Внутри веса — свежие выше. Сортировка в JS, а не в SQL: правило читается
 * рядом с лентой, а строк у человека десятки, не тысячи. */
export function sortFeedRows(rows: FeedRow[]): FeedRow[] {
  const weight = (r: FeedRow) =>
    r.hot ? 0 : r.status === "new" || r.status === "confirmed" ? 1 : 2;
  return [...rows].sort(
    (a, b) => weight(a) - weight(b) || (a.createdAt < b.createdAt ? 1 : -1),
  );
}

/* Порядок строк СВОДКИ — другое правило, чем у ленты, и подменять им
 * sortFeedRows нельзя: лента сортирует по свежести намеренно.
 *
 * Здесь наверху то, что сгорит раньше всех, потом идущее по дате начала.
 * Сортировка по сроку, а не по свежести, — не вкусовщина: expiresAt ставится
 * как «создано + 24 часа» одной константой, поэтому «свежие сверху» — это
 * ровно ОБРАТНЫЙ порядок к «горит раньше». Со срезом до N это означало бы, что
 * из панели вылетают именно те заявки, ради которых она и сделана.
 *
 * По той же причине резать полагается здесь, а не лимитом в SQL: тот
 * применяется до сортировки. Заодно остаток считается бесплатно и честно. */
export function summaryRows(rows: FeedRow[], limit: number): {
  shown: FeedRow[];
  rest: number;
} {
  /* Вес по ТРЕБУЕМОМУ ОТ ЧЕЛОВЕКА, а не по статусу. Статус `new` носят две
   * разные вещи: заявка ко мне, где решаю я, и моя собственная, где я не могу
   * ничего. Сложи их в одну группу — и восемь моих заявок, отправленных за час,
   * вытеснят в хвост единственную, у которой есть кнопки. Лента считает вес по
   * тому же признаку (`hot`), и расходиться с ней здесь не за чем. */
  const weight = (r: FeedRow) => (r.hot ? 0 : r.status === "confirmed" ? 1 : 2);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...rows].sort((a, b) => {
    const w = weight(a) - weight(b);
    if (w !== 0) return w;
    // Идущие — по дате начала: ближайшая передача или возврат впереди.
    if (a.status === "confirmed") return cmp(a.dateFrom, b.dateFrom);
    // Ждущие ответа — по сроку: первым то, что закроется само раньше всех.
    return cmp(a.expiresAt, b.expiresAt);
  });
  return { shown: sorted.slice(0, limit), rest: Math.max(0, sorted.length - limit) };
}
