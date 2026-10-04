"use client";

// Сигнал «открыть „Где“ в hero»: его подаёт полоса «Рядом с вами» на главной
// («Сменить место», «или укажите адрес»), а слушает поле «Где» в hero. Ниже lg
// оно открывает шторку, с lg — ставит фокус в своё поле, и список подсказок
// раскрывается как от клика. Прямой ссылки между блоками нет: полоса не знает
// устройства панели поиска.
//
// `returnFocus` — куда вернуть фокус, когда шторка закроется: кнопка, подавшая
// сигнал, к тому времени может быть размонтирована (выбор места сменил блок).

export type ReturnFocus = () => HTMLElement | null;
type Listener = (returnFocus?: ReturnFocus) => void;

const listeners = new Set<Listener>();

/** Подписка поля «Где» hero; возвращает отписку. */
export function onWhereOpen(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Открыть «Где» в hero; false — слушателя нет (на странице нет поиска с «Где»). */
export function requestWhereOpen(returnFocus?: ReturnFocus): boolean {
  if (listeners.size === 0) return false;
  for (const cb of listeners) cb(returnFocus);
  return true;
}
