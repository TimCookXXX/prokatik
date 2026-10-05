"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { fieldWithin } from "@/components/ui/field";

// Двуручный слайдер цены. Единственный кусок фильтров, которому нужен
// клиентский JS: два <input type="range"> лежат друг на друге, и без скрипта
// ручки проходят сквозь друг друга, а числовые поля с ними не синхронны.
//
// Значения уходят на сервер обычными полями формы (price_min/price_max), а не
// фетчем: форма остаётся GET-формой, и фильтры переживают отключённый JS —
// без него слайдер просто не отрисуется, а поля ввода останутся рабочими.
//
// Граница, на которой стоит ручка, в адрес не уходит: у поля нет `name`. Иначе
// любой сабмит формы — хоть ради одного «Без залога» — писал бы в адрес обе
// границы раздела, и чип «Фильтры» считал бы цену применённой. Снимается имя
// только после гидрации: без JS поле остаётся единственным вводом цены, и
// безымянное оно ничего бы не отправило.
const noopSubscribe = () => () => {};
export function PriceRange({
  min, max, valueMin, valueMax,
}: {
  /** Границы раздела — из getCategoryStats. */
  min: number;
  max: number;
  valueMin?: number;
  valueMax?: number;
}) {
  const id = useId();
  const [lo, setLo] = useState(valueMin ?? min);
  const [hi, setHi] = useState(valueMax ?? max);

  // Ручки не проходят сквозь друг друга: каждая упирается в соседнюю.
  const setLoSafe = (v: number) => setLo(Math.min(v, hi));
  const setHiSafe = (v: number) => setHi(Math.max(v, lo));

  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const minName = hydrated && lo <= min ? undefined : "price_min";
  const maxName = hydrated && hi >= max ? undefined : "price_max";

  const span = Math.max(1, max - min);
  const leftPct = ((lo - min) / span) * 100;
  const rightPct = ((hi - min) / span) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-5">
        {/* Дорожка и закрашенный участок — обычные div'ы: у <input type="range">
          * нельзя раскрасить часть дорожки кроссбраузерно. Незалитая часть —
          * тем же цветом, что выключенный тумблер: --color-muted почти
          * совпадает с карточкой, и дорожки на ней не видно. */}
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-pill bg-foreground/20" aria-hidden="true" />
        <span
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-pill bg-accent"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
          aria-hidden="true"
        />
        <input
          type="range" min={min} max={max} value={lo}
          onChange={(e) => setLoSafe(Number(e.target.value))}
          aria-label="Цена от"
          className="price-range absolute inset-x-0 top-0 h-5 w-full appearance-none bg-transparent"
        />
        <input
          type="range" min={min} max={max} value={hi}
          onChange={(e) => setHiSafe(Number(e.target.value))}
          aria-label="Цена до"
          className="price-range absolute inset-x-0 top-0 h-5 w-full appearance-none bg-transparent"
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`${id}-min`}>Цена от</label>
        <div className={`${fieldWithin} flex h-9 min-w-0 flex-1 items-center gap-1 px-3`}>
          <span className="shrink-0 text-xs text-muted-foreground">от</span>
          <input
            id={`${id}-min`} name={minName} type="number" min={min} inputMode="numeric"
            value={lo} onChange={(e) => setLoSafe(Number(e.target.value))}
            className="w-full min-w-0 bg-transparent text-sm outline-none"
          />
          <span className="shrink-0 text-xs text-muted-foreground">₽</span>
        </div>
        <label className="sr-only" htmlFor={`${id}-max`}>Цена до</label>
        <div className={`${fieldWithin} flex h-9 min-w-0 flex-1 items-center gap-1 px-3`}>
          <span className="shrink-0 text-xs text-muted-foreground">до</span>
          <input
            id={`${id}-max`} name={maxName} type="number" min={min} inputMode="numeric"
            value={hi} onChange={(e) => setHiSafe(Number(e.target.value))}
            className="w-full min-w-0 bg-transparent text-sm outline-none"
          />
          <span className="shrink-0 text-xs text-muted-foreground">₽</span>
        </div>
      </div>
    </div>
  );
}
