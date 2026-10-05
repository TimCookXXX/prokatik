"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import { filterChip, filterChipCount, toolbarChip } from "@/components/ui/filter-chip";
import { Modal, ModalContent, ModalTitle, ModalTrigger } from "@/components/ui/Modal";

const t = content.catalogToolbar;

// Мобильная «шторка» фильтров: чип «Фильтры (n)» в ленте выдачи открывает
// лист снизу с формой (children). Десктоп рендерит фильтры в боковой панели и
// эту обёртку не использует. Окно — общий примитив Modal, как у входа и заявки.
//
// view — переключатель сетки и списка: на телефоне ему нет места в ленте, и
// он живёт здесь, над формой. Это ссылки, и после перехода шторка закрывается
// сама — иначе она висела бы поверх уже перестроенной выдачи.
export function FiltersSheet({
  count, view, children,
}: {
  /** Сколько фильтров панели применено (activeFilterCount). */
  count: number;
  view?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <button
          type="button"
          aria-label={t.filtersCount(count)}
          className={cn(filterChip(count > 0), toolbarChip)}
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t.filters}
          {count > 0 && <span className={filterChipCount}>{count}</span>}
        </button>
      </ModalTrigger>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="mb-3 text-lg font-bold">{t.filters}</ModalTitle>
        {view && (
          <div
            className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-4"
            onClick={(e) => { if ((e.target as Element).closest("a")) setOpen(false); }}
          >
            <span className="text-sm text-foreground">{t.view}</span>
            {view}
          </div>
        )}
        {children}
      </ModalContent>
    </Modal>
  );
}
