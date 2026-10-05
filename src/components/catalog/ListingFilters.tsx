// Фильтры листинга. GET-форма: SSR перечитывает searchParams, клиентский JS
// нужен только слайдеру цены (PriceRange). Чипы и тумблер — обычные radio и
// checkbox с sr-only вводом, поэтому выбор переживает отключённый JS, а
// применяется он кнопкой «Показать N», а не на каждый клик.
//
// С md форма и навигация по разделам стоят боковой панелью (ListingFilters).
// На мобиле та же форма (FilterForm) открывается из чипа «Фильтры» в ленте
// выдачи (ResultsToolbar), раздел — из чипа «Категория».

import Link from "next/link";
import { Banknote, FileText, Ban } from "lucide-react";
import { HandoverIcon } from "@/components/catalog/HandoverIcon";
import { Button } from "@/components/ui/button";
import { PriceRange } from "@/components/catalog/PriceRange";

export interface FilterState {
  priceMin?: number;
  priceMax?: number;
  deposit?: string;
  handover?: string;
  verifiedOnly?: boolean;
  sort?: string;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <legend className="mb-2 font-mono text-micro uppercase tracking-mono text-muted-foreground">
      {children}
    </legend>
  );
}

// Чип-переключатель на radio: без JS, состояние рисуется через has-[:checked].
// Ввод sr-only, поэтому кольцо фокуса рисуется на обёртке — иначе выбор чипа
// с клавиатуры ничем не отзывается.
//
// Кольцо наружное и с отступом, как у тумблера ниже. Внутреннее здесь не
// годится: --color-ring и --color-accent — один цвет, а у отмеченного чипа
// кант уже accent, и кольцо вплотную под ним только утолщало бы кант. В
// radio-группе с клавиатуры фокус почти всегда стоит именно на отмеченном, то
// есть в основном сценарии его было бы не видно. Отступ красим токеном:
// умолчание Tailwind — белый, в тёмной теме он светил бы дырой.
function Chip({
  name, value, checked, icon, children,
}: {
  name: string;
  value: string;
  checked: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-border
        bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground
        has-[:checked]:border-accent has-[:checked]:bg-selected has-[:checked]:text-selected-foreground
        has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring
        has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background"
    >
      <input
        type="radio" name={name} value={value} defaultChecked={checked}
        className="sr-only"
      />
      {icon}
      {children}
    </label>
  );
}

export function FilterForm({
  basePath, state, hidden, priceBounds,
}: {
  basePath: string;
  state: FilterState;
  hidden?: Record<string, string>;
  priceBounds?: { min: number; max: number };
}) {
  const hiddenEntries = Object.entries(hidden ?? {}).filter(([, v]) => v !== "");
  // «Сбросить» очищает только фильтры этой панели (цена, залог, способ
  // получения, проверенные).
  // Контекст поиска и состояние верхней панели — вид, даты, сортировка —
  // переносятся скрытыми полями: форма GET, и в адрес попадает ровно то, что
  // она отправила. Без них сабмит фильтров сбрасывал бы список обратно в сетку
  // и терял выбранный диапазон дат.
  const resetQs = new URLSearchParams(hiddenEntries).toString();
  const resetHref = resetQs ? `${basePath}?${resetQs}` : basePath;

  // Ключ по применённым фильтрам — иначе «Сбросить» ничего не сбрасывает.
  // Переход клиентский, React переиспользует ту же форму, а поля тут
  // неуправляемые (defaultChecked/defaultValue) и слайдер держит значения в
  // useState: и то, и другое читается только при монтировании. Смена ключа
  // заставляет форму перемонтироваться и перечитать состояние из адреса.
  const stateKey = [
    state.priceMin, state.priceMax, state.deposit, state.handover,
    state.verifiedOnly, state.sort,
  ].join("|");

  return (
    <form key={stateKey} method="GET" action={basePath} className="flex flex-col gap-4">
      {hiddenEntries.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {/* Секции цены нет, когда фильтровать не по чему: в разделе одна цена на
        * всех (минимум равен максимуму) или объявлений нет вовсе — тогда
        * агрегат отдаёт NULL. Такой фильтр может вернуть только «всё» или
        * «ничего». Раньше здесь показывались
        * поля «от/до» — из-за них в проекте было два разных ввода цены,
        * и какой ты увидишь, зависело от содержимого раздела. */}
      {priceBounds && (
        <>
          <fieldset className="border-0 p-0">
            <SectionLabel>Цена в сутки</SectionLabel>
            <PriceRange
              min={priceBounds.min}
              max={priceBounds.max}
              valueMin={state.priceMin}
              valueMax={state.priceMax}
            />
          </fieldset>

          <hr className="border-border" />
        </>
      )}

      <fieldset className="border-0 p-0">
        <SectionLabel>Залог</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <Chip name="deposit" value="money" checked={state.deposit === "money"}
            icon={<Banknote className="h-3 w-3 shrink-0" aria-hidden="true" />}>
            Деньги
          </Chip>
          <Chip name="deposit" value="document" checked={state.deposit === "document"}
            icon={<FileText className="h-3 w-3 shrink-0" aria-hidden="true" />}>
            Документы
          </Chip>
          <Chip name="deposit" value="none" checked={state.deposit === "none"}
            icon={<Ban className="h-3 w-3 shrink-0" aria-hidden="true" />}>
            Без залога
          </Chip>
        </div>
      </fieldset>

      <hr className="border-border" />

      {/* Условие включающее: «Самовывоз» отбирает всё, что поддерживает
        * самовывоз, и товар с обоими способами попадает под оба чипа.
        * Чипа «Любой» нет — как и у залога: снимает выбор кнопка «Сбросить». */}
      <fieldset className="border-0 p-0">
        <SectionLabel>Как забрать</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {/* Значки — общий HandoverIcon: то же свойство в выдаче и на позиции
            * рисуется теми же глифами. Цвет не задаём, чип красит содержимое
            * сам и меняет его при выборе. */}
          <Chip name="handover" value="pickup" checked={state.handover === "pickup"}
            icon={<HandoverIcon pickup delivery={false} className="h-3 w-3 shrink-0" />}>
            Самовывоз
          </Chip>
          <Chip name="handover" value="delivery" checked={state.handover === "delivery"}
            icon={<HandoverIcon pickup={false} delivery className="h-3 w-3 shrink-0" />}>
            Доставка
          </Chip>
        </div>
      </fieldset>

      <hr className="border-border" />

      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox" name="verified" value="1"
          defaultChecked={state.verifiedOnly ?? false}
          className="peer sr-only"
        />
        {/* Тумблер на checkbox, без JS. Бегунок двигается через
          * peer-checked:[&>span], а не просто peer-checked: последний
          * разворачивается в селектор СОСЕДА инпута, а бегунок лежит внутри
          * дорожки — правило до него не достаёт. */}
        <span className="relative h-6 w-10 shrink-0 rounded-pill bg-foreground/20 transition-colors peer-checked:bg-accent peer-checked:[&>span]:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-pill bg-card transition-transform" />
        </span>
        <span className="text-sm text-foreground">Только проверенные</span>
      </label>

      <div className="flex items-center gap-2">
        <Button type="submit" className="flex-1">Показать</Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={resetHref as never}>Сбросить</Link>
        </Button>
      </div>
    </form>
  );
}

/** Боковая панель с md: навигация по разделам и форма фильтров под ней. */
export function ListingFilters({
  basePath, state, hidden, categoryNav, priceBounds,
}: {
  basePath: string;
  state: FilterState;
  // Доп. GET-параметры (q, city), которые надо сохранить при сабмите формы.
  hidden?: Record<string, string>;
  // Навигация по разделам: в каталоге это дерево категорий, на /search —
  // фасеты с числом находок. Разная разметка, одно и то же место в панели.
  categoryNav?: React.ReactNode;
  priceBounds?: { min: number; max: number };
}) {
  return (
    <div className="surface flex flex-col">
      {categoryNav && (
        <>
          <div className="p-2">{categoryNav}</div>
          <hr className="border-border" />
        </>
      )}
      <div className="p-4">
        <FilterForm basePath={basePath} state={state} hidden={hidden} priceBounds={priceBounds} />
      </div>
    </div>
  );
}
