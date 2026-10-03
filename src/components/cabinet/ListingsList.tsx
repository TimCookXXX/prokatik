// Список объявлений кабинета: таблица от lg, строки ниже. Заменил сетку
// карточек — в плитку 210px не помещались ни подписи к действиям, ни занятость,
// ни счётчик заявок, и управление свелось к трём безымянным иконкам поверх фото.
//
// Порог именно lg, а не md: на md у кабинета появляется сайдбар 250px, контенту
// остаётся ~450, а шести колонкам нужно вдвое больше — таблица начинала
// распирать документ вбок. Плюс table-fixed и своя горизонтальная прокрутка у
// обёртки: по правилам проекта прокручиваться может блок, но не body.
//
// Разметки две — таблицу нельзя переложить в строки одним CSS, не ломая
// семантику. Списки здесь короткие, у человека единицы вещей.

import Link from "next/link";
import Image from "next/image";
import { ImageOff, MapPin } from "lucide-react";
import { content } from "@theme/content";
import { formatDeposit, formatPrice } from "@/lib/catalog/format";
import { ListingRowActions } from "@/components/cabinet/ListingRowActions";

export interface ListingRow {
  id: string;
  title: string;
  photoUrl: string | null;
  categoryName: string | null;
  priceDay: number;
  depositType: "money" | "document" | "none";
  depositAmount: number | null;
  status: "active" | "hidden" | "archived";
  /** Свободных единиц сегодня. null — занятость не показываем (не активное). */
  freeToday: number | null;
  quantity: number;
  pendingRequests: number;
  publicHref: string | null;
  /**
   * Точки у адреса нет, а у города есть геоданные: legacy-строка или адрес, не
   * найденный при backfill. Покупатели не видят расстояния, и форма правки не
   * сохранится без выбора адреса из подсказок, — говорим об этом заранее.
   */
  needsAddress: boolean;
}

const STATUS_LABEL = { active: "Активно", hidden: "Скрыто", archived: "Архив" } as const;

function Thumb({ row, size }: { row: ListingRow; size: number }) {
  return (
    <span
      className="relative shrink-0 overflow-hidden rounded-lg bg-muted"
      style={{ width: size, height: size }}
    >
      {row.photoUrl ? (
        <Image src={row.photoUrl} alt="" fill sizes={`${size}px`} className="object-cover" />
      ) : (
        // Перечёркнутый знак, а не пустой квадрат: пустой читается как
        // «не загрузилось», а здесь фотографии просто нет.
        <span className="flex h-full items-center justify-center text-muted-foreground">
          <ImageOff className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

/* Занятость на сегодня словом и точкой. Цвет не единственный носитель различия:
 * рядом стоит слово. В строках ниже lg заголовка колонки нет, поэтому там же
 * доносим смысл словом для скринридера — иначе «2 из 3» и число заявок стоят
 * рядом двумя голыми числами. */
function Today({ row, labelled }: { row: ListingRow; labelled?: boolean }) {
  if (row.status !== "active" || row.freeToday === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const busy = row.freeToday <= 0;
  const partial = row.freeToday > 0 && row.freeToday < row.quantity;
  const dot = busy ? "bg-muted-foreground" : partial ? "bg-accent" : "bg-primary";
  const label = busy
    ? "занято"
    : partial ? `свободно ${row.freeToday} из ${row.quantity}` : "свободно";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {labelled && <span className="sr-only">сегодня: </span>}
      {label}
    </span>
  );
}

function StatusChip({ status }: { status: ListingRow["status"] }) {
  return (
    <span className={`whitespace-nowrap rounded-pill px-2 py-0.5 text-2xs font-bold ${
      status === "active" ? "bg-primary/20 text-foreground" : "bg-muted text-muted-foreground"
    }`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/* Число ждущих ответа. Прочерк, а не ноль: ноль читается как значение и спорит
 * с охряным чипом соседней строки. */
function Pending({ n, labelled }: { n: number; labelled?: boolean }) {
  if (n === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-accent px-1.5 text-2xs font-bold text-accent-foreground">
      <span aria-hidden="true">{n}</span>
      <span className="sr-only">{labelled ? `заявок ждёт ответа: ${n}` : String(n)}</span>
    </span>
  );
}

function Price({ row }: { row: ListingRow }) {
  return (
    <>
      <span className="whitespace-nowrap font-medium tabular-nums">
        {formatPrice(row.priceDay)}
        {/* Единицу не теряем: «4 242 ₽» без неё читается как цена вещи. */}
        <span className="ml-1 text-2xs font-normal text-muted-foreground">в сутки</span>
      </span>
      <span className="block truncate text-2xs text-muted-foreground">
        {formatDeposit(row.depositType, row.depositAmount)}
      </span>
    </>
  );
}

/* Ссылка сразу в правку: метка — не только предупреждение, но и путь к
 * исправлению. Охра, как у ждущих заявок: это «требует внимания», а не
 * ошибка. Подсказка объясняет зачем — в строке на неё места нет. */
function NeedsAddress({ row }: { row: ListingRow }) {
  if (!row.needsAddress) return null;
  const t = content.address.listing;
  return (
    <Link
      href={`/cabinet/listings/${row.id}?tab=edit` as never}
      title={t.refineHint}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-pill bg-accent/15 px-2 py-0.5 text-2xs font-bold text-foreground hoverable"
    >
      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
      {t.refine}
    </Link>
  );
}

function TitleLink({ row, className }: { row: ListingRow; className?: string }) {
  return (
    <Link
      href={`/cabinet/listings/${row.id}` as never}
      className={`block truncate font-semibold transition-colors hover:text-accent ${className ?? ""}`}
      title={row.title}
    >
      {row.title}
    </Link>
  );
}

export function ListingsList({ rows }: { rows: ListingRow[] }) {
  return (
    <div className="surface">
      {/* Обёртка со своей прокруткой — страховка: если колонки всё же не
        * поместятся, вбок поедет таблица, а не документ. */}
      <div className="hidden overflow-x-auto lg:block">
        {/* table-fixed обязателен: в auto-таблице min-width:0 не уменьшает вклад
          * содержимого, и одно длинное название растаскивает всю таблицу — она
          * вылезала за экран даже на 1440. */}
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:font-mono [&>th]:text-2xs [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-mono [&>th]:text-muted-foreground">
              <th scope="col" className="text-left">вещь</th>
              <th scope="col" className="w-[118px] text-right">цена</th>
              <th scope="col" className="w-[96px] text-left">статус</th>
              <th scope="col" className="w-[124px] text-left">сегодня</th>
              <th scope="col" className="w-[76px] text-right">заявки</th>
              <th scope="col" className="w-[52px]"><span className="sr-only">действия</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`border-t border-border ${
                  row.status === "active" ? "" : "text-muted-foreground"
                }`}
              >
                {/* overflow-hidden на клетке: без него truncate внутри не
                  * срабатывает даже при table-fixed. */}
                <td className="overflow-hidden px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Thumb row={row} size={34} />
                    <span className="min-w-0 flex-1">
                      <TitleLink row={row} />
                      {row.categoryName && (
                        <span className="block truncate text-2xs text-muted-foreground">
                          {row.categoryName}
                        </span>
                      )}
                      {row.needsAddress && (
                        <span className="mt-1 block"><NeedsAddress row={row} /></span>
                      )}
                    </span>
                  </div>
                </td>
                <td className="overflow-hidden px-3 py-2.5 text-right"><Price row={row} /></td>
                <td className="px-3 py-2.5"><StatusChip status={row.status} /></td>
                <td className="px-3 py-2.5 text-sm"><Today row={row} /></td>
                <td className="px-3 py-2.5 text-right"><Pending n={row.pendingRequests} /></td>
                <td className="px-3 py-2.5 text-right">
                  <ListingRowActions
                    listingId={row.id}
                    status={row.status}
                    title={row.title}
                    publicHref={row.publicHref}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ниже lg: те же данные строкой. Колонки схлопываются в строку под
        * названием, в том же порядке. Подкатегория уходит — на узком экране она
        * вытесняет то, что важнее, а вещь опознаётся по названию и снимку.
        *
        * Неактивные гасим цветом текста, как в таблице, а не opacity: при
        * opacity вместе с текстом гаснут и подписи, и кнопка действий, и
        * контраст проваливается ниже нормы. */}
      <ul className="lg:hidden">
        {rows.map((row, i) => (
          <li
            key={row.id}
            /* items-start, а не center: у длинного названия строка переносится,
             * и по центру меню с фотографией уезжали бы к середине блока. */
            className={`flex items-start gap-3 p-3 ${i > 0 ? "border-t border-border" : ""}`}
          >
            <Thumb row={row} size={44} />
            <div className={`min-w-0 flex-1 ${row.status === "active" ? "" : "text-muted-foreground"}`}>
              <TitleLink row={row} className="text-sm" />
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
                <span className="whitespace-nowrap tabular-nums">
                  {formatPrice(row.priceDay)} в сутки
                </span>
                <span>{formatDeposit(row.depositType, row.depositAmount)}</span>
                {row.status === "active"
                  ? <Today row={row} labelled />
                  : <StatusChip status={row.status} />}
                {row.pendingRequests > 0 && <Pending n={row.pendingRequests} labelled />}
                <NeedsAddress row={row} />
              </div>
            </div>
            <ListingRowActions
              listingId={row.id}
              status={row.status}
              title={row.title}
              publicHref={row.publicHref}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
