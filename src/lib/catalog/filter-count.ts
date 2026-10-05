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

/** Цена — одно условие, даже если заданы обе границы: в панели это один слайдер. */
export function activeFilterCount(f: PanelFilters): number {
  return [
    f.priceMin !== undefined || f.priceMax !== undefined,
    Boolean(f.deposit),
    Boolean(f.handover),
    Boolean(f.verifiedOnly),
  ].filter(Boolean).length;
}
