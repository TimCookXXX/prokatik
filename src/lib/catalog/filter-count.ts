// Сколько фильтров панели применено — число на чипе «Фильтры (n)» ленты
// выдачи. Считаются только условия самой панели: цена, залог, способ
// получения, «только проверенные». У раздела, дат и сортировки свои чипы в
// той же ленте, вид выдачу не сужает — в число они не входят.

export interface PanelFilters {
  priceMin?: number;
  priceMax?: number;
  deposit?: string;
  handover?: string;
  verifiedOnly?: boolean;
}

/**
 * Цена — одно условие, даже если заданы обе границы: в панели это один слайдер.
 *
 * С границами раздела (`priceBounds`) цена считается, только если сужает их:
 * граница из адреса, равная краю раздела или шире него, ничего не отсекает —
 * такой адрес оставляют старые ссылки и форма без JS. Без границ слайдера
 * нет, и считается любая заданная граница.
 */
export function activeFilterCount(
  f: PanelFilters,
  priceBounds?: { min: number; max: number },
): number {
  const price = priceBounds
    ? (f.priceMin !== undefined && f.priceMin > priceBounds.min)
      || (f.priceMax !== undefined && f.priceMax < priceBounds.max)
    : f.priceMin !== undefined || f.priceMax !== undefined;
  return [
    price,
    Boolean(f.deposit),
    Boolean(f.handover),
    Boolean(f.verifiedOnly),
  ].filter(Boolean).length;
}
