// Переключатель вида выдачи: сетка или список. Обычные ссылки — состояние
// живёт в адресе (?view=list), поэтому переживает перезагрузку и «назад».

import Link from "next/link";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type ListingView = "grid" | "list";

export function parseView(v: string | undefined): ListingView {
  return v === "list" ? "list" : "grid";
}

// Активный вид помечен охрой — тем же, чем активная категория, выбранный чип и
// заданный диапазон дат. По закону цвета проекта охра означает состояние
// («здесь выбрано»), а зелёный — действие.
export function ViewToggle({
  view, gridHref, listHref, className,
}: {
  view: ListingView;
  gridHref: string;
  listHref: string;
  className?: string;
}) {
  const item = (active: boolean) =>
    `flex h-7 w-7 items-center justify-center rounded-sm transition-colors ${
      active ? "bg-selected text-selected-foreground" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className={cn("flex shrink-0 items-center gap-0.5 rounded-sm border border-border bg-background p-0.5", className)}>
      <Link href={gridHref as never} className={item(view === "grid")} aria-label="Сеткой"
        aria-current={view === "grid" ? "true" : undefined}>
        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
      </Link>
      <Link href={listHref as never} className={item(view === "list")} aria-label="Списком"
        aria-current={view === "list" ? "true" : undefined}>
        <List className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
