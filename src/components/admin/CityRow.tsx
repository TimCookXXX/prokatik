"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/admin/ActionButton";
import { CityForm, type EditableCity } from "@/components/admin/CityForm";

/* Строка города в админке. Правка раскрывается на месте: городов десятки, и
 * отдельная страница ради трёх полей была бы дороже, чем сама правка. */
export function CityRow({
  city,
  geoRegions,
  meta,
  toggle,
}: {
  city: EditableCity & { slug: string; isActive: boolean };
  /** Загруженные регионы геоданных — для формы правки. */
  geoRegions: readonly string[];
  /** Готовая подпись под названием: слаг, регион, число объявлений. */
  meta: string;
  /** Забинженный adminSetCityActive — server action приходит сверху. */
  toggle: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
      {editing ? (
        <CityForm city={city} geoRegions={geoRegions} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div>
            <span className="font-medium">{city.name}</span>
            {!city.isActive && (
              <span className="ml-2 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">отключён</span>
            )}
            {/* Незаполненный падеж виден сразу: пока его нет, заголовки города
              * собираются без предлога — это заметно в выдаче. */}
            {!city.nameLocative && (
              <span className="ml-2 rounded-sm bg-accent/15 px-2 py-0.5 text-xs text-accent">без падежа</span>
            )}
            <p className="text-sm text-muted-foreground">{meta}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Изменить
            </Button>
            <ActionButton
              label={city.isActive ? "Отключить" : "Включить"}
              confirmText={city.isActive ? "Отключить город? Его страницы пропадут из каталога." : undefined}
              action={toggle}
            />
          </div>
        </>
      )}
    </li>
  );
}
