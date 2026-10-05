"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterChip, toolbarChip } from "@/components/ui/filter-chip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface SortOption {
  value: string;
  label: string;
  href: string;
}

// Сортировка в верхней панели выдачи. Ссылки, а не <select> в форме: сортировка
// живёт отдельно от фильтров, применяется сразу по клику и не требует кнопки
// «Показать».
//
// Адреса приходят готовыми строками, а не функцией-строителем: компонент
// клиентский, а функцию через границу сервер/клиент передать нельзя — Next
// падает на «Functions cannot be passed directly to Client Components».
export function SortMenu({
  options, current,
}: {
  options: SortOption[];
  current?: string;
}) {
  const active = options.find((o) => o.value === current) ?? options[0];
  if (!active) return null;

  return (
    <DropdownMenu modal={false}>
      {/* Чип ленты выдачи: рост и кегль — общие с соседями (toolbarChip). */}
      <DropdownMenuTrigger className={cn(filterChip(false), toolbarChip, "font-normal text-foreground")}>
        <span className="hidden shrink-0 text-muted-foreground sm:inline">Сначала</span>
        <span className="truncate font-medium">{active.label.replace(/^Сначала /, "")}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} asChild>
            <Link
              href={o.href as never}
              className={o.value === active.value ? "text-accent" : ""}
            >
              {o.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
