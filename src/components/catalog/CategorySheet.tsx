"use client";

import { ChevronDown } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import { filterChip, toolbarChip } from "@/components/ui/filter-chip";
import { Modal, ModalContent, ModalTitle, ModalTrigger } from "@/components/ui/Modal";

const t = content.catalogToolbar;

// Мобильный выбор категории: чип с текущим разделом в ленте выдачи открывает
// лист снизу с деревом (children). Десктоп показывает дерево в боковой панели
// и эту обёртку не использует. Окно — общий примитив Modal.
export function CategorySheet({
  label, children,
}: {
  /** Текущий раздел — он же подпись на чипе. */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Modal>
      <ModalTrigger asChild>
        <button
          type="button"
          aria-label={`${t.category}: ${label}`}
          className={cn(filterChip(false), toolbarChip, "max-w-[12rem] text-foreground")}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </ModalTrigger>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="mb-3 text-lg font-bold">{t.categoriesTitle}</ModalTitle>
        {children}
      </ModalContent>
    </Modal>
  );
}
