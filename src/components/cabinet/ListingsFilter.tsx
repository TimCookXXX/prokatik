"use client";

// Фильтр над списком объявлений: ряд взаимоисключающих видов.
//
// Фильтруем в браузере, а не на сервере, — в отличие от ленты заявок, где вид
// меняет адрес и страницу перерисовывает сервер. Причина в данных: там строки
// грузятся под фильтр, а здесь весь список уже приехал, и гонять раунд-трип
// ради переключения между шестью строками — это заметная задержка на действии,
// которое делают часто. Адрес при этом остаётся честным: его пишет
// history.replaceState (приём документирован Next и синхронизирован с
// роутером), поэтому обновление страницы и возврат со страницы вещи вид
// сохраняют. Новых записей в историю не появляется — кнопка «назад» на мобиле
// не начинает ходить по фильтрам вместо страниц.
//
// Ось одна — статус. «Ждут ответа» здесь сознательно нет: этот вид пересекает
// статусы (заявка по архивной вещи тоже ждёт), то есть ряд перестал бы читаться
// как разбиение списка, а число «объявлений с заявками» спорило бы с бейджем
// «Заявки» в меню, где считаются сами заявки.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Archive } from "lucide-react";
import { filterChip, filterChipCount } from "@/components/ui/filter-chip";
import { ListingsList, type ListingRow } from "@/components/cabinet/ListingsList";
import {
  LISTINGS_VIEWS, LISTINGS_VIEW_MATCH, isListingsView, type ListingsView,
} from "@/lib/owner/listings-view";

const LABEL: Record<ListingsView, string> = {
  all: "Все",
  active: "Активные",
  hidden: "Скрытые",
  archived: "Архив",
};

/* Единственное место, где сказано, что вещь возвращается скрытой, а не в
 * каталог. Раньше это была отдельная страница архива со своим абзацем. */
const ARCHIVE_HINT =
  "Эти объявления не видны в каталоге. Вернуть можно любое — оно появится "
  + "в списке скрытым, и вы сами решите, публиковать ли снова.";

const match = (view: ListingsView) => (row: ListingRow) =>
  LISTINGS_VIEW_MATCH[view](row.status);

const href = (view: ListingsView) =>
  view === "all" ? "/cabinet/listings" : `/cabinet/listings?view=${view}`;

export function ListingsFilter({
  rows,
  initialView,
}: {
  rows: ListingRow[];
  initialView: ListingsView;
}) {
  const [view, setView] = useState<ListingsView>(initialView);

  /* Вид держим в состоянии — переключение обязано быть мгновенным, — но правду
   * о нём знает адрес. Разойтись они могут на возврате «назад»: страница
   * берётся из кеша роутера вместе со старым initialView, а `?view=` в адресе
   * уже другой. На мобиле это обычный путь — кнопку «назад» там рисует
   * оболочка кабинета и зовёт router.back(), а не ссылку. */
  const raw = useSearchParams().get("view");
  const urlView: ListingsView = isListingsView(raw) ? raw : "all";
  useEffect(() => { setView(urlView); }, [urlView]);

  const counts = LISTINGS_VIEWS.map((id) => ({ id, n: rows.filter(match(id)).length }));
  const total = counts.find((c) => c.id === "all")!.n;

  /* В ряду только виды, дающие разные списки. Пустой вид — это кнопка в пустоту.
   * А «Активные», совпавшие по числу со «Всеми», — это второе имя того же
   * списка: у человека с одними активными вещами «Все 5» и «Активные 5»
   * выбирали бы одно и то же. */
  const visible = counts.filter(({ id, n }) =>
    n > 0 && !((id === "active" || id === "hidden") && n === total));

  // Один вид — фильтровать нечем, и ряда нет вовсе.
  const hasFilter = visible.length > 1;

  /* Вид, которого в ряду не оказалось — опустел или совпал с соседним, —
   * заменяется первым из ряда. Без этого сценарий «стоял в „Скрытые“ → убрал
   * вещь в архив» оставлял бы человека в пустом списке: чипа уже нет, а
   * вернуться нечем, кроме перезагрузки. */
  const current: ListingsView = hasFilter && visible.some((v) => v.id === view)
    ? view
    : visible[0]?.id ?? "all";

  /* Адрес не должен пережить подмену вида: иначе обновление страницы вернуло бы
   * в тот же пустой вид, из которого только что вышли. Состояние тут не
   * трогаем — `current` и так производный, а лишний setView спорил бы с
   * синхронизацией по адресу выше. */
  useEffect(() => {
    if (current !== view) window.history.replaceState(null, "", href(current));
  }, [current, view]);

  const pick = (next: ListingsView) => {
    setView(next);
    window.history.replaceState(null, "", href(next));
  };

  return (
    <>
      {hasFilter && (
        <div
          role="group"
          aria-label="Фильтр объявлений"
          /* Ниже md — одна строка от кромки до кромки: четыре чипа со
           * счётчиками просят больше, чем есть в колонке телефона, а перенос
           * разворачивал их в два ряда и отжимал первую вещь за сгиб.
           * Отрицательные поля гасят отступ страницы — приём тот же, что у
           * строки категорий на главной и у ленты разделов в оболочке кабинета.
           *
           * Порог именно md: с него у кабинета появляется боковое меню, и
           * колонка становится ячейкой грида без собственных полей — там
           * -mx-4 вытаскивал бы ряд в зазор между меню и колонкой, вразрез с
           * таблицей под ним. Места с md хватает, прокрутка и не нужна. */
          /* py-1.5 — место кольцу фокуса и зоне нажатия чипа (32px → 44px,
           * .tap-target): при overflow-x:auto вертикаль тоже становится auto
           * и срезала бы обе. -mt-0.5 и mb-2.5 возвращают ряду прежний шаг. */
          className={
            "-mx-4 -mt-0.5 mb-2.5 flex gap-2 overflow-x-auto px-4 py-1.5 "
            + "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden "
            + "md:mx-0 md:mt-0 md:mb-3 md:overflow-visible md:px-0 md:py-1"
          }
        >
          {visible.map(({ id, n }) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === current}
              aria-label={`${LABEL[id]}, ${n}`}
              onClick={() => pick(id)}
              className={`${filterChip(id === current)} shrink-0`}
            >
              {id === "archived" && (
                <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span aria-hidden="true">{LABEL[id]}</span>
              <span aria-hidden="true" className={filterChipCount}>{n}</span>
            </button>
          ))}
        </div>
      )}

      {current === "archived" && (
        <p className="mb-3 text-xs text-muted-foreground">{ARCHIVE_HINT}</p>
      )}

      <ListingsList rows={rows.filter(match(current))} />
    </>
  );
}
