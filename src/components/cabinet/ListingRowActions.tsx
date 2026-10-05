"use client";

// Действия по объявлению — одним меню. Раньше это были три безымянные иконки
// поверх фотографии: подписей не было, места на четвёртую не было тоже, и
// «Смотреть объявление» в кабинет так и не попало.
//
// Меню и его вид — те же, что под аватаркой в шапке: тот же dropdown-menu, тот
// же ряд «иконка в колонке шириной 6, подпись рядом». Второго вида выпадающих
// списков в проекте быть не должно.

import Link from "next/link";
import { useTransition } from "react";
import {
  Archive, ExternalLink, Eye, EyeOff, MoreHorizontal, Pencil, RotateCcw,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { setListingStatus } from "@/server/actions/owner";

const TRIGGER =
  "tap-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-muted-foreground "
  + "transition-colors hoverable hover:text-foreground focus-visible:[outline:none] "
  + "focus-visible:ring-2 focus-visible:ring-ring";

/* Значок в колонке фиксированной ширины, чтобы подписи выстроились в столбик, —
 * ровно как в меню шапки. Цвет приглушённый: значок здесь опознаёт пункт, а не
 * спорит с ним за внимание. */
function ItemIcon({ Icon }: { Icon: LucideIcon }) {
  return (
    <span className="flex w-6 shrink-0 justify-center">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}

export function ListingRowActions({
  listingId, status, title, publicHref,
}: {
  listingId: string;
  status: "active" | "hidden" | "archived";
  /** Нужен подписям: без него «Скрыть» у десяти строк читается одинаково. */
  title: string;
  /** Адрес объявления на публичных страницах, если он есть: города может уже
   *  не быть в справочнике активных, а список кабинета вдобавок не строит его
   *  неактивным. Пункт всё равно рисуется только у активного — здесь это не
   *  допущение, а проверка. */
  publicHref: string | null;
}) {
  const [, startTransition] = useTransition();

  const run = (next: "active" | "hidden" | "archived") =>
    startTransition(async () => { await setListingStatus(listingId, next); });

  // Подтверждение ждёт настоящего ответа, поэтому экшен зовётся напрямую, без
  // useTransition: тот возвращается сразу, и окно закрывалось бы до ответа
  // сервера. Отказ выбрасывается — ConfirmDialog оставит окно открытым.
  const confirmArchive = async () => {
    const r = await setListingStatus(listingId, "archived");
    if (!r.ok) throw new Error("Не удалось убрать объявление. Попробуйте ещё раз.");
  };

  const isActive = status === "active";

  return (
    <DropdownMenu>
      {/* Триггер НЕ гасим на время запроса. Radix при закрытии возвращает
        * фокус на него, а focus() по disabled-кнопке — пустая операция: фокус
        * уезжает в body, и Tab начинает с шапки страницы. Защищать тут нечего —
        * меню уже закрыто, а setListingStatus идемпотентен. */}
      <DropdownMenuTrigger className={TRIGGER} aria-label={`Действия: ${title}`}>
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[200px]">
        {status === "archived" ? (
          <DropdownMenuItem className="gap-2.5" onSelect={() => run("hidden")}>
            <ItemIcon Icon={RotateCcw} />
            Вернуть из архива
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem asChild className="gap-2.5">
              <Link href={`/cabinet/listings/${listingId}?tab=edit` as never}>
                <ItemIcon Icon={Pencil} />
                Править
              </Link>
            </DropdownMenuItem>

            {/* Публичная страница есть только у активного: у скрытого её нет,
              * пункт вёл бы в 404. */}
            {isActive && publicHref && (
              <DropdownMenuItem asChild className="gap-2.5">
                <Link href={publicHref as never}>
                  <ItemIcon Icon={ExternalLink} />
                  Смотреть объявление
                </Link>
              </DropdownMenuItem>
            )}

            <DropdownMenuItem className="gap-2.5" onSelect={() => run(isActive ? "hidden" : "active")}>
              <ItemIcon Icon={isActive ? EyeOff : Eye} />
              {isActive ? "Скрыть" : "Показать"}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <ConfirmDialog
              trigger={
                // onSelect гасится: иначе Radix закрыл бы меню раньше, чем
                // откроется окно подтверждения, и триггер размонтировался бы.
                <DropdownMenuItem
                  className="gap-2.5 text-destructive"
                  onSelect={(e) => e.preventDefault()}
                >
                  <span className="flex w-6 shrink-0 justify-center">
                    {/* Цвет наследуется от пункта: «в архив» единственное
                      * необратимое действие в списке, и значок не должен
                      * выпадать из его красного. */}
                    <Archive className="h-4 w-4" aria-hidden="true" />
                  </span>
                  В архив
                </DropdownMenuItem>
              }
              title="Убрать объявление?"
              description={
                "Объявление пропадёт из каталога и из этого списка, но останется в архиве — "
                + "оттуда его можно вернуть. Заявки и переписка по нему сохранятся, а вот "
                + "занятость у архивной вещи больше не показывается, даже если бронь ещё идёт."
              }
              confirmLabel="Убрать"
              destructive
              onConfirm={confirmArchive}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
