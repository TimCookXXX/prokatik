// Чип фильтра: один ряд взаимоисключающих видов над списком. Строкой классов,
// а не компонентом, по образцу ui/card-frame.ts — потребители у чипа разные по
// природе: где-то это <Link> со сменой адреса, где-то <button>.
//
// Скругление 8px, а не капсула: по theme/tokens.schema.md капсула отдана
// счётчикам-кружкам и полосе лоадера, а чипу положен --radius-sm.
//
// Ховер висит только на невыбранном: у выбранного подсветка спорила бы с
// заливкой состояния. Гасить её через .hoverable не нужно — класса там просто
// нет.
// tap-target — зона нажатия 44px на тач-экране: чип в 32px остаётся тем же
// на вид (ui/globals.css, .tap-target).
const BASE =
  "tap-target inline-flex h-8 items-center gap-1.5 rounded-sm border px-3 text-xs font-medium "
  + "ring-offset-background transition-[color,background-color,border-color,transform] "
  + "duration-150 ease-out active:scale-[0.97] focus-visible:[outline:none] "
  + "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 "
  + "motion-reduce:transition-none motion-reduce:active:scale-100";

export function filterChip(active: boolean): string {
  return active
    ? `${BASE} border-selected bg-selected font-semibold text-selected-foreground`
    : `${BASE} border-border text-muted-foreground hoverable hover:text-foreground`;
}

/* Счётчик внутри чипа. Не окрашен: охра в этом ряду уже занята состоянием
 * «выбрано», и второй охряной элемент спорил бы с ним. Приглушаем кеглем, а не
 * альфой: 12px под opacity-70 дают на холсте 2.95 при норме 4.5, а число здесь
 * единственный носитель «сколько вещей в виде». */
export const filterChipCount = "text-2xs tabular-nums";

/* Рост чипа в ленте управления выдачей (каталог и поиск): на телефоне — цель
 * для пальца в 44px, с md — прежние 32px десктопной панели. Кегль крупнее
 * базового: в ленте чип несёт значение («Сначала дешевле», «8–11 окт»), а не
 * короткое имя вида. Склеивать через cn — он снимает базовый h-8. */
export const toolbarChip = "h-11 shrink-0 text-sm md:h-8";

/* С md чипы дат и сортировки — прежние кнопки десктопной панели над выдачей:
 * на фоне страницы, обычного начертания, без нажатия масштабом. Классы под
 * md:, а не отдельная строка: телефонная лента остаётся на общем чипе.
 * Фон — только невыбранному, иначе он перекрыл бы заливку состояния. */
export function toolbarChipDesktop(active: boolean): string {
  return active
    ? "md:font-normal md:active:scale-100"
    : "md:bg-background md:font-normal md:active:scale-100";
}
